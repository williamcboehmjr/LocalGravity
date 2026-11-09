for ($i = 15; $i -ge 0; $i--) {
    Write-Output ("[timer] " + $i + " s remaining")
    Start-Sleep -Seconds 1
}
Write-Output "[timer] READY -> polling /health"
try {
    $code = (Invoke-WebRequest -Uri 'http://localhost:8080/health' -TimeoutSec 5).StatusCode
    Write-Output ("[poll] status " + $code)
} catch {
    Write-Output "[poll] engine not reachable"
}
