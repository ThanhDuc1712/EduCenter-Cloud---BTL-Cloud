<#
.SYNOPSIS
  Checks the Windows toolchain for EduCenter Cloud (Node 24, pnpm 10.34.9, Docker, ports, optional cloud CLIs).
  Exit code 0 = ready for LOCAL mode.
#>
param([switch]$Quiet)
. (Join-Path $PSScriptRoot 'common.ps1')
$ErrorActionPreference = 'Continue'
$failed = $false

Write-Step 'Checking required tools'
if (Test-CommandExists node) {
  $nodeVersion = (& node -v)
  if ($nodeVersion -match '^v24\.') { Write-Ok "Node.js $nodeVersion" }
  else { Write-Fail "Node.js $nodeVersion found - Node 24 LTS is required (winget install OpenJS.NodeJS.LTS or fnm use)"; $failed = $true }
} else { Write-Fail 'Node.js not found - install Node 24 LTS: winget install OpenJS.NodeJS.LTS'; $failed = $true }

if (Test-CommandExists pnpm) {
  $pnpmVersion = (& pnpm -v)
  if ($pnpmVersion -eq '10.34.9') { Write-Ok "pnpm $pnpmVersion" }
  else { Write-Warn2 "pnpm $pnpmVersion - the repo pins 10.34.9 (corepack enable; corepack prepare pnpm@10.34.9 --activate)" }
} else { Write-Fail 'pnpm not found - run: corepack enable; corepack prepare pnpm@10.34.9 --activate'; $failed = $true }

if (Test-CommandExists docker) {
  & docker info --format '{{.ServerVersion}}' *> $null
  if ($LASTEXITCODE -eq 0) { Write-Ok "Docker engine $(& docker info --format '{{.ServerVersion}}')" }
  else { Write-Fail 'Docker CLI found but the engine is not running - start Docker Desktop'; $failed = $true }
  & docker compose version *> $null
  if ($LASTEXITCODE -eq 0) { Write-Ok 'Docker Compose v2' } else { Write-Fail 'docker compose (v2) not available'; $failed = $true }
} else { Write-Fail 'Docker not found - install Docker Desktop: winget install Docker.DockerDesktop'; $failed = $true }

if (Test-CommandExists git) { Write-Ok "git $((& git --version) -replace 'git version ', '')" } else { Write-Warn2 'git not found' }

Write-Step 'Checking local ports'
$envMap = Read-DotEnv
$pgPort = 5433
if ($envMap.ContainsKey('POSTGRES_HOST_PORT')) { $pgPort = [int]$envMap['POSTGRES_HOST_PORT'] }
foreach ($port in @(3000, 5173, $pgPort)) {
  $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($busy) {
    $owner = (Get-Process -Id ($busy | Select-Object -First 1).OwningProcess -ErrorAction SilentlyContinue).ProcessName
    Write-Warn2 "Port $port is in use by '$owner' (fine if it is this project already running)"
  } else { Write-Ok "Port $port free" }
}

Write-Step 'Checking configuration'
if (Test-Path (Join-Path $RepoRoot '.env')) {
  $placeholders = (Get-Content (Join-Path $RepoRoot '.env') | Select-String 'change-me-').Count
  if ($placeholders -gt 0) { Write-Warn2 ".env still contains $placeholders change-me-* placeholder(s)" } else { Write-Ok '.env present' }
  $mode = 'LOCAL'
  if ($envMap['STORAGE_PROVIDER'] -eq 'oss') { $mode = 'CLOUD (OSS)' }
  Write-Ok "Storage mode: $mode"
} else { Write-Warn2 '.env missing - setup-local.ps1 creates it' }

if (-not $Quiet) {
  Write-Step 'Optional cloud tooling (only for deploy-azure.ps1 / deploy-aliyun.ps1)'
  if (Test-CommandExists az) { Write-Ok 'Azure CLI installed' } else { Write-Warn2 'Azure CLI not installed (winget install Microsoft.AzureCLI)' }
  if (Test-CommandExists aliyun) { Write-Ok 'Aliyun CLI installed' } else { Write-Warn2 'Aliyun CLI not installed (https://www.alibabacloud.com/help/en/cli/install-cli-on-windows)' }
  if (Test-CommandExists python) { Write-Ok 'Python installed' } else { Write-Warn2 'Python not installed - Function Compute tests run in Docker instead' }
}

if ($failed) { Write-Host ''; Write-Fail 'Environment is NOT ready'; exit 1 }
Write-Host ''; Write-Ok 'Environment is ready for LOCAL mode'; exit 0
