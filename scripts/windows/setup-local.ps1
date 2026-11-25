<#
.SYNOPSIS
  One-time local setup on Windows: .env, dependencies, PostgreSQL, migrations, seed data.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\setup-local.ps1
  powershell -ExecutionPolicy Bypass -File scripts\windows\setup-local.ps1 -SkipSeed
#>
param(
  [switch]$SkipSeed,
  [switch]$ForceEnv
)
. (Join-Path $PSScriptRoot 'common.ps1')

& (Join-Path $PSScriptRoot 'check-environment.ps1') -Quiet
if ($LASTEXITCODE -ne 0) { throw 'Environment check failed - fix the items marked [FAIL] first.' }

Write-Step 'Creating .env from .env.example'
$envPath = Join-Path $RepoRoot '.env'
if ((Test-Path $envPath) -and -not $ForceEnv) {
  Write-Ok '.env already exists (kept). Use -ForceEnv to regenerate it (requires a DB reset).'
} else {
  $content = Get-Content -Raw -Encoding UTF8 (Join-Path $RepoRoot '.env.example')
  # Each distinct placeholder gets ONE random value so URLs and passwords stay in sync.
  $placeholders = [regex]::Matches($content, 'change-me-[A-Za-z0-9-]+') | ForEach-Object { $_.Value } | Sort-Object -Unique
  foreach ($p in $placeholders) { $content = $content.Replace($p, (New-RandomSecret 40)) }
  # UTF-8 without BOM (dotenv and docker compose read it).
  [System.IO.File]::WriteAllText($envPath, $content, (New-Object System.Text.UTF8Encoding($false)))
  Write-Ok ".env written with random local secrets ($($placeholders.Count) values)"
}

Write-Step 'Installing dependencies (frozen lockfile)'
Invoke-Native pnpm @('install', '--frozen-lockfile')

Write-Step 'Building the shared package'
Invoke-Native pnpm @('--filter', '@educenter/shared', 'build')

Write-Step 'Starting PostgreSQL 16 (Docker)'
Invoke-Native docker @('compose', 'up', '-d', 'postgres')
Wait-PostgresHealthy
Write-Ok 'PostgreSQL is healthy on 127.0.0.1'

Write-Step 'Generating Prisma client and applying migrations (as edu_migrator)'
Invoke-Native pnpm @('--filter', 'api', 'prisma:generate')
Invoke-Native pnpm @('--filter', 'api', 'prisma:deploy')

if (-not $SkipSeed) {
  Write-Step 'Seeding demo data (2 tenants, idempotent reset of demo tenants)'
  Invoke-Native pnpm @('--filter', 'api', 'db:seed')
}

Write-Host ''
Write-Ok 'Setup complete. Start the app with: powershell -ExecutionPolicy Bypass -File scripts\windows\start-local.ps1'
