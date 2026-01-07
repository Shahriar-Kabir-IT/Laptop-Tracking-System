Param(
  [string]$InstallDir = "C:\Program Files\LaptopTracker",
  [string]$TaskName = "LaptopTracker"
)

function Require-Admin {
  $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Run this uninstaller in an elevated PowerShell (Administrator)"
    exit 1
  }
}

Require-Admin

Write-Host "Stopping and deleting scheduled task '$TaskName'"
schtasks /End /TN $TaskName | Out-Null
schtasks /Delete /TN $TaskName /F | Out-Null

Write-Host "Removing installation directory '$InstallDir'"
Remove-Item -Recurse -Force $InstallDir

Write-Host "Uninstall complete."

