import { Injectable } from '@nestjs/common';
import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { AppConfigService } from '../../common/config/app-config.service';
import { TelemetryService } from '../../common/observability/telemetry.service';

export class AzureApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Azure API ${status} ${code}`);
    this.name = 'AzureApiError';
  }
}

export interface SecretMeta {
  name: string;
  enabled: boolean | null;
  contentType: string | null;
  createdOn: string | null;
  updatedOn: string | null;
  expiresOn: string | null;
  versions: number;
  daysToExpiry: number | null;
}

/**
 * Azure control/data-plane reads with the App Service system-assigned Managed Identity
 * (DefaultAzureCredential → ManagedIdentityCredential on App Service, Azure CLI login locally).
 * No credentials are configured in the app. Every call is read-only.
 */
@Injectable()
export class AzureClient {
  private credential?: TokenCredential;

  constructor(
    private readonly config: AppConfigService,
    private readonly telemetry: TelemetryService,
  ) {}

  private cred(): TokenCredential {
    this.credential ??= new DefaultAzureCredential();
    return this.credential;
  }

  get armConfigured(): boolean {
    return Boolean(this.config.get('AZURE_SUBSCRIPTION_ID') && this.config.get('AZURE_RESOURCE_GROUP'));
  }

  resourceId(kind: 'app' | 'postgres'): string | null {
    const sub = this.config.get('AZURE_SUBSCRIPTION_ID');
    const rg = this.config.get('AZURE_RESOURCE_GROUP');
    if (!sub || !rg) return null;
    if (kind === 'app') {
      const app = this.config.get('AZURE_APP_SERVICE_NAME');
      return app ? `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Web/sites/${app}` : null;
    }
    const pg = this.config.get('AZURE_POSTGRES_SERVER_NAME');
    return pg ? `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${pg}` : null;
  }

  private async request<T>(scope: string, url: string, init: RequestInit = {}): Promise<T> {
    return this.telemetry.measure('azure.api', 'Azure', new URL(url).host, async () => {
      const token = await this.cred().getToken(scope);
      if (!token) throw new AzureApiError(401, 'NO_TOKEN');
      const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token.token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
        throw new AzureApiError(res.status, body.error?.code ?? res.statusText);
      }
      return (await res.json()) as T;
    });
  }

  arm<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>('https://management.azure.com/.default', `https://management.azure.com${path}`, init);
  }

  /** Azure Monitor platform metrics of a resource (e.g. Requests, Http5xx, cpu_percent). */
  async metrics(resourceId: string, names: string[], timespan = 'PT6H', interval = 'PT15M') {
    type MetricsResponse = { value: { name: { value: string; localizedValue: string }; unit: string; timeseries: { data: { timeStamp: string; total?: number; average?: number; maximum?: number }[] }[] }[] };
    const qs = new URLSearchParams({ 'api-version': '2023-10-01', metricnames: names.join(','), timespan, interval, aggregation: 'Total,Average,Maximum' });
    const r = await this.arm<MetricsResponse>(`${resourceId}/providers/microsoft.insights/metrics?${qs.toString()}`);
    return r.value.map((m) => ({ name: m.name.value, label: m.name.localizedValue, unit: m.unit, points: (m.timeseries[0]?.data ?? []).map((d) => ({ at: d.timeStamp, total: d.total ?? null, average: d.average ?? null, maximum: d.maximum ?? null })) }));
  }

  /** Resource Health availability (Available / Degraded / Unavailable / Unknown). */
  async resourceHealth(resourceId: string): Promise<{ state: string; summary: string | null }> {
    type Health = { properties?: { availabilityState?: string; summary?: string } };
    const r = await this.arm<Health>(`${resourceId}/providers/Microsoft.ResourceHealth/availabilityStatuses/current?api-version=2022-10-01`);
    return { state: r.properties?.availabilityState ?? 'Unknown', summary: r.properties?.summary ?? null };
  }

  /** Workspace-based Application Insights / App Service logs through Log Analytics (KQL). */
  async logQuery(kql: string, timespan: string) {
    const ws = this.config.get('AZURE_LOG_ANALYTICS_WORKSPACE_ID');
    if (!ws) throw new AzureApiError(0, 'NOT_CONFIGURED');
    type Res = { tables: { columns: { name: string }[]; rows: unknown[][] }[] };
    const r = await this.request<Res>('https://api.loganalytics.io/.default', `https://api.loganalytics.io/v1/workspaces/${ws}/query`, { method: 'POST', body: JSON.stringify({ query: kql, timespan }) });
    const t = r.tables[0];
    return (t?.rows ?? []).map((row) => Object.fromEntries(t.columns.map((c, i) => [c.name, row[i]])));
  }

  /** Month-to-date actual cost by service (needs Cost Management Reader on the resource group). */
  async costByService() {
    const sub = this.config.get('AZURE_SUBSCRIPTION_ID');
    const rg = this.config.get('AZURE_RESOURCE_GROUP');
    type Res = { properties: { columns: { name: string }[]; rows: (string | number)[][] } };
    const body = { type: 'ActualCost', timeframe: 'MonthToDate', dataset: { granularity: 'None', aggregation: { totalCost: { name: 'Cost', function: 'Sum' } }, grouping: [{ type: 'Dimension', name: 'ServiceName' }] } };
    const r = await this.arm<Res>(`/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`, { method: 'POST', body: JSON.stringify(body) });
    const cols = r.properties.columns.map((c) => c.name);
    return r.properties.rows.map((row) => ({ service: String(row[cols.indexOf('ServiceName')]), cost: Number(row[cols.indexOf('Cost')]), currency: String(row[cols.indexOf('Currency')] ?? '') }));
  }

  /** Key Vault secret METADATA only (names, versions, expiry) — values are never read or returned. */
  async secretsMetadata(): Promise<SecretMeta[]> {
    const url = this.config.get('AZURE_KEY_VAULT_URL');
    if (!url) throw new AzureApiError(0, 'NOT_CONFIGURED');
    return this.telemetry.measure('keyvault.list', 'Azure', new URL(url).host, async () => {
      const client = new SecretClient(url, this.cred());
      const out: SecretMeta[] = [];
      for await (const s of client.listPropertiesOfSecrets()) {
        let versions = 0;
        for await (const _v of client.listPropertiesOfSecretVersions(s.name)) {
          void _v;
          versions += 1;
          if (versions >= 25) break;
        }
        out.push({
          name: s.name,
          enabled: s.enabled ?? null,
          contentType: s.contentType ?? null,
          createdOn: s.createdOn?.toISOString() ?? null,
          updatedOn: s.updatedOn?.toISOString() ?? null,
          expiresOn: s.expiresOn?.toISOString() ?? null,
          versions,
          daysToExpiry: s.expiresOn ? Math.floor((s.expiresOn.getTime() - Date.now()) / 86_400_000) : null,
        });
        if (out.length >= 50) break;
      }
      return out;
    });
  }
}
