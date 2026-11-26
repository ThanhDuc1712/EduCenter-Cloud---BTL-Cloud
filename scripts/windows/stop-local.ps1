<#
.SYNOPSIS
  Stops the local API/web processes started by start-local.ps1 and the PostgreSQL container.
  Data is kept (Docker volume educenter_pgdata, .data\storage). Use -ResetData to wipe both.
#>
param([switch]$ResetData)
. (Join-Path $PSScriptRoot 'common.ps1')

Write-Step 'Stopping API / web processes'
$pidFile = Join-Path $RepoRoot '.data\logs\pids.txt'
if (Test-Path $pidFile) {
  foreach ($procId in Get-Content $pidFile) {
    if ($procId -match '^\d+$') {
      # /T also ends child processes (node, vite) of the PowerShell windows.
      & taskkill.exe /PID $procId /T /F *> $null
      Write-Ok "Stopped process tree $procId"
    }
  }
  Remove-Item $pidFile -Force
} else { Write-Warn2 'No PID file - nothing started by start-local.ps1' }

foreach ($port in 3000, 5173) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { Write-Warn2 "Port $port is still in use by PID $($conn.OwningProcess) (not started by this script - left running)" }
}

Write-Step 'Stopping PostgreSQL'
if ($ResetData) {
  $answer = Read-Host 'This deletes the local database volume and uploaded files. Type YES to continue'
  if ($answer -ne 'YES') { throw 'Aborted' }
  Invoke-Native docker @('compose', 'down', '-v')
  Remove-Item -Recurse -Force (Join-Path $RepoRoot 'apps\api\.data') -ErrorAction SilentlyContinue
  Write-Ok 'Containers, database volume and local storage removed'
} else {
  Invoke-Native docker @('compose', 'down')
  Write-Ok 'Containers stopped (data kept)'
}
