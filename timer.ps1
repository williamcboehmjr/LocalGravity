$mode = $args[0]
$now = Get-Date
if ($mode -eq 'start') {
  # persist start time to disk so the end call can compute elapsed
  Set-Content -Path 'C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity/_timer_start.txt' -Value $now.Ticks
  Write-Output ("START=" + $now.ToString('HH:mm:ss.fff'))
} else {
  $ticks = [long](Get-Content 'C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity/_timer_start.txt')
  $elapsedMs = ($now.Ticks - $ticks) / 10000
  Write-Output ("END=" + $now.ToString('HH:mm:ss.fff'))
  Write-Output ("ELAPSED_MS={0:N2}" -f $elapsedMs)
}
