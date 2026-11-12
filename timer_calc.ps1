$t0 = [datetime]'2026-11-09T17:14:42.932'
$now = Get-Date
Write-Output ("END=" + $now.ToString('HH:mm:ss.fff'))
Write-Output ("ELAPSED_MS=" + [math]::Round(($now - $t0).TotalMilliseconds))
