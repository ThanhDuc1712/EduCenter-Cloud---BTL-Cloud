# Shared helpers for the EduCenter Cloud Windows scripts (dot-source this file).
# Windows PowerShell 5.1 compatible: no `&&`, no ternary, no `??`.

$ErrorActionPreference = 'Stop'
$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "  [OK]   $Message" -ForegroundColor Green }
function Write-Warn2([string]$Message) { Write-Host "  [WARN] $Message" -ForegroundColor Yellow }
function Write-Fail([string]$Message) { Write-Host "  [FAIL] $Message" -ForegroundColor Red }

# Runs a native command from the repo root and throws when it exits non-zero.
function Invoke-Native {
  param([Parameter(Mandatory)][string]$File, [string[]]$Arguments = @(), [string]$WorkDir = $script:RepoRoot)
  Push-Location $WorkDir
  try {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "'$File $($Arguments -join ' ')' failed with exit code $LASTEXITCODE" }
  } finally { Pop-Location }
}

function Test-CommandExists([string]$Name) { return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# Reads KEY=VALUE pairs from the repo-root .env (comments and blanks ignored).
function Read-DotEnv {
  $path = Join-Path $script:RepoRoot '.env'
  $map = @{}
  if (-not (Test-Path $path)) { return $map }
  foreach ($line in Get-Content -Path $path -Encoding UTF8) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $idx = $line.IndexOf('=')
    $map[$line.Substring(0, $idx).Trim()] = $line.Substring($idx + 1).Trim()
  }
  return $map
}

function New-RandomSecret([int]$Length = 40) {
  $chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $bytes = New-Object byte[] $Length
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $sb = New-Object System.Text.StringBuilder
  foreach ($b in $bytes) { [void]$sb.Append($chars[$b % $chars.Length]) }
  return $sb.ToString()
}

function Wait-PostgresHealthy([int]$TimeoutSeconds = 90) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $status = (& docker inspect --format '{{.State.Health.Status}}' educenter-postgres-1 2>$null)
    if ($status -eq 'healthy') { return }
    Start-Sleep -Seconds 2
  }
  throw "PostgreSQL did not become healthy within $TimeoutSeconds s (docker compose logs postgres)"
}
