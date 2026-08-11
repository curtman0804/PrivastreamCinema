# ============================================================================
# patch_v412.ps1 - Collapse the CC picker to ONE row per language +
#                  hide Forced/HI variants from manual selection.
#
# BEFORE: after backend v407 stopped deduping, the modal now shows 5+
# English entries plus a bunch of duplicates. Confusing for users -
# they just want "English", "Spanish", etc.
#
# AFTER: one row per language. Forced/HI variants are silently excluded
# from the picker rows (the v411 auto-loader still sees them because it
# scans the raw `subtitles` array, not the picker rows).
#
# REQUIRES: v411. Idempotent.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V412  CC picker dedupe + hide Forced/HI" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if (-not $p.Contains('V411_FORCED_PREFERRED')) {
  Write-Host "[FATAL] v411 not applied first" -ForegroundColor Red; exit 1
}
if ($p.Contains('V412_PICKER_DEDUPE')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow; exit 0
}

$old = @'
                data={[{ id: 'off', url: '', lang: 'off', langName: 'Off' }, ...subtitles]}
'@
$new = @'
                /* V412_PICKER_DEDUPE - collapse to one row per language and
                   drop Forced/HI variants (those are only for auto-load). */
                data={(() => {
                  const _seen = new Set<string>();
                  const _rows: any[] = [{ id: 'off', url: '', lang: 'off', langName: 'Off' }];
                  const _hide = /(?:^|[._\-\s])(?:forced|foreign[._\-\s]*parts?[._\-\s]*only|foreign[._\-\s]*only|hi|hearing[._\-\s]*impaired|sdh)(?:[._\-\s]|\.srt$|$)/i;
                  for (const _s of (subtitles as any[])) {
                    const _fn = String((_s as any).filename || '');
                    if (_fn && _hide.test(_fn)) continue;
                    const _l = String(_s.lang || 'unknown');
                    if (_seen.has(_l)) continue;
                    _seen.add(_l);
                    _rows.push(_s);
                  }
                  return _rows;
                })()}
'@
if (-not $p.Contains($old)) {
  Write-Host "[FATAL] anchor missing (picker FlatList data)" -ForegroundColor Red; exit 1
}
$p = $p.Replace($old, $new)
[System.IO.File]::WriteAllText($pAbs, $p)

Write-Host "[OK] picker collapsed to one row per language" -ForegroundColor Green
Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V412 applied. Then:" -ForegroundColor Cyan
Write-Host "    deploy_ota.bat" -ForegroundColor Cyan
Write-Host "" -ForegroundColor Cyan
Write-Host "  Picker will now show:  Off / English / Spanish / French /..." -ForegroundColor Cyan
Write-Host "  One clean row per language. Auto-load (Shang-Chi Forced" -ForegroundColor Cyan
Write-Host "  sub) still finds Forced/HI variants in the raw list." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
