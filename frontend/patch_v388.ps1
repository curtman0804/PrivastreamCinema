# ============================================================================
# patch_v388.ps1 - English-first stream pick for Play Next binge path (OTA)
#
# ROOT CAUSE: the v126/v128 "Play Next" fast-path takes the backend stream
# list verbatim (list[0] / list[1]) with NO language check, while normal
# playback goes through the details page's English-first sorter. If a
# Russian (or other foreign) release tops the backend ranking (seeders),
# the next episode auto-plays in that language.
#
# FIX: before the fast-path picks, reorder the list in place - English /
# unknown releases first, detected-foreign releases demoted to the back.
# Detection: country-flag emojis (without GB/US), language keywords, and
# Cyrillic characters in the title/filename. Fallback list inherits the
# same order, so retries stay English too.
#
# Idempotent: safe to re-run.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V388 English-First Binge Streams" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
if (!(Test-Path -LiteralPath $pPath)) { Write-Host "[FATAL] player.tsx not found" -ForegroundColor Red; exit 1 }
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V388_ENGLISH_FIRST')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow
  exit 0
}

$old = @'
          if (list.length === 0) { console.log('[PLAYER v128] no streams for next ep'); return; }
'@
$new = @'
          if (list.length === 0) { console.log('[PLAYER v128] no streams for next ep'); return; }
          /* V388_ENGLISH_FIRST - the fast path picked list[0] verbatim, so a
             foreign release topping the backend ranking auto-played the next
             episode in Russian/etc. Demote detected-foreign releases to the
             back of the list (in place, so list[0]/list[1]/fallbacks all
             inherit the order). */
          const _v388IsForeign = (s: any): boolean => {
            try {
              const t = String((s && (s.title || s.name || s.filename)) || '').toUpperCase();
              if (/[\u0400-\u04FF]/.test(t)) return true; /* Cyrillic */
              const hasEngFlag = /\uD83C\uDDEC\uD83C\uDDE7|\uD83C\uDDFA\uD83C\uDDF8/.test(t); /* GB / US */
              const hasForeignFlag = /\uD83C\uDDF7\uD83C\uDDFA|\uD83C\uDDEB\uD83C\uDDF7|\uD83C\uDDEA\uD83C\uDDF8|\uD83C\uDDF2\uD83C\uDDFD|\uD83C\uDDE9\uD83C\uDDEA|\uD83C\uDDEE\uD83C\uDDF9|\uD83C\uDDEE\uD83C\uDDF3|\uD83C\uDDE7\uD83C\uDDF7|\uD83C\uDDF5\uD83C\uDDF1|\uD83C\uDDFA\uD83C\uDDE6|\uD83C\uDDF0\uD83C\uDDF7|\uD83C\uDDEF\uD83C\uDDF5|\uD83C\uDDE8\uD83C\uDDF3/.test(t);
              if (hasForeignFlag && !hasEngFlag) return true;
              if (/\b(RUS|RUSSIAN|HINDI|VOSTFR|TRUEFRENCH|FRENCH|LATINO|CASTELLANO|SPANISH|GERMAN|DEUTSCH|ITALIAN|ITALIANO|DUBLADO|LEKTOR|KOREAN|POLISH|UKRAINIAN)\b/.test(t)) return true;
              return false;
            } catch (_) { return false; }
          };
          try {
            const _v388Eng = list.filter((s: any) => !_v388IsForeign(s));
            if (_v388Eng.length > 0 && _v388Eng.length < list.length) {
              const _v388For = list.filter((s: any) => _v388IsForeign(s));
              list.length = 0;
              Array.prototype.push.apply(list, _v388Eng.concat(_v388For));
              console.log('[PLAYER v388] reordered streams: ' + _v388Eng.length + ' ENG-first, ' + _v388For.length + ' foreign demoted');
            }
          } catch (_) {}
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] English-first reorder written to player.tsx" -ForegroundColor Green
Write-Host ""
Write-Host "Done. Run deploy_ota.bat, relaunch twice." -ForegroundColor Cyan
Write-Host ""
