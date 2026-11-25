<#
.SYNOPSIS
  Deploys EduCenter Cloud to the Azure resources of infra/azure/main.bicep (names end in -<suffix>).

.DESCRIPTION
  Default: build the app package (API + SPA, same origin) and deploy it to app-educenter-<suffix>.
  -Infra   : first run what-if, ask for confirmation, then deploy main.bicep with demo.bicepparam
             (needs the EDU_* variables, see infra/azure/README.md). The template REPLACES all app settings.
  -Migrate : open a temporary firewall rule for this machine, run prisma migrate deploy as edu_migrator,
             remove the rule.
  The two app secrets (demo-context-secret, callback-hmac-keys) are created in the runtime Key Vault
  when missing; values are generated locally and never printed. Database roles and db-runtime-url come
  from infra/azure/scripts/bootstrap_db.py.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\deploy-azure.ps1 -PackageOnly      # no Azure calls
  powershell -ExecutionPolicy Bypass -File scripts\windows\deploy-azure.ps1 -Suffix gdemo -Migrate
#>
param(
  [string]$ResourceGroup = 'rg-educenter-demo',
  [string]$Suffix = $env:EDU_SUFFIX,
  [string]$CallbackKeyId = 'k1',
  [switch]$Infra,
  [switch]$Migrate,
  [switch]$PackageOnly
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
if (-not $Suffix) { throw 'Pass -Suffix or set $env:EDU_SUFFIX' }
& az account show --query name -o tsv *> $null
if ($LASTEXITCODE -ne 0) { throw 'Not logged in: run az login' }

$appName = "app-educenter-$Suffix"
$kvRuntime = "kv-edu-rt-$Suffix"
$kvOps = "kv-edu-ops-$Suffix"
$pgName = "pg-educenter-$Suffix"

if ($Infra) {
  $paramFile = Join-Path $RepoRoot 'infra\azure\demo.bicepparam'
  Write-Step 'what-if (nothing is changed yet)'
  Invoke-Native az @('deployment', 'group', 'what-if', '-g', $ResourceGroup, '--name', 'educenter-infra', '--parameters', $paramFile)
  $answer = Read-Host "Type the resource group name ($ResourceGroup) to apply these changes (billable)"
  if ($answer -ne $ResourceGroup) { throw 'Aborted - nothing was changed' }
  Invoke-Native az @('deployment', 'group', 'create', '-g', $ResourceGroup, '--name', 'educenter-infra', '--parameters', $paramFile, '-o', 'none')
}

Write-Step 'App secrets in the runtime Key Vault'
function Set-SecretIfMissing([string]$Name, [string]$Value) {
  $found = & az keyvault secret list --vault-name $kvRuntime --query "[?name=='$Name'].name | [0]" -o tsv
  if ($LASTEXITCODE -ne 0) { throw "Cannot list secrets of $kvRuntime" }
  if ($found) { Write-Ok "$Name already exists"; return }
  $tmp = New-TemporaryFile
  try {
    [System.IO.File]::WriteAllText($tmp.FullName, $Value, (New-Object System.Text.UTF8Encoding($false)))
    Invoke-Native az @('keyvault', 'secret', 'set', '--vault-name', $kvRuntime, '-n', $Name, '--file', $tmp.FullName, '--encoding', 'utf-8', '-o', 'none')
    Write-Ok "$Name created"
  } finally { Remove-Item -Force $tmp.FullName }
}
# Keys exported by deploy-aliyun.ps1 in the same session (setting again = new secret version).
function Set-SecretValue([string]$Name, [string]$Value) {
  $tmp = New-TemporaryFile
  try {
    [System.IO.File]::WriteAllText($tmp.FullName, $Value, (New-Object System.Text.UTF8Encoding($false)))
    Invoke-Native az @('keyvault', 'secret', 'set', '--vault-name', $kvRuntime, '-n', $Name, '--file', $tmp.FullName, '--encoding', 'utf-8', '-o', 'none')
  } finally { Remove-Item -Force $tmp.FullName }
}
if ($env:OSS_ACCESS_KEY_ID -and $env:OSS_ACCESS_KEY_SECRET) {
  Set-SecretValue 'oss-api-access-key-id' $env:OSS_ACCESS_KEY_ID
  Set-SecretValue 'oss-api-access-key-secret' $env:OSS_ACCESS_KEY_SECRET
  Write-Ok 'api-storage access key stored'
}
Set-SecretIfMissing 'demo-context-secret' (New-RandomSecret 48)
Set-SecretIfMissing 'callback-hmac-keys' ("{0}:{1}" -f $CallbackKeyId, (New-RandomSecret 64))

if ($Migrate) {
  Write-Step 'Database migrations (temporary firewall rule for this machine)'
  $firewall = Join-Path $RepoRoot 'infra\azure\scripts\set-pg-firewall.ps1'
  & $firewall -Mode AdminAdd -ResourceGroup $ResourceGroup -Suffix $Suffix
  try {
    $env:MIGRATION_DATABASE_URL = & az keyvault secret show --vault-name $kvOps -n 'db-migrator-url' --query value -o tsv
    if (-not $env:MIGRATION_DATABASE_URL) { throw "db-migrator-url not found in $kvOps - run infra\azure\scripts\bootstrap_db.py first ($pgName)" }
    Invoke-Native pnpm @('--filter', 'api', 'prisma:deploy')
  } finally {
    Remove-Item Env:\MIGRATION_DATABASE_URL -ErrorAction SilentlyContinue
    & $firewall -Mode AdminRemove -ResourceGroup $ResourceGroup -Suffix $Suffix
  }
}

$zip = New-DeployPackage
Write-Step "Deploying package to App Service $appName"
Invoke-Native az @('webapp', 'deploy', '-g', $ResourceGroup, '-n', $appName, '--src-path', $zip, '--type', 'zip', '--restart', 'true', '-o', 'none')

Write-Step 'Waiting for /api/v1/health'
$hostName = & az webapp show -g $ResourceGroup -n $appName --query defaultHostName -o tsv
$url = "https://$hostName"
$deadline = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $deadline) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 "$url/api/v1/health"
    if ($r.StatusCode -eq 200) { Write-Ok "Healthy: $url"; exit 0 }
  } catch { Start-Sleep -Seconds 10 }
}
Write-Warn2 "Not healthy after 5 minutes. Logs: az webapp log tail -g $ResourceGroup -n $appName"
exit 1
