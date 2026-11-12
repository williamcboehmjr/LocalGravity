$ErrorActionPreference = 'Continue'
$jdk20 = 'C:\Program Files\Java\jdk-20'
Write-Output ('javac present: ' + (Test-Path ($jdk20 + '\bin\javac.exe')))
& $jdk20\bin\java.exe -version 2>&1

$zip = 'C:\Android\cmdline-tools.zip'
if (-not (Test-Path $zip)) { Write-Output 'ZIP MISSING - download not finished'; exit 0 }
Write-Output ('ZIP size: ' + (Get-Item $zip).Length)

# Extract to temp then place under Sdk\cmdline-tools\latest (required layout)
$tmp = 'C:\Android\_extract'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $tmp -Force
$inner = Get-ChildItem $tmp -Directory | Where-Object { $_.Name -like 'cmdline-tools*' } | Select-Object -First 1
Write-Output ('INNER: ' + $inner.FullName)

$latestParent = 'C:\Android\Sdk\cmdline-tools'
$latest = Join-Path $latestParent 'latest'
if (Test-Path $latest) { Remove-Item $latest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $latestParent | Out-Null
Move-Item $inner.FullName $latest

Write-Output ('sdkmanager present: ' + (Test-Path ($latest + '\bin\sdkmanager.bat')))
Get-ChildItem ($latest + '\bin') | ForEach-Object { Write-Output $_.Name }
