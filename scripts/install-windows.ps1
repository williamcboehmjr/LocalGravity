# LocalGravity Windows Client + Optional Tray Supervisor Installer
param(
  [switch]$WithTray,
  [switch]$NoTray
)

$ErrorActionPreference = 'Stop'
$Repo = 'williamcboehmjr/LocalGravity'
$ApiUrl = "https://api.github.com/repos/$Repo/releases/latest"

Write-Host "Checking latest $Repo Windows release..."
$release = Invoke-RestMethod -Uri $ApiUrl -Headers @{ Accept = 'application/vnd.github.v3+json' }
$msiAsset = $release.assets | Where-Object { $_.name -match '\.msi$' } | Select-Object -First 1
if (-not $msiAsset) {
  throw "Could not find a .msi installer in the latest release."
}

$tmpDir = Join-Path $env:TEMP "localgravity-win-install"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$msiPath = Join-Path $tmpDir $msiAsset.name

Write-Host "Downloading $($msiAsset.name)..."
Invoke-WebRequest -Uri $msiAsset.browser_download_url -OutFile $msiPath -UseBasicParsing
Write-Host "Installing LocalGravity Windows Client..."
Start-Process msiexec.exe -ArgumentList "/i", "`"$msiPath`"", "/passive", "/norestart" -Wait

$installTray = $false
if ($WithTray) {
  $installTray = $true
} elseif (-not $NoTray) {
  if ($env:LOCALGRAVITY_INSTALL_TRAY -eq '1') {
    $installTray = $true
  } elseif ($env:LOCALGRAVITY_INSTALL_TRAY -ne '0') {
    $ans = Read-Host "Optional: Install & enable LocalGravity Central Brain Tray (tray.exe) on Windows startup? [y/N]"
    $installTray = ($ans -match '^(y|yes)$')
  }
}

if ($installTray) {
  $trayAsset = $release.assets | Where-Object { $_.name -eq 'tray.exe' } | Select-Object -First 1
  $trayDir = Join-Path $env:LOCALAPPDATA 'LocalGravity'
  New-Item -ItemType Directory -Force -Path $trayDir | Out-Null
  $trayDest = Join-Path $trayDir 'tray.exe'
  if ($trayAsset) {
    Write-Host "Downloading optional tray.exe..."
    Invoke-WebRequest -Uri $trayAsset.browser_download_url -OutFile $trayDest -UseBasicParsing
  } elseif (Test-Path (Join-Path $PSScriptRoot '..\tray\tray.exe')) {
    Copy-Item (Join-Path $PSScriptRoot '..\tray\tray.exe') $trayDest -Force
  }
  if (Test-Path $trayDest) {
    Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'LocalGravityTray' -Value "`"$trayDest`""
    Start-Process -FilePath $trayDest -WorkingDirectory $trayDir
    Write-Host "Installed tray.exe to $trayDest and enabled Windows startup."
  } else {
    Write-Warning "tray.exe asset was not found in release; skipping optional tray install."
  }
}

Write-Host "Done! LocalGravity Windows setup complete."
