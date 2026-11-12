$r = Invoke-WebRequest 'https://developer.android.com/studio' -UseBasicParsing
$pat = 'https?://[^\s"''<>]*commandlinetools-win[^\s"''<>]*'
$m = [regex]::Matches($r.Content, $pat)
$urls = $m | ForEach-Object { $_.Value } | Sort-Object -Unique
foreach ($u in $urls) { Write-Output $u }
