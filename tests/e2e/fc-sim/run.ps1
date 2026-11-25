<#
.SYNOPSIS
  Runs the cross-cloud material flow with SIMULATED Alibaba services (tests/e2e/fc-sim/flow.py).
.DESCRIPTION
  Starts the built API (pnpm build first) in aliyun-fc mode with LOCAL storage, then runs the real
  Function Compute handler in a python:3.10 container against it. Needs PostgreSQL (docker compose,
  migrated and seeded), a .env, and port 3000 free. Nothing is sent to Alibaba Cloud or Azure.
#>
. (Join-Path $PSScriptRoot '..\..\..\scripts\windows\common.ps1')

$envFile = Read-DotEnv
$keyPair = $envFile['CALLBACK_HMAC_KEYS'].Split(',')[0]
$keyId = $keyPair.Substring(0, $keyPair.IndexOf(':'))
$secret = $keyPair.Substring($keyPair.IndexOf(':') + 1)
if (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue) { throw 'Port 3000 is in use - stop the running API first (stop-local.ps1)' }

$env:AUTH_MODE = 'demo'; $env:DEMO_MODE = 'true'
$env:STORAGE_PROVIDER = 'local'; $env:PROCESSING_PROVIDER = 'aliyun-fc'
$env:PROCESSING_TIMEOUT_SECONDS = '30'; $env:RECONCILE_INTERVAL_SECONDS = '0'
$apiDir = Join-Path $RepoRoot 'apps\api'
$logDir = Join-Path $RepoRoot '.data\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$api = Start-Process -FilePath node -ArgumentList 'dist/main.js' -WorkingDirectory $apiDir -RedirectStandardOutput (Join-Path $logDir 'fc-sim.out.log') -RedirectStandardError (Join-Path $logDir 'fc-sim.err.log') -WindowStyle Hidden -PassThru
$code = 1
try {
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    try { if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:3000/api/v1/health').StatusCode -eq 200) { break } } catch { Start-Sleep -Seconds 1 }
  }
  $origin = $envFile['APP_ORIGIN']
  $storage = Join-Path $apiDir '.data\storage'
  & docker run --rm -v "${RepoRoot}:/repo:ro" -v "${storage}:/storage" `
    -e PYTHONDONTWRITEBYTECODE=1 -e SIM_STORAGE_DIR=/storage -e API_BASE=http://host.docker.internal:3000 -e "APP_ORIGIN=$origin" `
    -e CALLBACK_URL=http://host.docker.internal:3000/api/v1/internal/material-callback -e ALLOW_INSECURE_CALLBACK=true `
    -e "CALLBACK_HMAC_KEY_ID=$keyId" -e "CALLBACK_HMAC_SECRET=$secret" `
    -e OSS_ENDPOINT=simulated -e QUARANTINE_BUCKET=sim-quarantine -e PUBLISHED_BUCKET=sim-published `
    python:3.10-slim sh -c 'pip install -q --disable-pip-version-check --root-user-action=ignore -r /repo/functions/material-processor/requirements.txt && python /repo/tests/e2e/fc-sim/flow.py'
  $code = $LASTEXITCODE
} finally {
  Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
  Remove-Item Env:\AUTH_MODE, Env:\DEMO_MODE, Env:\STORAGE_PROVIDER, Env:\PROCESSING_PROVIDER, Env:\PROCESSING_TIMEOUT_SECONDS, Env:\RECONCILE_INTERVAL_SECONDS -ErrorAction SilentlyContinue
}
exit $code
