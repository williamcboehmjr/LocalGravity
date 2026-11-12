<#
.SYNOPSIS
One-Click Startup Orchestrator for LocalGravity 2.0 (LocalGravity + TabbyAPI SysRAM Hot-Swap + Harness²)
Strictly enforces zero contact with ports 5000 and 5001.
#>
param(
    [switch]$Headless
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot

Write-Host "[1/3] Verifying Frontend & Fastify Daemon builds..." -ForegroundColor Cyan
if (!(Test-Path "$RepoRoot\client\dist\index.html")) {
    Push-Location "$RepoRoot\client"
    npm run build
    Pop-Location
}

if (!(Test-Path "$RepoRoot\server\dist\index.js")) {
    Push-Location "$RepoRoot\server"
    npm run build
    Pop-Location
}

Write-Host "[2/3] Launching LocalGravity Dynamic Port Orchestrator & SysRAM Warmer..." -ForegroundColor Cyan
if ($Headless) {
    node "$RepoRoot\launch.mjs" --headless
} else {
    node "$RepoRoot\launch.mjs"
}
