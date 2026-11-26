<#
.SYNOPSIS
  Starts EduCenter Cloud locally: PostgreSQL (Docker), API (NestJS, port 3000) and web (Vite, port 5173).
.DESCRIPTION
  Default: dev mode with hot reload in two new PowerShell windows.
  -Production: builds web + api and runs the API serving the SPA on one origin (http://localhost:3000),
  the same layout as Azure App Service.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\start-local.ps1
  powershell -ExecutionPolicy Bypass -File scripts\windows\start-local.ps1 -Production
#>
param([switch]$Production)
. (Join-Path $PSScriptRoot 'common.ps1')

if (-not (Test-Path (Join-Path $RepoRoot '.env'))) { throw '.env not found - run scripts\windows\setup-local.ps1 first' }

Write-Step 'Starting PostgreSQL'
Invoke-Native docker @('compose', 'up', '-d', 'postgres')
Wait-PostgresHealthy
Write-Ok 'PostgreSQL healthy'

Write-Step 'Applying pending migrations'
Invoke-Native pnpm @('--filter', 'api', 'prisma:deploy')

$logDir = Join-Path $RepoRoot '.data\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if ($Production) {
  Write-Step 'Building shared, web and api'
  Invoke-Native pnpm @('--filter', '@educenter/shared', 'build')
  Invoke-Native pnpm @('--filter', 'web', 'build')
  Invoke-Native pnpm @('--filter', 'api', 'build')
  $env:WEB_DIST_DIR = '../web/dist'
  $env:APP_ORIGIN = 'http://localhost:3000'
  $api = Start-Process -FilePath node -ArgumentList 'dist/main.js' -WorkingDirectory (Join-Path $RepoRoot 'apps\api') -RedirectStandardOutput (Join-Path $logDir 'api.out.log') -RedirectStandardError (Join-Path $logDir 'api.err.log') -WindowStyle Hidden -PassThru
  Set-Content -Path (Join-Path $logDir 'pids.txt') -Value $api.Id
  Write-Ok "API + SPA (same origin) starting, PID $($api.Id) - logs in .data\logs"
  $url = 'http://localhost:3000'
} else {
  $apiCmd = "Set-Location '$RepoRoot'; pnpm --filter api dev"
  $webCmd = "Set-Location '$RepoRoot'; pnpm --filter web dev"
  $api = Start-Process -FilePath powershell -ArgumentList '-NoExit', '-Command', $apiCmd -PassThru
  $web = Start-Process -FilePath powershell -ArgumentList '-NoExit', '-Command', $webCmd -PassThru
  Set-Content -Path (Join-Path $logDir 'pids.txt') -Value @($api.Id, $web.Id)
  Write-Ok "API window PID $($api.Id), web window PID $($web.Id)"
  $url = 'http://localhost:5173'
}

Write-Step 'Waiting for the API health check'
$deadline = (Get-Date).AddSeconds(120)
$ready = $false
while ((Get-Date) -lt $deadline) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:3000/api/v1/health'
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch { Start-Sleep -Seconds 2 }
}
if ($ready) { Write-Ok "API ready. Open $url" } else { Write-Warn2 'API did not report healthy within 120 s - check the API window / .data\logs' }
