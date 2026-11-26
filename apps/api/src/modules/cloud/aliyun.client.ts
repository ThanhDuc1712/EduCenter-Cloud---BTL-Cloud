import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { AppConfigService } from '../../common/config/app-config.service';
import { TelemetryService } from '../../common/observability/telemetry.service';

export class AliyunApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Aliyun API ${status} ${code}`);
    this.name = 'AliyunApiError';
  }
}

/** RFC 3986 percent-encoding required by Alibaba Cloud RPC signatures. */
export function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Signature v1 (HMAC-SHA1) for RPC-style OpenAPI (CloudMonitor, BSS). Exported for unit tests. */
export function signRpc(params: Record<string, string>, secret: string): string {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonical)}`;
  return createHmac('sha1', `${secret}&`).update(stringToSign).digest('base64');
}

/** SLS request signature (LOG <ak>:<sig>), exported for unit tests. */
export function signSls(method: string, resource: string, query: Record<string, string>, headers: Record<string, string>, secret: string): string {
  const logHeaders = Object.keys(headers)
    .filter((h) => h.startsWith('x-log-') || h.startsWith('x-acs-'))
    .sort()
    .map((h) => `${h}:${headers[h]}`)
    .join('\n');
  const qs = Object.keys(query)
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join('&');
  const stringToSign = [method, headers['content-md5'] ?? '', headers['content-type'] ?? '', headers.date, logHeaders, `${resource}${qs ? `?${qs}` : ''}`].join('\n');
  return createHmac('sha1', secret).update(stringToSign).digest('base64');
}

/**
 * Read-only Alibaba Cloud queries for the operations dashboard, signed with a dedicated read-only
 * RAM user (AliyunLogReadOnlyAccess + AliyunCloudMonitorReadOnlyAccess [+ AliyunBSSReadOnlyAccess]).
 * Never used for the data path, never the root account.
 */
@Injectable()
export class AliyunClient {
  constructor(
    private readonly config: AppConfigService,
    private readonly telemetry: TelemetryService,
  ) {}

  private creds(): { id: string; secret: string } | null {
    const id = this.config.get('ALIYUN_READONLY_ACCESS_KEY_ID');
    const secret = this.config.get('ALIYUN_READONLY_ACCESS_KEY_SECRET');
    return id && secret ? { id, secret } : null;
  }

  get slsConfigured(): boolean {
    return Boolean(this.creds() && this.config.get('ALIYUN_REGION') && this.config.get('ALIYUN_SLS_PROJECT') && this.config.get('ALIYUN_SLS_LOGSTORE'));
  }

  get monitorConfigured(): boolean {
    return Boolean(this.creds() && this.config.get('ALIYUN_REGION'));
  }

  private async rpc<T>(host: string, version: string, action: string, extra: Record<string, string>): Promise<T> {
    const c = this.creds();
    if (!c) throw new AliyunApiError(0, 'NOT_CONFIGURED');
    const params: Record<string, string> = {
      Format: 'JSON',
      Version: version,
      AccessKeyId: c.id,
      SignatureMethod: 'HMAC-SHA1',
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      SignatureVersion: '1.0',
      SignatureNonce: randomUUID(),
      Action: action,
      ...extra,
    };
    const signature = signRpc(params, c.secret);
    const qs = Object.keys(params)
      .sort()
      .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
      .join('&');
    return this.telemetry.measure(`aliyun.${action}`, 'Aliyun', host, async () => {
      const res = await fetch(`https://${host}/?${qs}&Signature=${percentEncode(signature)}`, { signal: AbortSignal.timeout(15_000) });
      const body = (await res.json().catch(() => ({}))) as T & { Code?: string };
      if (!res.ok || (body.Code && body.Code !== '200' && body.Code !== 'Success')) throw new AliyunApiError(res.status, body.Code ?? res.statusText);
      return body;
    });
  }

  /** CloudMonitor DescribeMetricList (e.g. namespace acs_fc). */
  async metricList(namespace: string, metricName: string, dimensions: Record<string, string>, minutes = 360, period = 300) {
    type Res = { Datapoints?: string };
    const end = Date.now();
    const r = await this.rpc<Res>('metrics.aliyuncs.com', '2019-01-01', 'DescribeMetricList', {
      Namespace: namespace,
      MetricName: metricName,
      Dimensions: JSON.stringify([dimensions]),
      Period: String(period),
      StartTime: String(end - minutes * 60_000),
      EndTime: String(end),
    });
    const points = JSON.parse(r.Datapoints ?? '[]') as { timestamp: number; Average?: number; Sum?: number; Value?: number; Maximum?: number }[];
    return points.map((p) => ({ at: new Date(p.timestamp).toISOString(), value: p.Sum ?? p.Value ?? p.Average ?? 0, average: p.Average ?? null, maximum: p.Maximum ?? null }));
  }

  /** CloudMonitor alarm rules (DescribeMetricRuleList) for the FC namespace. */
  async alarmRules(namespace: string) {
    type Res = { Alarms?: { Alarm?: { RuleName: string; MetricName: string; AlertState?: string; EnableState?: boolean }[] } };
    const r = await this.rpc<Res>('metrics.aliyuncs.com', '2019-01-01', 'DescribeMetricRuleList', { Namespace: namespace, PageSize: '50' });
    return (r.Alarms?.Alarm ?? []).map((a) => ({ name: a.RuleName, metric: a.MetricName, state: a.AlertState ?? 'UNKNOWN', enabled: a.EnableState ?? null }));
  }

  /** BSS QueryBillOverview for the current month (needs AliyunBSSReadOnlyAccess). */
  async billOverview(cycle: string) {
    type Res = { Data?: { Items?: { Item?: { ProductName: string; ProductCode: string; PretaxAmount: number; Currency: string }[] } } };
    const r = await this.rpc<Res>('business.ap-southeast-1.aliyuncs.com', '2017-12-14', 'QueryBillOverview', { BillingCycle: cycle });
    return (r.Data?.Items?.Item ?? []).map((i) => ({ service: i.ProductName || i.ProductCode, cost: Number(i.PretaxAmount), currency: i.Currency }));
  }

  /** SLS GetLogs on the Function Compute logstore. */
  async slsLogs(query: string, fromSec: number, toSec: number, line = 100) {
    const c = this.creds();
    const region = this.config.get('ALIYUN_REGION');
    const project = this.config.get('ALIYUN_SLS_PROJECT');
    const logstore = this.config.get('ALIYUN_SLS_LOGSTORE');
    if (!c || !region || !project || !logstore) throw new AliyunApiError(0, 'NOT_CONFIGURED');
    const host = `${project}.${region}.log.aliyuncs.com`;
    const resource = `/logstores/${logstore}`;
    const q: Record<string, string> = { type: 'log', from: String(fromSec), to: String(toSec), query, line: String(line), offset: '0', reverse: 'true' };
    const headers: Record<string, string> = { date: new Date().toUTCString(), 'x-log-apiversion': '0.6.0', 'x-log-signaturemethod': 'hmac-sha1', 'x-log-bodyrawsize': '0' };
    const auth = `LOG ${c.id}:${signSls('GET', resource, q, headers, c.secret)}`;
    return this.telemetry.measure('aliyun.sls.getlogs', 'Aliyun', host, async () => {
      const res = await fetch(`https://${host}${resource}?${new URLSearchParams(q).toString()}`, { headers: { ...headers, host, authorization: auth }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { errorCode?: string };
        throw new AliyunApiError(res.status, body.errorCode ?? res.statusText);
      }
      return (await res.json()) as Record<string, string>[];
    });
  }
}
