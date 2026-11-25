// EduCenter Cloud — Azure demo environment (D-02, D-17). Deployed by scripts/windows/deploy-azure.ps1.
// Creates billable resources: only deploy after explicit confirmation.
// Secrets never appear here: the app reads them through Key Vault references resolved by the
// App Service system-assigned Managed Identity (role: Key Vault Secrets User).

targetScope = 'resourceGroup'

@description('Short name prefix, lowercase letters/digits (e.g. educenter).')
param prefix string = 'educenter'
param location string = resourceGroup().location
@description('Public hostname of the app, e.g. https://educenter-demo.azurewebsites.net (CORS on OSS, APP_ORIGIN).')
param appOrigin string = ''
@description('PostgreSQL administrator login (bootstrap only; the app uses edu_runtime).')
param pgAdminLogin string = 'eduadmin'
@secure()
param pgAdminPassword string
@description('App Service plan SKU: B1 (demo, Always On) — scale up only for benchmarks (D-08).')
param appServiceSku string = 'B1'
@description('PostgreSQL Flexible Server SKU (Burstable for demo).')
param pgSku string = 'Standard_B1ms'
@description('Alibaba Cloud region / buckets used by the app (non-secret).')
param aliyunRegion string = 'ap-southeast-1'
param ossQuarantineBucket string = ''
param ossPublishedBucket string = ''
param fcFunctionName string = 'educenter-material-processor'
param slsProject string = ''
param slsLogstore string = 'fc-material-processor'
@description('Comma-separated CIDRs allowed to call /api/v1/cloud/* (operations network).')
param opsAllowedCidrs string = ''
@description('Email for alert notifications.')
param alertEmail string = ''

var suffix = uniqueString(resourceGroup().id)
var appName = '${prefix}-app-${suffix}'
var kvName = take('${prefix}kv${suffix}', 24)
var pgName = '${prefix}-pg-${suffix}'
var origin = empty(appOrigin) ? 'https://${appName}.azurewebsites.net' : appOrigin
var kvRef = '@Microsoft.KeyVault(VaultName=${kvName};SecretName='

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs-${suffix}'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${prefix}-ai-${suffix}'
  location: location
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: logs.id, IngestionMode: 'LogAnalytics' }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
  }
}

resource kvDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'kv-audit'
  scope: vault
  properties: {
    workspaceId: logs.id
    logs: [{ category: 'AuditEvent', enabled: true }]
  }
}

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: pgName
  location: location
  sku: { name: pgSku, tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: pgAdminLogin
    administratorLoginPassword: pgAdminPassword
    storage: { storageSizeGB: 32, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
  }
}

resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: 'educenter'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

resource pgTls 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: pg
  name: 'require_secure_transport'
  properties: { value: 'on', source: 'user-override' }
}

// Only Azure services (App Service outbound) by default; the deploy script adds a temporary
// rule for the operator's IP while migrations run and removes it afterwards (D-25).
resource pgFirewallAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: pg
  name: 'allow-azure-services'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource pgDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'pg-logs'
  scope: pg
  properties: {
    workspaceId: logs.id
    logs: [{ category: 'PostgreSQLLogs', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${prefix}-plan-${suffix}'
  location: location
  kind: 'linux'
  sku: { name: appServiceSku }
  properties: { reserved: true }
}

resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    keyVaultReferenceIdentity: 'SystemAssigned'
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      appCommandLine: 'cd apps/api && node dist/main.js'
      alwaysOn: true
      http20Enabled: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      healthCheckPath: '/api/v1/health'
      appSettings: [
        { name: 'NODE_ENV', value: 'production' }
        { name: 'PORT', value: '8080' }
        { name: 'WEBSITES_PORT', value: '8080' }
        { name: 'TRUST_PROXY_HOPS', value: '1' }
        { name: 'APP_ORIGIN', value: origin }
        { name: 'WEB_DIST_DIR', value: '../web/dist' }
        { name: 'DATABASE_URL', value: '${kvRef}database-url)' }
        { name: 'DB_CONNECTION_LIMIT', value: '10' }
        { name: 'DEMO_MODE', value: 'true' }
        { name: 'DEMO_TENANT_SLUG', value: 'hanoi-center' }
        { name: 'DEMO_CONTEXT_SECRET', value: '${kvRef}demo-context-secret)' }
        { name: 'CALLBACK_HMAC_KEYS', value: '${kvRef}callback-hmac-keys)' }
        { name: 'CALLBACK_HMAC_ACTIVE_KEY_ID', value: 'k1' }
        { name: 'STORAGE_PROVIDER', value: empty(ossQuarantineBucket) ? 'local' : 'oss' }
        { name: 'PROCESSING_PROVIDER', value: empty(ossQuarantineBucket) ? 'local' : 'aliyun-fc' }
        { name: 'ALIYUN_REGION', value: aliyunRegion }
        { name: 'OSS_QUARANTINE_BUCKET', value: ossQuarantineBucket }
        { name: 'OSS_PUBLISHED_BUCKET', value: ossPublishedBucket }
        { name: 'OSS_ACCESS_KEY_ID', value: '${kvRef}oss-access-key-id)' }
        { name: 'OSS_ACCESS_KEY_SECRET', value: '${kvRef}oss-access-key-secret)' }
        { name: 'ALIYUN_FC_FUNCTION_NAME', value: fcFunctionName }
        { name: 'ALIYUN_SLS_PROJECT', value: slsProject }
        { name: 'ALIYUN_SLS_LOGSTORE', value: slsLogstore }
        { name: 'ALIYUN_READONLY_ACCESS_KEY_ID', value: '${kvRef}aliyun-readonly-access-key-id)' }
        { name: 'ALIYUN_READONLY_ACCESS_KEY_SECRET', value: '${kvRef}aliyun-readonly-access-key-secret)' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
        { name: 'AZURE_KEY_VAULT_URL', value: vault.properties.vaultUri }
        { name: 'AZURE_SUBSCRIPTION_ID', value: subscription().subscriptionId }
        { name: 'AZURE_RESOURCE_GROUP', value: resourceGroup().name }
        { name: 'AZURE_APP_SERVICE_NAME', value: appName }
        { name: 'AZURE_POSTGRES_SERVER_NAME', value: pgName }
        { name: 'AZURE_LOG_ANALYTICS_WORKSPACE_ID', value: logs.properties.customerId }
        { name: 'OPS_ALLOWED_CIDRS', value: opsAllowedCidrs }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
      ]
    }
  }
}

resource appLogs 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: app
  name: 'logs'
  properties: {
    applicationLogs: { fileSystem: { level: 'Information' } }
    httpLogs: { fileSystem: { enabled: true, retentionInDays: 3, retentionInMb: 35 } }
  }
}

resource appDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'app-logs'
  scope: app
  properties: {
    workspaceId: logs.id
    logs: [{ category: 'AppServiceConsoleLogs', enabled: true }, { category: 'AppServiceHTTPLogs', enabled: true }, { category: 'AppServicePlatformLogs', enabled: true }]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

// Managed Identity → Key Vault Secrets User (read secrets only).
var secretsUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
resource kvAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, app.id, secretsUserRole)
  scope: vault
  properties: { roleDefinitionId: secretsUserRole, principalId: app.identity.principalId, principalType: 'ServicePrincipal' }
}

// Managed Identity → Monitoring Reader on the resource group (Cloud Monitoring page reads Azure Monitor).
var monitoringReaderRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '43d0d8ad-25c7-4714-9337-8ba259a9fe05')
resource monitorAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, app.id, monitoringReaderRole)
  properties: { roleDefinitionId: monitoringReaderRole, principalId: app.identity.principalId, principalType: 'ServicePrincipal' }
}

// Managed Identity → Log Analytics Reader (Cloud Logs page queries the workspace).
var logReaderRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '73c42c96-874c-492b-b04d-ab87d138a893')
resource logAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(logs.id, app.id, logReaderRole)
  scope: logs
  properties: { roleDefinitionId: logReaderRole, principalId: app.identity.principalId, principalType: 'ServicePrincipal' }
}

// ───── Alerts (Azure Monitor) ─────
resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = if (!empty(alertEmail)) {
  name: '${prefix}-ops'
  location: 'global'
  properties: { groupShortName: 'eduops', enabled: true, emailReceivers: [{ name: 'ops', emailAddress: alertEmail, useCommonAlertSchema: true }] }
}

var actions = empty(alertEmail) ? [] : [{ actionGroupId: actionGroup.id }]

resource alert5xx 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${prefix}-http5xx'
  location: 'global'
  properties: {
    description: 'API returns 5xx (> 5 in 5 minutes)'
    severity: 2
    enabled: true
    scopes: [app.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: { 'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria', allOf: [{ name: 'http5xx', metricName: 'Http5xx', operator: 'GreaterThan', threshold: 5, timeAggregation: 'Total', criterionType: 'StaticThresholdCriterion' }] }
    actions: actions
  }
}

resource alertHealth 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${prefix}-health'
  location: 'global'
  properties: {
    description: 'Health check status below 100% (instance or database unhealthy)'
    severity: 1
    enabled: true
    scopes: [app.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: { 'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria', allOf: [{ name: 'health', metricName: 'HealthCheckStatus', operator: 'LessThan', threshold: 100, timeAggregation: 'Average', criterionType: 'StaticThresholdCriterion' }] }
    actions: actions
  }
}

resource alertPgCpu 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${prefix}-pg-cpu'
  location: 'global'
  properties: {
    description: 'PostgreSQL CPU > 80% for 10 minutes'
    severity: 3
    enabled: true
    scopes: [pg.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: { 'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria', allOf: [{ name: 'cpu', metricName: 'cpu_percent', operator: 'GreaterThan', threshold: 80, timeAggregation: 'Average', criterionType: 'StaticThresholdCriterion' }] }
    actions: actions
  }
}

resource availability 'Microsoft.Insights/webtests@2022-06-15' = {
  name: '${prefix}-availability'
  location: location
  kind: 'standard'
  tags: { 'hidden-link:${insights.id}': 'Resource' }
  properties: {
    SyntheticMonitorId: '${prefix}-availability'
    Name: 'EduCenter readiness'
    Enabled: true
    Frequency: 300
    Timeout: 30
    Kind: 'standard'
    RetryEnabled: true
    Locations: [{ Id: 'apac-sg-sin-azr' }, { Id: 'apac-hk-hkn-azr' }]
    Request: { RequestUrl: '${origin}/api/v1/health', HttpVerb: 'GET' }
    ValidationRules: { ExpectedHttpStatusCode: 200, SSLCheck: true }
  }
}

output appName string = appName
output appUrl string = origin
output keyVaultName string = kvName
output postgresServer string = pg.properties.fullyQualifiedDomainName
output postgresName string = pgName
output appPrincipalId string = app.identity.principalId
