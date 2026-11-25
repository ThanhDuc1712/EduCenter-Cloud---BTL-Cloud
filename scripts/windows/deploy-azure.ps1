<#
.SYNOPSIS
  Manual deployment of EduCenter Cloud to Azure (no CI/CD): infrastructure (Bicep), Key Vault secrets,
  database roles + migrations, and the app package (API + SPA, same origin) to App Service.

.DESCRIPTION
  CREATES BILLABLE RESOURCES (App Service B1, PostgreSQL Flexible B1ms, Key Vault, Log Analytics,
  Application Insights). The script asks you to type the resource group name before creating anything
  unless -Force is given. Secrets are generated locally and written to Key Vault; they are never printed.
  Alibaba Cloud keys (OSS API user, read-only ops user) are read from the current environment variables
  OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / ALIYUN_READONLY_ACCESS_KEY_ID / ALIYUN_READONLY_ACCESS_KEY_SECRET
  (deploy-aliyun.ps1 sets them) and stored in Key Vault.

  Requires: Azure CLI (az login), Docker Desktop (psql in a container), Node 24 + pnpm.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\deploy-azure.ps1 -ResourceGroup rg-educenter-demo -AlertEmail ops@example.com
  powershell -ExecutionPolicy Bypass -File scripts\windows\deploy-azure.ps1 -PackageOnly      # build the zip only, no Azure calls
  powershell -ExecutionPolicy Bypass -File scripts\windows\deploy-azure.ps1 -ResourceGroup rg-educenter-demo -SkipInfra   # redeploy code only
#>
param(
  [string]$ResourceGroup = 'rg-educenter-demo',
  [string]$Location = 'southeastasia',
  [string]$Prefix = 'educenter',
  [string]$AlertEmail = '',
  [string]$OpsAllowedCidrs = '',
  [string]$OssQuarantineBucket = $env:OSS_QUARANTINE_BUCKET,
  [string]$OssPublishedBucket = $env:OSS_PUBLISHED_BUCKET,
  [string]$SlsProject = $env:ALIYUN_SLS_PROJECT,
  [switch]$SkipInfra,
  [switch]$Seed,
  [switch]$PackageOnly,
  [switch]$Force
)
. (Join-Path $PSScriptRoot 'common.ps1')

function New-DeployPackage {
  Write-Step 'Building shared, web and api'
  Invoke-Native pnpm @('--filter', '@educenter/shared', 'build')
  Invoke-Native pnpm @('--filter', 'web', 'build')
  Invoke-Native pnpm @('--filter', 'api', 'build')

  $stage = Join-Path $RepoRoot '.data\deploy\azure'
  if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
  New-Item -ItemType Directory -Force -Path (Join-Path $stage 'apps\web') | Out-Null
  Write-Step 'Creating a self-contained production install of the API (flat node_modules, no symlinks)'
  Invoke-Native pnpm @('--filter', 'api', 'deploy', '--legacy', '--prod', '--config.node-linker=hoisted', (Join-Path $stage 'apps\api'))
  Copy-Item -Recurse -Force (Join-Path $RepoRoot 'apps\api\dist') (Join-Path $stage 'apps\api\dist')
  Copy-Item -Recurse -Force (Join-Path $RepoRoot 'apps\api\prisma') (Join-Path $stage 'apps\api\prisma')
  Copy-Item -Recurse -Force (Join-Path $RepoRoot 'apps\web\dist') (Join-Path $stage 'apps\web\dist')
  Remove-Item -Recurse -Force (Join-Path $stage 'apps\api\src'), (Join-Path $stage 'apps\api\test') -ErrorAction SilentlyContinue

  $zip = Join-Path $RepoRoot '.data\deploy\educenter-app.zip'
  if (Test-Path $zip) { Remove-Item -Force $zip }
  Invoke-Native tar @('-a', '-c', '-f', $zip, '-C', $stage, '.')
  Write-Ok ("Package: {0} ({1:N1} MB)" -f $zip, ((Get-Item $zip).Length / 1MB))
  return $zip
}

if ($PackageOnly) { New-DeployPackage | Out-Null; exit 0 }

if (-not (Test-CommandExists az)) { throw 'Azure CLI not found: winget install Microsoft.AzureCLI, then az login' }
& az account show --query name -o tsv *> $null
if ($LASTEXITCODE -ne 0) { throw 'Not logged in: run az login' }
$subscription = (& az account show --query name -o tsv)
Write-Ok "Azure subscription: $subscription"

if (-not $SkipInfra) {
  if (-not $Force) {
    Write-Warn2 "This creates BILLABLE resources in '$ResourceGroup' ($Location): App Service B1, PostgreSQL B1ms, Key Vault, Log Analytics, App Insights."
    $answer = Read-Host "Type the resource group name ($ResourceGroup) to continue"
    if ($answer -ne $ResourceGroup) { throw 'Aborted - nothing was created' }
  }

  Write-Step 'Resource group'
  Invoke-Native az @('group', 'create', '-n', $ResourceGroup, '-l', $Location, '-o', 'none')

  $pgAdminPassword = New-RandomSecret 32
  Write-Step 'Deploying infra/azure/main.bicep (several minutes)'
  $deployment = & az deployment group create -g $ResourceGroup -f (Join-Path $RepoRoot 'infra\azure\main.bicep') `
    -p prefix=$Prefix pgAdminPassword=$pgAdminPassword alertEmail=$AlertEmail opsAllowedCidrs=$OpsAllowedCidrs `
       ossQuarantineBucket=$OssQuarantineBucket ossPublishedBucket=$OssPublishedBucket slsProject=$SlsProject `
    --query properties.outputs -o json
  if ($LASTEXITCODE -ne 0) { throw 'Bicep deployment failed' }
  $out = $deployment | ConvertFrom-Json
  $appName = $out.appName.value; $kvName = $out.keyVaultName.value; $pgHost = $out.postgresServer.value; $pgName = $out.postgresName.value

  Write-Step 'Granting the deploying user Key Vault Secrets Officer (to write secrets)'
  $me = & az ad signed-in-user show --query id -o tsv
  $kvId = & az keyvault show -n $kvName --query id -o tsv
  & az role assignment create --assignee-object-id $me --assignee-principal-type User --role 'Key Vault Secrets Officer' --scope $kvId -o none 2>$null
  Start-Sleep -Seconds 20  # RBAC propagation

  Write-Step 'Writing secrets to Key Vault (values are generated locally and never printed)'
  $migratorPw = New-RandomSecret 32; $runtimePw = New-RandomSecret 32
  $secrets = @{
    'pg-admin-password'   = $pgAdminPassword
    'pg-migrator-password' = $migratorPw
    'database-url'        = "postgresql://edu_runtime:$runtimePw@${pgHost}:5432/educenter?sslmode=require"
    'migration-database-url' = "postgresql://edu_migrator:$migratorPw@${pgHost}:5432/educenter?sslmode=require"
    'demo-context-secret' = (New-RandomSecret 48)
    'callback-hmac-keys'  = "k1:$(New-RandomSecret 48)"
  }
  if ($env:OSS_ACCESS_KEY_ID) { $secrets['oss-access-key-id'] = $env:OSS_ACCESS_KEY_ID; $secrets['oss-access-key-secret'] = $env:OSS_ACCESS_KEY_SECRET }
  else { $secrets['oss-access-key-id'] = 'not-configured'; $secrets['oss-access-key-secret'] = 'not-configured' }
  if ($env:ALIYUN_READONLY_ACCESS_KEY_ID) { $secrets['aliyun-readonly-access-key-id'] = $env:ALIYUN_READONLY_ACCESS_KEY_ID; $secrets['aliyun-readonly-access-key-secret'] = $env:ALIYUN_READONLY_ACCESS_KEY_SECRET }
  else { $secrets['aliyun-readonly-access-key-id'] = ''; $secrets['aliyun-readonly-access-key-secret'] = '' }
  $expires = (Get-Date).ToUniversalTime().AddDays(180).ToString('yyyy-MM-ddTHH:mm:ssZ')
  foreach ($name in $secrets.Keys) {
    $tmp = New-TemporaryFile
    try {
      [System.IO.File]::WriteAllText($tmp.FullName, [string]$secrets[$name], (New-Object System.Text.UTF8Encoding($false)))
      Invoke-Native az @('keyvault', 'secret', 'set', '--vault-name', $kvName, '-n', $name, '--file', $tmp.FullName, '--encoding', 'utf-8', '--expires', $expires, '-o', 'none')
    } finally { Remove-Item -Force $tmp.FullName }
  }
  Write-Ok "$($secrets.Count) secrets stored (expire in 180 days - see docs/cloud-security.md for rotation)"

  Write-Step 'Database roles + migrations (temporary firewall rule for this machine)'
  $myIp = (Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 10)
  Invoke-Native az @('postgres', 'flexible-server', 'firewall-rule', 'create', '-g', $ResourceGroup, '-n', $pgName, '-r', 'deploy-temp', '--start-ip-address', $myIp, '--end-ip-address', $myIp, '-o', 'none')
  try {
    $sql = Join-Path $RepoRoot 'infra\azure'
    $env:PGPASSWORD = $pgAdminPassword
    Invoke-Native docker @('run', '--rm', '-e', 'PGPASSWORD', '-v', "${sql}:/sql:ro", 'postgres:16-alpine', 'psql', "host=$pgHost dbname=educenter user=eduadmin sslmode=require", '-v', "migrator_pw=$migratorPw", '-v', "runtime_pw=$runtimePw", '-f', '/sql/postgres-roles.sql')
    Remove-Item Env:\PGPASSWORD
    $env:MIGRATION_DATABASE_URL = $secrets['migration-database-url']
    Invoke-Native pnpm @('--filter', 'api', 'prisma:deploy')
    if ($Seed) { Invoke-Native pnpm @('--filter', 'api', 'db:seed') }
  } finally {
    Remove-Item Env:\MIGRATION_DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    & az postgres flexible-server firewall-rule delete -g $ResourceGroup -n $pgName -r deploy-temp --yes -o none
    Write-Ok 'Temporary firewall rule removed'
  }
} else {
  $appName = & az webapp list -g $ResourceGroup --query "[?starts_with(name, '$Prefix-app-')].name | [0]" -o tsv
  if (-not $appName) { throw "No App Service named $Prefix-app-* in $ResourceGroup" }
}

$zip = New-DeployPackage
Write-Step "Deploying package to App Service $appName"
Invoke-Native az @('webapp', 'deploy', '-g', $ResourceGroup, '-n', $appName, '--src-path', $zip, '--type', 'zip', '--restart', 'true', '-o', 'none')

Write-Step 'Waiting for /api/v1/health'
$url = "https://$appName.azurewebsites.net"
$deadline = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $deadline) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 "$url/api/v1/health"
    if ($r.StatusCode -eq 200) { Write-Ok "Healthy: $url"; exit 0 }
  } catch { Start-Sleep -Seconds 10 }
}
Write-Warn2 "Not healthy after 5 minutes. Logs: az webapp log tail -g $ResourceGroup -n $appName"
exit 1
