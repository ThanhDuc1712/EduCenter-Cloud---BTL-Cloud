// EduCenter Cloud — hạ tầng Azure môi trường demo (P0-11, D-02, D-17, D-25, D-07)
// Phạm vi: resource group. Triển khai:
//   az deployment group what-if  -g rg-educenter-demo --parameters infra/azure/demo.bicepparam
//   az deployment group create   -g rg-educenter-demo --parameters infra/azure/demo.bicepparam
// Không chứa secret. Mật khẩu admin PostgreSQL đọc từ biến môi trường lúc deploy.

targetScope = 'resourceGroup'

@description('Vùng Azure. Phải nằm trong "Allowed resource deployment regions" của subscription Azure for Students.')
param location string = resourceGroup().location

@description('Hậu tố ngắn (3–6 ký tự thường/số) để tên toàn cục không trùng.')
@minLength(3)
@maxLength(6)
param suffix string

@description('SKU App Service plan. B1 có Always On; F1 miễn phí nhưng không có Always On.')
@allowed(['F1', 'B1', 'B2', 'B3', 'S1', 'P0v3', 'P1v3'])
param appServiceSku string = 'F1'

@description('Số instance App Service (demo = 1; W1/W2 có thể tăng theo D-08).')
param appServiceCapacity int = 1

@description('Runtime Linux. Kiểm bằng: az webapp list-runtimes --os-type linux')
param linuxFxVersion string = 'NODE|24-lts'

@description('SKU PostgreSQL. Standard_B1ms thuộc meter miễn phí 750 giờ/tháng (nếu offer áp dụng).')
param pgSkuName string = 'Standard_B1ms'
@allowed(['Burstable', 'GeneralPurpose', 'MemoryOptimized'])
param pgTier string = 'Burstable'
@allowed(['16', '17'])
param pgVersion string = '16'
param pgStorageGB int = 32
param pgAdminLogin string = 'eduadmin'
@secure()
param pgAdminPassword string

@description('Object ID của người vận hành (Giang) để được ghi secret vào hai Key Vault.')
param operatorObjectId string

@description('Repo GitHub dạng owner/repo cho OIDC của pipeline (Doanh).')
param githubRepo string = 'ThanhDuc1712/EduCenter-Cloud---BTL-Cloud'
@description('Tên GitHub Environment mà job deploy dùng (Doanh xác nhận).')
param githubEnvironment string = 'demo'
@description('Subject OIDC dạng có ID mà GitHub gửi cho repo này (thấy trong lỗi AADSTS700213 ngày 27/11). Để trống = không tạo.')
param githubOidcIdSubject string = 'repo:ThanhDuc1712@200977746/EduCenter-Cloud---BTL-Cloud@1460195731:environment:demo'

// ---------- Cấu hình ứng dụng (không có secret; secret đọc từ Key Vault runtime) ----------
@description('Origin công khai của app, ví dụ https://<default-domain>. Trống = https://app-educenter-<suffix>.azurewebsites.net.')
param appOrigin string = ''
@allowed(['fatal', 'error', 'warn', 'log', 'debug', 'verbose'])
param logLevel string = 'log'
@description('Key ID đang dùng trong secret callback-hmac-keys (docs/runbooks/hmac-rotation.md).')
param callbackHmacActiveKeyId string = 'k1'
@description('CIDR được gọi /api/v1/cloud/* ở production, phân tách bằng dấu phẩy. Trống = chặn.')
param opsAllowedCidrs string = ''
@description('Để trống cả hai bucket = app chạy storage/processing LOCAL (mô phỏng).')
param ossQuarantineBucket string = ''
param ossPublishedBucket string = ''
param aliyunRegion string = 'ap-southeast-1'
param fcFunctionName string = 'material-processor'
param slsProject string = ''
param slsLogstore string = 'fc-material-processor'

param logRetentionDays int = 30
param tags object = {
  project: 'educenter'
  env: 'demo'
  owner: 'cloud-giang'
}

var short = toLower(suffix)
var names = {
  law: 'log-educenter-${short}'
  appi: 'appi-educenter-${short}'
  kvRuntime: 'kv-edu-rt-${short}'
  kvOps: 'kv-edu-ops-${short}'
  plan: 'asp-educenter-${short}'
  app: 'app-educenter-${short}'
  pg: 'pg-educenter-${short}'
  deployId: 'id-educenter-deploy-${short}'
}

// ---------- App settings ----------
// Template này thay TOÀN BỘ app settings khi deploy: mọi biến app cần phải khai báo ở đây.
var appPort = '8080'
var origin = empty(appOrigin) ? 'https://${names.app}.azurewebsites.net' : appOrigin
var useOss = !empty(ossQuarantineBucket) && !empty(ossPublishedBucket)
var kvRef = '@Microsoft.KeyVault(VaultName=${names.kvRuntime};SecretName='
var baseAppSettings = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'PORT', value: appPort }
  { name: 'APP_ORIGIN', value: origin }
  { name: 'LOG_LEVEL', value: logLevel }
  { name: 'TRUST_PROXY_HOPS', value: '1' }
  { name: 'DB_CONNECTION_LIMIT', value: '5' }
  { name: 'DATABASE_URL', value: '${kvRef}db-runtime-url)' }
  { name: 'DEMO_CONTEXT_SECRET', value: '${kvRef}demo-context-secret)' }
  { name: 'AUTH_MODE', value: 'session' }
  // Graded demo: no public self-registration (QA SEC-16); accounts come from the seed only.
  { name: 'REGISTRATION_ENABLED', value: 'false' }
  { name: 'CALLBACK_HMAC_KEYS', value: '${kvRef}callback-hmac-keys)' }
  { name: 'CALLBACK_HMAC_ACTIVE_KEY_ID', value: callbackHmacActiveKeyId }
  { name: 'INTERNAL_BASE_URL', value: 'http://127.0.0.1:${appPort}' }
  { name: 'WEB_DIST_DIR', value: '../web/dist' }
  { name: 'OPS_ALLOWED_CIDRS', value: opsAllowedCidrs }
  { name: 'STORAGE_PROVIDER', value: useOss ? 'oss' : 'local' }
  { name: 'PROCESSING_PROVIDER', value: useOss ? 'aliyun-fc' : 'local' }
  { name: 'LOCAL_STORAGE_DIR', value: '/home/data/educenter' }
  { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
]
var aliyunAppSettings = [
  { name: 'ALIYUN_REGION', value: aliyunRegion }
  { name: 'OSS_QUARANTINE_BUCKET', value: ossQuarantineBucket }
  { name: 'OSS_PUBLISHED_BUCKET', value: ossPublishedBucket }
  { name: 'OSS_ACCESS_KEY_ID', value: '${kvRef}oss-api-access-key-id)' }
  { name: 'OSS_ACCESS_KEY_SECRET', value: '${kvRef}oss-api-access-key-secret)' }
  { name: 'ALIYUN_FC_FUNCTION_NAME', value: fcFunctionName }
  { name: 'ALIYUN_SLS_PROJECT', value: slsProject }
  { name: 'ALIYUN_SLS_LOGSTORE', value: slsLogstore }
]

// Role definition ID built-in (Azure RBAC)
var roleKvReader = '4633458b-17de-408a-b874-0445c86b69e6' // built-in role ID (public)
var roleKvWriter = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7' // built-in role ID (public)
var roleWebsiteContributor = 'de139f84-1756-47ae-9be6-808fbbe84772'
var roleContributor = 'b24988ac-6180-42a0-ab88-20f7382dd24c'
var roleMonitoringReader = '43d0d8ad-25c7-4714-9337-8ba259a9fe05'
var roleCostReader = '72fafb9e-0641-4937-9268-a91bfd8191a3'

// ---------- Quan sát ----------
resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: names.law
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: logRetentionDays
    workspaceCapping: { dailyQuotaGb: 1 } // chặn ingest vượt 1 GB/ngày để giữ credit
  }
}

resource appi 'Microsoft.Insights/components@2020-02-02' = {
  name: names.appi
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: law.id
    IngestionMode: 'LogAnalytics'
    DisableIpMasking: false
  }
}

// ---------- Key Vault: tách runtime và vận hành ----------
// kv runtime: chỉ secret app cần lúc chạy (db-runtime-url, oss-api-*, callback-hmac-*). App MI chỉ đọc vault này.
// kv ops: db-migrator-url, pg-admin-password. Chỉ pipeline migration + người vận hành đọc.
resource kvRuntime 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: names.kvRuntime
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
  }
}

resource kvOps 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: names.kvOps
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
  }
}

resource pgAdminSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kvOps
  name: 'pg-admin-password'
  properties: { value: pgAdminPassword }
}

// ---------- App Service ----------
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: names.plan
  location: location
  tags: tags
  kind: 'linux'
  sku: {
    name: appServiceSku
    capacity: appServiceCapacity
  }
  properties: { reserved: true }
}

resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: names.app
  location: location
  tags: tags
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: linuxFxVersion
      appCommandLine: 'cd apps/api && node dist/main.js'
      alwaysOn: appServiceSku != 'F1'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      // F1 (miễn phí) dùng trong lúc chờ app; health check bật khi nâng lên B1
      healthCheckPath: appServiceSku == 'F1' ? null : '/api/v1/health'
      appSettings: concat(
        baseAppSettings,
        useOss ? aliyunAppSettings : [],
        [ { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appi.properties.ConnectionString } ],
        // Cloud Operations dashboard: read-only checks with the app's Managed Identity
        // (Key Vault metadata, Azure Monitor metrics, resource health, Log Analytics, cost).
        [
          { name: 'AZURE_KEY_VAULT_URL', value: kvRuntime.properties.vaultUri }
          { name: 'AZURE_SUBSCRIPTION_ID', value: subscription().subscriptionId }
          { name: 'AZURE_RESOURCE_GROUP', value: resourceGroup().name }
          { name: 'AZURE_APP_SERVICE_NAME', value: names.app }
          { name: 'AZURE_POSTGRES_SERVER_NAME', value: names.pg }
          { name: 'AZURE_LOG_ANALYTICS_WORKSPACE_ID', value: law.properties.customerId }
        ]
      )
    }
  }
}

// App MI chỉ ĐỌC số liệu giám sát và chi phí trong resource group (trang Cloud Operations)
resource appMonitoringReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, app.id, roleMonitoringReader)
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleMonitoringReader)
  }
}

resource appCostReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, app.id, roleCostReader)
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleCostReader)
  }
}

// App MI chỉ được ĐỌC secret của vault runtime
resource appReadsRuntimeKv 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kvRuntime.id, app.id, roleKvReader)
  scope: kvRuntime
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKvReader)
  }
}

// Người vận hành được ghi secret ở cả hai vault
resource operatorRuntimeKv 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kvRuntime.id, operatorObjectId, roleKvWriter)
  scope: kvRuntime
  properties: {
    principalId: operatorObjectId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKvWriter)
  }
}

resource operatorOpsKv 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kvOps.id, operatorObjectId, roleKvWriter)
  scope: kvOps
  properties: {
    principalId: operatorObjectId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKvWriter)
  }
}

// ---------- PostgreSQL Flexible Server ----------
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: names.pg
  location: location
  tags: tags
  sku: {
    name: pgSkuName
    tier: pgTier
  }
  properties: {
    version: pgVersion
    administratorLogin: pgAdminLogin
    administratorLoginPassword: pgAdminPassword // gitleaks:allow (tham số @secure, không phải giá trị)
    storage: {
      storageSizeGB: pgStorageGB
      autoGrow: 'Disabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
    authConfig: {
      activeDirectoryAuth: 'Disabled'
      passwordAuth: 'Enabled'
    }
  }
}

resource pgRequireTls 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: pg
  name: 'require_secure_transport'
  properties: {
    value: 'ON'
    source: 'user-override'
  }
}

// Database 'educenter' do scripts/bootstrap_db.py tạo bằng tài khoản admin (để admin là owner
// và cấp được quyền schema cho edu_migrator/edu_runtime).
// Firewall: KHÔNG tạo rule 0.0.0.0 ("Allow Azure services"). Rule IP cụ thể thêm bằng
// infra/azure/scripts/set-pg-firewall.ps1 vì outbound IP của Web App chỉ biết sau khi tạo.

// ---------- OIDC cho GitHub Actions (D-07) ----------
// Dùng user-assigned managed identity + federated credential: không cần quyền tạo App registration
// trong tenant trường (thường bị chặn với tài khoản sinh viên).
resource deployId 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: names.deployId
  location: location
  tags: tags
}

resource deployFic 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: deployId
  name: 'github-${githubEnvironment}'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${githubRepo}:environment:${githubEnvironment}'
    audiences: ['api://AzureADTokenExchange']
  }
}

// GitHub gửi subject kèm ID owner/repo; giữ cả dạng tên ở trên để tương thích.
// Azure không cho ghi song song 2 federated credential trên cùng identity, nên phụ thuộc deployFic.
resource deployFicIds 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = if (!empty(githubOidcIdSubject)) {
  parent: deployId
  name: 'github-demo-idsubject'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: githubOidcIdSubject
    audiences: ['api://AzureADTokenExchange']
  }
  dependsOn: [deployFic]
}

resource deployWebApp 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(app.id, deployId.id, roleWebsiteContributor)
  scope: app
  properties: {
    principalId: deployId.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleWebsiteContributor)
  }
}

// Cần để job migration thêm/xóa firewall rule tạm (D-25). Phạm vi chỉ server PG.
resource deployPgFirewall 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(pg.id, deployId.id, roleContributor)
  scope: pg
  properties: {
    principalId: deployId.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleContributor)
  }
}

resource deployReadsOpsKv 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kvOps.id, deployId.id, roleKvReader)
  scope: kvOps
  properties: {
    principalId: deployId.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKvReader)
  }
}

// ---------- Azure Monitor: cảnh báo qua email (action group tạo ở P0-02) ----------
@description('Tên action group đã có trong RG (tạo tay ở P0-02). Để trống = không tạo cảnh báo.')
param alertActionGroupName string = 'ag-educenter-email'

var alertsEnabled = !empty(alertActionGroupName)

// Tham chiếu theo ID (action group có sẵn, không do template này quản lý)
var alertActionGroupId = resourceId('Microsoft.Insights/actionGroups', alertActionGroupName)

// App trả lỗi 5xx: tổng > 5 trong 5 phút
resource alertHttp5xx 'Microsoft.Insights/metricAlerts@2018-03-01' = if (alertsEnabled) {
  name: 'alert-${names.app}-http5xx'
  location: 'global'
  tags: tags
  properties: {
    description: 'EduCenter: App Service trả lỗi 5xx (> 5 trong 5 phút)'
    severity: 2
    enabled: true
    scopes: [app.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'Http5xx'
          metricNamespace: 'Microsoft.Web/sites'
          metricName: 'Http5xx'
          operator: 'GreaterThan'
          threshold: 5
          timeAggregation: 'Total'
        }
      ]
    }
    actions: [{ actionGroupId: alertActionGroupId }]
  }
}

// Health check của App Service (chỉ có trên gói khác F1): trung bình < 100% trong 5 phút
resource alertHealth 'Microsoft.Insights/metricAlerts@2018-03-01' = if (alertsEnabled && appServiceSku != 'F1') {
  name: 'alert-${names.app}-health'
  location: 'global'
  tags: tags
  properties: {
    description: 'EduCenter: /api/v1/health không ổn định (HealthCheckStatus < 100)'
    severity: 1
    enabled: true
    scopes: [app.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'HealthCheckStatus'
          metricNamespace: 'Microsoft.Web/sites'
          metricName: 'HealthCheckStatus'
          operator: 'LessThan'
          threshold: 100
          timeAggregation: 'Average'
        }
      ]
    }
    actions: [{ actionGroupId: alertActionGroupId }]
  }
}

// PostgreSQL: dung lượng > 80%
resource alertPgStorage 'Microsoft.Insights/metricAlerts@2018-03-01' = if (alertsEnabled) {
  name: 'alert-${names.pg}-storage'
  location: 'global'
  tags: tags
  properties: {
    description: 'EduCenter: PostgreSQL dùng > 80% dung lượng'
    severity: 2
    enabled: true
    scopes: [pg.id]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT30M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'StoragePercent'
          metricNamespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
          metricName: 'storage_percent'
          operator: 'GreaterThan'
          threshold: 80
          timeAggregation: 'Average'
        }
      ]
    }
    actions: [{ actionGroupId: alertActionGroupId }]
  }
}

// ---------- Output (không có secret) ----------
output webAppName string = app.name
output webAppDefaultHostName string = app.properties.defaultHostName
output webAppPrincipalId string = app.identity.principalId
output keyVaultRuntimeName string = kvRuntime.name
output keyVaultOpsName string = kvOps.name
output postgresServerName string = pg.name
output postgresFqdn string = pg.properties.fullyQualifiedDomainName
output appInsightsName string = appi.name
output logAnalyticsName string = law.name
output deployIdentityClientId string = deployId.properties.clientId
output deployIdentityName string = deployId.name
output oidcSubject string = deployFic.properties.subject
