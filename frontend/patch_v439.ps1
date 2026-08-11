$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"
$fPath = 'src\components\ContentCard.tsx'
$fAbs = (Resolve-Path $fPath).Path
$f = [System.IO.File]::ReadAllText($fAbs)

if ($f.Contains("'@v304_release_status_cache_v2'")) { Write-Host "[SKIP]"; exit 0 }

$old = "const _V304_STORAGE_KEY = '@v304_release_status_cache_v1';"
$new = "const _V304_STORAGE_KEY = '@v304_release_status_cache_v2'; /* V439 - bumped to invalidate stale 'none' entries */"

if ($f.Contains($old)) {
    $f = $f.Replace($old, $new)
    [System.IO.File]::WriteAllText($fAbs, $f)
    Write-Host "[OK] v439 cache key bumped v1 -> v2"
} else {
    Write-Host "[FATAL] anchor missing"; exit 1
}
