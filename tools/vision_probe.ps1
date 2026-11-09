# Vision probe: how is Strata launched, do projector files exist, VRAM headroom?
$root = 'C:\Users\Sue\.gemini\antigravity\scratch\LocalGravity'

Write-Output '=== LAUNCH / CONFIG FILES (strata/llama/mmproj/ctx) ==='
Get-ChildItem $root -Recurse -Include *.ps1,*.bat,*.cmd,*.json,*.toml -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules|src-tauri\\target|dist|\.fingerprint' } |
  Select-String -Pattern 'strata','mmproj','8080','--ctx','-ngl','vision','image_url','projector' -SimpleMatch |
  ForEach-Object { "{0}:{1}: {2}" -f $_.Path, $_.LineNumber, $_.Line.Trim() }

Write-Output ''
Write-Output '=== MMPROJ / PROJECTOR FILES ON DISK ==='
Get-ChildItem 'C:\Users\Sue' -Recurse -Include '*mmproj*','*projector*' -ErrorAction SilentlyContinue |
  ForEach-Object { "{0,8:N1} MB  {1}" -f ($_.Length/1MB), $_.FullName }

Write-Output ''
Write-Output '=== GGUF MODEL FILES (high tier) ==='
Get-ChildItem 'C:\Users\Sue' -Recurse -Include '*Flash*Next*.gguf','*flash*next*.gguf' -ErrorAction SilentlyContinue |
  ForEach-Object { "{0,8:N1} MB  {1}" -f ($_.Length/1MB), $_.FullName }

Write-Output ''
Write-Output '=== STRATA PROCESS + CMDLINE ==='
Get-CimInstance Win32_Process -Filter "Name LIKE '%strata%' OR Name LIKE '%llama%'" -ErrorAction SilentlyContinue |
  ForEach-Object { "PID {0}: {1}" -f $_.ProcessId, $_.CommandLine }

Write-Output ''
Write-Output '=== VRAM HEADROOM (nvidia-smi) ==='
nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free --format=csv 2>$null
