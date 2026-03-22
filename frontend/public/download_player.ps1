# PowerShell script to download player.tsx
$url = "https://torrent-playback-fix.preview.emergentagent.com/player_download.txt"
$output = "C:\Users\Curtm\PrivastreamCinema\frontend\app\player.tsx"
Invoke-WebRequest -Uri $url -OutFile $output
Write-Host "Downloaded player.tsx successfully!"
