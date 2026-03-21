# PowerShell script to download player.tsx
$url = "https://privastream-cinema-4.preview.emergentagent.com/player_download.txt"
$output = "C:\Users\Curtm\PrivastreamCinema\frontend\app\player.tsx"
Invoke-WebRequest -Uri $url -OutFile $output
Write-Host "Downloaded player.tsx successfully!"
