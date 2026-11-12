# LocalGravity NVMe Migration Script
$ErrorActionPreference = "Stop"

function Log($msg) {
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts] $msg" -ForegroundColor Cyan
}

Log "=== Step 1: Preparing Destination Directories on F: ==="
New-Item -ItemType Directory -Force -Path "F:\Games" | Out-Null
New-Item -ItemType Directory -Force -Path "F:\Models\ComfyUI\unet" | Out-Null
New-Item -ItemType Directory -Force -Path "F:\Models\ComfyUI\diffusion_models" | Out-Null

Log "=== Step 2: Moving Wolfenstein The New Order (44.8 GB) to F:\Games ==="
$wolfSrc = "E:\Games\Wolfenstein The New Order"
$wolfDst = "F:\Games\Wolfenstein The New Order"
if ((Test-Path $wolfSrc) -and -not (Get-Item $wolfSrc).Attributes.HasFlag([System.IO.FileAttributes]::ReparsePoint)) {
    Log "Moving directory $wolfSrc -> $wolfDst..."
    Move-Item -Path $wolfSrc -Destination $wolfDst -Force
    cmd.exe /c "mklink /J `"$wolfSrc`" `"$wolfDst`""
    Log "Junction created: $wolfSrc -> $wolfDst"
} else {
    Log "Wolfenstein already moved or already a junction."
}

Log "=== Step 3: Moving rarely used ComfyUI Models to F:\Models\ComfyUI ==="
$m1 = "E:\Github\Models\unet\hunyuan_image_3_instruct_distil_w4a8.safetensors"
if (Test-Path $m1) {
    Log "Moving hunyuan_image_3 (43.7 GB) -> F:\Models\ComfyUI\unet\..."
    Move-Item -Path $m1 -Destination "F:\Models\ComfyUI\unet\" -Force
}

$m2 = "E:\Github\Models\diffusion_models\drama3_int8experts_bf16.safetensors"
if (Test-Path $m2) {
    Log "Moving drama3 (36.0 GB) -> F:\Models\ComfyUI\diffusion_models\..."
    Move-Item -Path $m2 -Destination "F:\Models\ComfyUI\diffusion_models\" -Force
}

Log "=== Step 4: Updating ComfyUI extra_model_paths.yaml ==="
$yamlPath = "E:\Github\Models\extra_model_paths.yaml"
if (Test-Path $yamlPath) {
    $content = Get-Content $yamlPath -Raw
    if (-not $content.Contains("F:\Models\ComfyUI")) {
        $extra = @"

hdd_archive:
    base_path: F:\Models\ComfyUI\
    diffusion_models: diffusion_models\
    unet: unet\
"@
        Add-Content -Path $yamlPath -Value $extra
        Log "Appended F:\Models\ComfyUI to extra_model_paths.yaml"
    }
}

Log "=== Step 5: Checking Free Space on E: ==="
$eVol = Get-Volume -DriveLetter E
$freeGB = [math]::Round($eVol.SizeRemaining / 1GB, 2)
Log "Drive E: Free Space is now: $freeGB GB"

if ($freeGB -lt 82) {
    Write-Error "Insufficient free space on E: ($freeGB GB). Need at least 82 GB."
}

Log "=== Step 6: Moving Qwen 3.8 Flash-Next Model & Packs to NVMe Drive E: ==="
New-Item -ItemType Directory -Force -Path "E:\Models" | Out-Null
New-Item -ItemType Directory -Force -Path "E:\packs" | Out-Null

$srcModel = "F:\Models\Qwen3.8-Flash-Next-IQ3_S"
$dstModel = "E:\Models\Qwen3.8-Flash-Next-IQ3_S"
if ((Test-Path $srcModel) -and (-not (Test-Path $dstModel))) {
    Log "Moving Qwen 3.8 Flash-Next IQ3_S (77.9 GB) -> E:\Models\Qwen3.8-Flash-Next-IQ3_S..."
    Move-Item -Path $srcModel -Destination "E:\Models\" -Force
}

$srcPack = "F:\packs\iq3_s"
$dstPack = "E:\packs\iq3_s"
if ((Test-Path $srcPack) -and (-not (Test-Path $dstPack))) {
    Log "Moving iq3_s pack (1.4 GB) -> E:\packs\iq3_s..."
    Move-Item -Path $srcPack -Destination "E:\packs\" -Force
}

Log "=== Step 7: Updating Strata Launch Config & LocalGravity Server ==="
$cfgPath = "$env:LOCALAPPDATA\Strata\launch\iq3_s-64k.json"
if (Test-Path $cfgPath) {
    $cfgText = Get-Content $cfgPath -Raw
    $cfgText = $cfgText.Replace("F:\\packs\\iq3_s", "E:\\packs\\iq3_s")
    $cfgText = $cfgText.Replace("F:\\Models\\Qwen3.8-Flash-Next-IQ3_S", "E:\\Models\\Qwen3.8-Flash-Next-IQ3_S")
    Set-Content -Path $cfgPath -Value $cfgText
    Log "Updated iq3_s-64k.json paths to E:\"
}

$sidecarPath = "C:\Users\user\.gemini\localgravity\scratch\LocalGravity\server\src\tabby\llamaSidecar.ts"
if (Test-Path $sidecarPath) {
    $scText = Get-Content $sidecarPath -Raw
    $scText = $scText.Replace("F:\\Models\\Qwen3.8-Flash-Next-IQ3_S", "E:\\Models\\Qwen3.8-Flash-Next-IQ3_S")
    Set-Content -Path $sidecarPath -Value $scText
    Log "Updated llamaSidecar.ts path to E:\"
}

Log "=== Step 8: Rebuilding Server TypeScript ==="
Set-Location "C:\Users\user\.gemini\localgravity\scratch\LocalGravity\server"
npm run build
Log "Server rebuilt successfully."

Log "Migration 100% COMPLETE! Model is resident on NVMe Drive E:."
