Write-Host "Starting LocalGravity Client UI on http://localhost:5173..." -ForegroundColor Cyan
Set-Location -Path "$PSScriptRoot\client"
npm run dev
