Param(
  [string]$BackendBaseUrl = "http://localhost:4000/api",
  [string]$ClientToken = "dev_client_token",
  [string]$EmployeeName = "",
  [string]$DepartmentName = "",
  [string]$InstallDir = "C:\Program Files\LaptopTracker"
)

function Require-Admin {
  $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Run this installer in an elevated PowerShell (Administrator)"
    exit 1
  }
}

Require-Admin

Write-Host "Installing LaptopTracker to $InstallDir"
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

$src = "e:\Cursor\dist2\TrackerClient"
Copy-Item -Path "$src\TrackerClient.exe" -Destination $InstallDir -Force
Copy-Item -Path "$src\appsettings.json" -Destination $InstallDir -Force

$cfgPath = Join-Path $InstallDir "appsettings.json"
$cfg = Get-Content $cfgPath | ConvertFrom-Json
$cfg.BackendBaseUrl = $BackendBaseUrl
$cfg.ClientToken = $ClientToken
if ($EmployeeName -ne "") { $cfg.EmployeeName = $EmployeeName }
if ($DepartmentName -ne "") { $cfg.DepartmentName = $DepartmentName }
$cfg.EmployeeCode = "" # ensure auto-provision
$cfg | ConvertTo-Json -Depth 10 | Set-Content $cfgPath

$taskName = "LaptopTracker"
$exePath = Join-Path $InstallDir "TrackerClient.exe"

Write-Host "Creating startup scheduled task '$taskName'"
schtasks /Create /TN $taskName /TR "`"$exePath`"" /SC ONSTART /RU SYSTEM /F | Out-Null

Write-Host "Starting task '$taskName'"
schtasks /Run /TN $taskName | Out-Null

Write-Host "Installation complete."

