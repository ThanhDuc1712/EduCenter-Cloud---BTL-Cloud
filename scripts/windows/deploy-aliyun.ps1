<#
.SYNOPSIS
  Manual deployment of the Alibaba Cloud side: private OSS buckets (versioning, lifecycle, CORS),
  RAM role/users with least privilege, and the Function Compute material-processor (OSS trigger).

.DESCRIPTION
  CREATES BILLABLE RESOURCES (OSS storage/requests, Function Compute invocations, SLS ingestion).
  Asks you to type the region before creating anything unless -Force is given.
  Never uses the root account for runtime: run it with a RAM administrator profile
  (aliyun configure --profile educenter-admin). Access keys created for the API / read-only users are
  NOT printed: they are exported into this PowerShell session's environment so deploy-azure.ps1 can
  store them in Key Vault, and written nowhere else.

  Requires: Aliyun CLI (aliyun configure), Serverless Devs (npm i -g @serverless-devs/s; s config add),
  Docker (to build Linux Python wheels). The SLS project + logstore must exist (console or CLI) - see
  docs/aliyun-integration.md.

.EXAMPLE
  . .\scripts\windows\deploy-aliyun.ps1 -AccountId 1234567890 -AppOrigin https://educenter-app-xyz.azurewebsites.net -CallbackUrl https://educenter-app-xyz.azurewebsites.net/api/v1/internal/material-callback
#>
param(
  [Parameter(Mandatory)][string]$AccountId,
  [Parameter(Mandatory)][string]$AppOrigin,
  [Parameter(Mandatory)][string]$CallbackUrl,
  [string]$Region = 'ap-southeast-1',
  [string]$Prefix = 'educenter',
  [string]$FunctionName = 'material-processor',
  [string]$SlsProject = 'educenter-logs',
  [string]$SlsLogstore = 'fc-material-processor',
  [string]$Profile = 'educenter-admin',
  [string]$CallbackHmacKeyId = 'k1',
  [switch]$SkipInfra,
  [switch]$Force
)
. (Join-Path $PSScriptRoot 'common.ps1')

if (-not (Test-CommandExists aliyun)) { throw 'Aliyun CLI not found - https://www.alibabacloud.com/help/en/cli/' }
$suffix = $AccountId.Substring($AccountId.Length - 6)
$quarantine = "$Prefix-quarantine-$suffix"
$published = "$Prefix-published-$suffix"
$endpoint = "oss-$Region.aliyuncs.com"

function Invoke-Aliyun([string[]]$Arguments) { Invoke-Native aliyun (@('--profile', $Profile) + $Arguments) }

if (-not $SkipInfra) {
  if (-not $Force) {
    Write-Warn2 "This creates BILLABLE Alibaba Cloud resources in $Region (OSS buckets $quarantine / $published, RAM role + users, Function Compute)."
    $answer = Read-Host "Type the region ($Region) to continue"
    if ($answer -ne $Region) { throw 'Aborted - nothing was created' }
  }

  Write-Step 'OSS buckets (private, versioning, lifecycle, CORS)'
  $cors = (Get-Content -Raw (Join-Path $RepoRoot 'infra\aliyun\oss\cors.xml')).Replace('__APP_ORIGIN__', $AppOrigin)
  $corsFile = New-TemporaryFile
  [System.IO.File]::WriteAllText($corsFile.FullName, $cors, (New-Object System.Text.UTF8Encoding($false)))
  foreach ($b in @(@{ Name = $quarantine; Lifecycle = 'lifecycle-quarantine.xml' }, @{ Name = $published; Lifecycle = 'lifecycle-published.xml' })) {
    & aliyun --profile $Profile oss mb "oss://$($b.Name)" --acl private -e $endpoint 2>$null
    Invoke-Aliyun @('oss', 'bucket-versioning', '--method', 'put', "oss://$($b.Name)", 'enabled', '-e', $endpoint)
    Invoke-Aliyun @('oss', 'lifecycle', '--method', 'put', "oss://$($b.Name)", (Join-Path $RepoRoot "infra\aliyun\oss\$($b.Lifecycle)"), '-e', $endpoint)
    Invoke-Aliyun @('oss', 'cors', '--method', 'put', "oss://$($b.Name)", $corsFile.FullName, '-e', $endpoint)
    Write-Ok "Bucket $($b.Name) ready (private, versioning on)"
  }
  Remove-Item -Force $corsFile.FullName

  function Get-Policy([string]$file) {
    (Get-Content -Raw (Join-Path $RepoRoot "infra\aliyun\ram\$file")).Replace('<QUARANTINE_BUCKET>', $quarantine).Replace('<PUBLISHED_BUCKET>', $published).Replace('<SLS_PROJECT>', $SlsProject).Replace('<SLS_LOGSTORE>', $SlsLogstore) -replace '\s+', ' '
  }

  Write-Step 'RAM: Function Compute execution role (least privilege)'
  $trust = '{"Statement":[{"Action":"sts:AssumeRole","Effect":"Allow","Principal":{"Service":["fc.aliyuncs.com"]}}],"Version":"1"}'
  & aliyun --profile $Profile ram CreateRole --RoleName educenter-fc-worker --AssumeRolePolicyDocument $trust 2>$null | Out-Null
  & aliyun --profile $Profile ram CreatePolicy --PolicyName educenter-fc-worker --PolicyDocument (Get-Policy 'policy-fc-worker.json') 2>$null | Out-Null
  & aliyun --profile $Profile ram AttachPolicyToRole --PolicyType Custom --PolicyName educenter-fc-worker --RoleName educenter-fc-worker 2>$null | Out-Null
  Write-Ok 'Role educenter-fc-worker'

  Write-Step 'RAM: API user (signs upload policies / signed URLs) and read-only ops user'
  & aliyun --profile $Profile ram CreateUser --UserName api-storage 2>$null | Out-Null
  & aliyun --profile $Profile ram CreatePolicy --PolicyName api-storage-oss --PolicyDocument (Get-Policy 'policy-api-storage.json') 2>$null | Out-Null
  & aliyun --profile $Profile ram AttachPolicyToUser --PolicyType Custom --PolicyName api-storage-oss --UserName api-storage 2>$null | Out-Null
  & aliyun --profile $Profile ram CreateUser --UserName educenter-ops-readonly 2>$null | Out-Null
  foreach ($p in 'AliyunLogReadOnlyAccess', 'AliyunCloudMonitorReadOnlyAccess', 'AliyunBSSReadOnlyAccess') {
    & aliyun --profile $Profile ram AttachPolicyToUser --PolicyType System --PolicyName $p --UserName educenter-ops-readonly 2>$null | Out-Null
  }
  foreach ($u in @(@{ User = 'api-storage'; Id = 'OSS_ACCESS_KEY_ID'; Secret = 'OSS_ACCESS_KEY_SECRET' }, @{ User = 'educenter-ops-readonly'; Id = 'ALIYUN_READONLY_ACCESS_KEY_ID'; Secret = 'ALIYUN_READONLY_ACCESS_KEY_SECRET' })) {
    $key = (& aliyun --profile $Profile ram CreateAccessKey --UserName $u.User) | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $key.AccessKey) { throw "Could not create an access key for $($u.User) (max 2 keys per user - delete an old one)" }
    Set-Item -Path "Env:\$($u.Id)" -Value $key.AccessKey.AccessKeyId
    Set-Item -Path "Env:\$($u.Secret)" -Value $key.AccessKey.AccessKeySecret
    Write-Ok "Access key for $($u.User) exported to this session (not printed). Store it with deploy-azure.ps1."
  }
}

Write-Step 'Building Linux wheels for the function (Python 3.10, manylinux 2.28 = FC runtime)'
$fn = Join-Path $RepoRoot 'functions\material-processor'
Remove-Item -Recurse -Force (Join-Path $fn 'python') -ErrorAction SilentlyContinue
# The FC python3.10 runtime is Debian 10 (glibc 2.28): newer wheels would not import there.
Invoke-Native docker @('run', '--rm', '-v', "${fn}:/code", '-w', '/code', 'python:3.10-slim', 'pip', 'install', '-q', '--root-user-action=ignore', '--only-binary=:all:', '--implementation', 'cp', '--python-version', '3.10', '--platform', 'manylinux_2_28_x86_64', '--platform', 'manylinux_2_17_x86_64', '--platform', 'manylinux2014_x86_64', '-t', '/code/python', '-r', 'requirements.txt')

if (-not $env:CALLBACK_HMAC_SECRET) {
  throw 'Set $env:CALLBACK_HMAC_SECRET to the k1 secret stored in Azure Key Vault (az keyvault secret show ... callback-hmac-keys) before deploying the function'
}
$env:ALIYUN_REGION = $Region; $env:ALIYUN_ACCOUNT_ID = $AccountId; $env:ALIYUN_FC_FUNCTION_NAME = $FunctionName
$env:OSS_QUARANTINE_BUCKET = $quarantine; $env:OSS_PUBLISHED_BUCKET = $published
$env:ALIYUN_SLS_PROJECT = $SlsProject; $env:ALIYUN_SLS_LOGSTORE = $SlsLogstore
$env:CALLBACK_URL = $CallbackUrl; $env:CALLBACK_HMAC_KEY_ID = $CallbackHmacKeyId

Write-Step "Deploying Function Compute $FunctionName with OSS trigger (Serverless Devs)"
if (-not (Test-CommandExists s)) { throw 'Serverless Devs not found: npm install -g @serverless-devs/s ; s config add' }
Invoke-Native s @('deploy', '-y') $fn
Write-Ok "Function deployed. Buckets: $quarantine / $published. Next: deploy-azure.ps1 -OssQuarantineBucket $quarantine -OssPublishedBucket $published -SlsProject $SlsProject"
