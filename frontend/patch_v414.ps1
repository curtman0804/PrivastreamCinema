# ============================================================================
# patch_v414.ps1 - Picker row shows just "English" (no filename suffix).
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V414  Picker row = plain language name" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V414_CLEAN_PICKER')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow; exit 0
}

$old = @'
                      {item.langName}{(item as any).filename ? '  ·  ' + String((item as any).filename).slice(-40) : ''}{_v407AutoMatchRef.current && _v407AutoMatchRef.current.url === item.url ? '  (auto)' : ''}
'@
$new = @'
                      {item.langName}{/* V414_CLEAN_PICKER - no filename suffix, no (auto) tag */}
'@
if (-not $p.Contains($old)) {
  Write-Host "[FATAL] v407 picker text anchor missing" -ForegroundColor Red
  Write-Host "Run and send me:" -ForegroundColor Yellow
  Write-Host '  findstr /N /C:"_v407AutoMatchRef.current.url === item.url" app\player.tsx' -ForegroundColor Yellow
  exit 1
}
$p = $p.Replace($old, $new)
[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] picker rows now show just the language name" -ForegroundColor Green

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V414 applied. Then:  deploy_ota.bat" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
