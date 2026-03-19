# PowerShell script to download player.tsx
$url = "https://fix-test-deploy.preview.emergentagent.com/player_download.txt"
$output = "C:\Users\Curtm\PrivastreamCinema\frontend\app\player.tsx"
Invoke-WebRequest -Uri $url -OutFile $output
Write-Host "Downloaded player.tsx successfully!"
