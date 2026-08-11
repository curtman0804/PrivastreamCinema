# patch_v422.ps1 - Prepend backend URL to relative subtitle URLs
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host "========================================="
Write-Host "  V422  Absolute URL for backend subs"
Write-Host "========================================="

$pPath = 'app\player.tsx'
$pAbs  = (Resolve-Path -LiteralPath $pPath).Path
$p     = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V422_ABS_SUB_URL')) { Write-Host "[SKIP] already applied"; exit 0 }

$old = @'
      console.log('[SUBTITLES] Fetching subtitle file:', subtitleUrl);
      const response = await fetch(subtitleUrl);
'@
$new = @'
      /* V422_ABS_SUB_URL - if the sub URL is a relative path returned
         by our own backend (V413 REST), prepend the backend base URL
         so fetch() gets an absolute URL. */
      let _v422Url = subtitleUrl;
      if (_v422Url && _v422Url.startsWith('/api/')) {
        const _base = (process.env.EXPO_PUBLIC_BACKEND_URL || 'http://5.161.49.99:8001').replace(/\/$/, '');
        _v422Url = _base + _v422Url;
      }
      console.log('[SUBTITLES] Fetching subtitle file:', _v422Url);
      const response = await fetch(_v422Url);
'@

if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor missing"; exit 1 }
$p = $p.Replace($old, $new)

# Bump stamp
$p = $p.Replace("OTA v417", "OTA v422")

[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] v422 patched"
Write-Host ""
Write-Host "Now run: deploy_ota.bat"
