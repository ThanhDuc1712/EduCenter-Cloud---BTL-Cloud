<#
.SYNOPSIS
  One command for the tester (Duong): runs every black-box QA suite against a running deployment
  and collects the results in one folder (outside the repo).
    1 security-suite   tests/security/security-suite.mjs
    2 authz matrix     tests/security/authz/authz-matrix.mjs   (if present)
    3 role journeys    tests/e2e/role-journeys.mjs
    4 k6 smoke         tests/load/smoke.k6.js                   (if k6 is installed, unless -SkipK6)
  Nothing is reported PASS unless it ran. Read-only against remote targets.

  -RunName  short name for this run (a-z, 0-9, -), e.g. pre-aliyun-service-available
  -Archive  also copy the reports into docs/evidence/qa/<date>-<RunName>-<target>/ and add a row to
            docs/evidence/qa/README.md (the run log that goes into the repo and the report, Ch9).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tests\run-qa.ps1
  powershell -ExecutionPolicy Bypass -File tests\run-qa.ps1 -RunName pre-aliyun-service-available -Archive
  powershell -ExecutionPolicy Bypass -File tests\run-qa.ps1 -BaseUrl https://app-educenter-xxxx.azurewebsites.net -RunName azure-rc1 -Archive
#>
param(
  [string]$BaseUrl = 'http://localhost:3000',
  [string]$RunName = 'adhoc',
  [switch]$Archive,
  [switch]$SkipK6,
  [switch]$IncludeWrites,
  [int]$Vus = 5,
  [string]$Duration = '1m'
)
$ErrorActionPreference = 'Continue'
# PowerShell 5.1 shows UTF-8 output from node as mojibake without this.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

if ($RunName -notmatch '^[a-z0-9][a-z0-9-]{1,59}$') {
  Write-Host "RunName chi gom chu thuong, so va dau '-' (2-60 ky tu), vd: pre-aliyun-service-available" -ForegroundColor Red
  exit 2
}

$isLocal = $BaseUrl -match '^https?://(localhost|127\.0\.0\.1)(:\d+)?/?$'
if (-not $env:TEST_PASSWORD) {
  if ($isLocal) {
    # Local seed default (README). Every suite reads the password from this variable only.
    $env:TEST_PASSWORD = 'Demo@12345'
  } else {
    $sec = Read-Host 'Mat khau tai khoan demo tren moi truong nay' -AsSecureString
    $env:TEST_PASSWORD = [Net.NetworkCredential]::new('', $sec).Password
  }
}
$sha = (git rev-parse --short HEAD 2>$null)
$branch = (git branch --show-current 2>$null)
$started = Get-Date
$stamp = $started.ToString('yyyyMMdd-HHmm')
$target = 'local'
if (-not $isLocal) { $target = 'azure' }
$runId = "$stamp-$RunName-$target"
$out = Join-Path (Split-Path -Parent $repo) "EduCenter-test-results\$runId-$sha"
New-Item -ItemType Directory -Force $out | Out-Null

$env:BASE_URL = $BaseUrl.TrimEnd('/')
$env:OUT_DIR = $out
$results = New-Object System.Collections.Generic.List[object]

function Invoke-Suite([string]$Name, [scriptblock]$Body) {
  Write-Host ''
  Write-Host "==> $Name" -ForegroundColor Cyan
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $log = Join-Path $out (($Name -replace '[^A-Za-z0-9]+', '-') + '.log')
  & $Body 2>&1 | Tee-Object -FilePath $log
  $status = 'PASS'
  if ($LASTEXITCODE -eq 2) { $status = 'ERROR' }
  elseif ($LASTEXITCODE -ne 0) { $status = 'FAIL' }
  # Pull the "PASS x FAIL y ..." line printed by the suite, if any, for the run log.
  $counts = (Select-String -Path $log -Pattern '^(PASS \d+.*|\d+/\d+ steps passed.*)$' -ErrorAction SilentlyContinue | Select-Object -Last 1).Line
  $results.Add([pscustomobject]@{ Suite = $Name; Result = $status; Counts = $counts; Seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1) })
}

$health = $null
try { $health = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "$($env:BASE_URL)/api/v1/health").StatusCode } catch { }
if ($health -ne 200) {
  Write-Host "API khong tra loi tai $($env:BASE_URL)/api/v1/health - hay chay start-local.ps1 (local) hoac kiem tra URL Azure." -ForegroundColor Red
  exit 2
}

Invoke-Suite 'Security suite' { node tests/security/security-suite.mjs }

if (Test-Path 'tests/security/authz/authz-matrix.mjs') {
  if ($IncludeWrites -and $isLocal) { Invoke-Suite 'Authz matrix (+writes)' { node tests/security/authz/authz-matrix.mjs --include-writes } }
  else { Invoke-Suite 'Authz matrix' { node tests/security/authz/authz-matrix.mjs } }
} else {
  $results.Add([pscustomobject]@{ Suite = 'Authz matrix'; Result = 'NOT RUN'; Counts = 'chua co file'; Seconds = 0 })
}

Invoke-Suite 'E2E role journeys' { node tests/e2e/role-journeys.mjs }

$k6 = Get-Command k6 -ErrorAction SilentlyContinue
if ($SkipK6) { $results.Add([pscustomobject]@{ Suite = 'k6 smoke'; Result = 'SKIPPED'; Counts = '-SkipK6'; Seconds = 0 }) }
elseif (-not $k6) { $results.Add([pscustomobject]@{ Suite = 'k6 smoke'; Result = 'NOT RUN'; Counts = 'chua cai k6'; Seconds = 0 }) }
else {
  Invoke-Suite 'k6 smoke' { k6 run --quiet -e "BASE_URL=$($env:BASE_URL)" -e "TEST_PASSWORD=$($env:TEST_PASSWORD)" -e "VUS=$Vus" -e "DURATION=$Duration" --summary-export (Join-Path $out 'k6-summary.json') tests/load/smoke.k6.js }
}

Write-Host ''
Write-Host "Run: $runId   target: $($env:BASE_URL)   commit: $sha ($branch)" -ForegroundColor Cyan
$results | Format-Table -AutoSize | Out-String | Write-Host

$summary = @(
  "# QA run $runId", '',
  "| | |", '|---|---|',
  "| Run name | ``$RunName`` |",
  "| Date | $($started.ToString('yyyy-MM-dd HH:mm')) (UTC+7) |",
  "| Target | ``$($env:BASE_URL)`` ($target) |",
  "| Commit | ``$sha`` (branch ``$branch``) |", '',
  '| Suite | Result | Counts | Seconds |', '|---|---|---|---|'
)
foreach ($r in $results) { $summary += "| $($r.Suite) | **$($r.Result)** | $($r.Counts) | $($r.Seconds) |" }
$summary | Out-File (Join-Path $out 'SUMMARY.md') -Encoding utf8
Write-Host "Ket qua: $out" -ForegroundColor Green

if ($Archive) {
  $evidenceRoot = Join-Path $repo 'docs\evidence\qa'
  $dest = Join-Path $evidenceRoot $runId
  New-Item -ItemType Directory -Force $dest | Out-Null
  Get-ChildItem $out -File | Where-Object { $_.Extension -in '.md', '.csv', '.log', '.json' } | Copy-Item -Destination $dest -Force
  $index = Join-Path $evidenceRoot 'README.md'
  if (-not (Test-Path $index)) {
    @(
      '# QA run log', '',
      'Every row is one run of `tests\run-qa.ps1 -Archive`. Folders hold the raw reports (no secrets).', '',
      '| Run | Date | Target | Commit | Security | Authz | E2E | k6 |',
      '|---|---|---|---|---|---|---|---|'
    ) | Out-File $index -Encoding utf8
  }
  function Get-Cell([string]$suite) {
    $r = $results | Where-Object { $_.Suite -like "$suite*" } | Select-Object -First 1
    if (-not $r) { return '-' }
    if ($r.Counts) { return "$($r.Result): $($r.Counts)" }
    return $r.Result
  }
  $row = "| [$runId]($runId/SUMMARY.md) | $($started.ToString('yyyy-MM-dd HH:mm')) | $target | ``$sha`` | $(Get-Cell 'Security') | $(Get-Cell 'Authz') | $(Get-Cell 'E2E') | $(Get-Cell 'k6') |"
  Add-Content -Path $index -Value $row -Encoding utf8
  Write-Host "Da luu vao repo: docs\evidence\qa\$runId  (+ 1 dong trong docs\evidence\qa\README.md)" -ForegroundColor Green
}
Write-Host 'Bao cao: SUMMARY.md va cac file .md trong thu muc tren.'
