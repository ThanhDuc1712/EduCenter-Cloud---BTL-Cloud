<#
.SYNOPSIS
  Runs every local quality gate and prints a PASS/FAIL table (nothing is reported PASS unless it ran).
  1 lint  2 typecheck  3 unit tests  4 build  5 integration tests (PostgreSQL)
  6 Function Compute tests (Python in Docker)  7 end-to-end integration flow (needs the API running)
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\test-local.ps1
  powershell -ExecutionPolicy Bypass -File scripts\windows\test-local.ps1 -SkipE2E
#>
param([switch]$SkipE2E, [switch]$SkipPython)
. (Join-Path $PSScriptRoot 'common.ps1')
$ErrorActionPreference = 'Continue'
$results = New-Object System.Collections.Generic.List[object]

function Invoke-Gate([string]$Name, [scriptblock]$Body) {
  Write-Step $Name
  $sw = [Diagnostics.Stopwatch]::StartNew()
  Push-Location $RepoRoot
  try { & $Body; $ok = ($LASTEXITCODE -eq 0) } catch { Write-Fail $_.Exception.Message; $ok = $false } finally { Pop-Location }
  $status = 'FAIL'
  if ($ok) { $status = 'PASS' }
  $results.Add([pscustomobject]@{ Gate = $Name; Result = $status; Seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1) })
}

Invoke-Gate 'Build shared package' { pnpm --filter '@educenter/shared' build }
Invoke-Gate 'Lint (ESLint + OpenAPI)' { pnpm lint }
Invoke-Gate 'Typecheck' { pnpm typecheck }
Invoke-Gate 'Unit tests (API)' { pnpm --filter api test }
Invoke-Gate 'Build (all packages)' { pnpm build }

& docker compose up -d postgres *> $null
Wait-PostgresHealthy
Invoke-Gate 'Integration tests (PostgreSQL, edu_runtime)' { pnpm --filter api test:integration }

if (-not $SkipPython) {
  $fc = Join-Path $RepoRoot 'functions\material-processor'
  Invoke-Gate 'Function Compute tests (python:3.10 in Docker)' {
    docker run --rm -v "${fc}:/src:ro" python:3.10-slim sh -c 'cp -r /src /tmp/fc && cd /tmp/fc && pip install -q --disable-pip-version-check --root-user-action=ignore -r requirements.txt pytest==8.3.5 && python -m pytest -q tests'
  }
} else { $results.Add([pscustomobject]@{ Gate = 'Function Compute tests'; Result = 'SKIPPED'; Seconds = 0 }) }

if (-not $SkipE2E) {
  $apiUp = $false
  try { $apiUp = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:3000/api/v1/health').StatusCode -eq 200 } catch { $apiUp = $false }
  if ($apiUp) { Invoke-Gate 'E2E integration flow (education + cloud pipeline)' { node tests/e2e/integration-flow.mjs } }
  else { $results.Add([pscustomobject]@{ Gate = 'E2E integration flow'; Result = 'SKIPPED (API not running - start-local.ps1)'; Seconds = 0 }) }
} else { $results.Add([pscustomobject]@{ Gate = 'E2E integration flow'; Result = 'SKIPPED'; Seconds = 0 }) }

Write-Host ''
$results | Format-Table -AutoSize | Out-String | Write-Host
if ($results | Where-Object { $_.Result -eq 'FAIL' }) { exit 1 }
exit 0
