Write-Host "Starting LocalGravity Central Brain on port 3390..." -ForegroundColor Cyan
Set-Location -Path "$PSScriptRoot\brain"
& ".\.venv\Scripts\uvicorn.exe" src.main:app --host 0.0.0.0 --port 3390 --reload
