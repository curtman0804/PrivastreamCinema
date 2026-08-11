# ============================================================================
# patch_v405.ps1 - Best-quality-first sort. Both good streams matched the
# whitelist, so v404 put them in the same bucket - and within it, v357's
# quality sort kept the 1080p above the 4K. User wants "english + best
# quality," so make resolution the primary key across promo+mid buckets.
#
# New sort order for parsed:
#   [ (promo + mid), sorted by:
#       1. resolution DESC (2160 > 1080 > 720 > ...)
#       2. whitelist match ties: whitelisted wins
#       3. cached wins over uncached
#   ] + [ demoted, sorted by resolution DESC ]
#
# The 1.09 GB 1080p-BluRay file that shipped with the "fireside chat"
# had no COMPLETE/DISC/EXTRAS marker in its title, so we can't demote by
# name. But now the 4K release simply outranks it and Play grabs 4K.
#
# REQUIRES: v403 + v404. Idempotent.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V405  Best-quality-first sort" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$idPath = 'app\details\[type]\[id].tsx'
$idAbs = (Resolve-Path -LiteralPath $idPath).Path
$id = [System.IO.File]::ReadAllText($idAbs)

if (-not $id.Contains('V403_ENG_GROUP_PROMOTE')) {
  Write-Host "[FATAL] v403 not applied first" -ForegroundColor Red; exit 1
}
if ($id.Contains('V405_BEST_QUALITY_FIRST')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow; exit 0
}

$old = @'
      parsed.length = 0;
      for (var _k = 0; _k < _promo.length;   _k++) parsed.push(_promo[_k]);
      for (var _k = 0; _k < _mid.length;     _k++) parsed.push(_mid[_k]);
      for (var _k = 0; _k < _demoted.length; _k++) parsed.push(_demoted[_k]);
'@
$new = @'
      /* V405_BEST_QUALITY_FIRST - user wants "english + best quality."
         Merge promo + mid into one pool and sort by:
           1) resolution DESC (2160 > 1440 > 1080 > 720 > 480)
           2) whitelist tie-breaker (english-only group wins)
           3) cached tie-breaker (has URL wins)
         Demoted bucket stays at the bottom, also sorted by res DESC. */
      var _v405Res = function (p) {
        var t = _v403GetTitle(p);
        if (/\b2160P\b|\b4K\b|\bUHD\b/.test(t)) return 2160;
        if (/\b1440P\b|\bQHD\b/.test(t))         return 1440;
        if (/\b1080P\b|\bFHD\b/.test(t))         return 1080;
        if (/\b720P\b|\bHD\b/.test(t))           return 720;
        if (/\b480P\b|\bSD\b/.test(t))           return 480;
        return 0;
      };
      var _v405Cached = function (p) {
        try { return (p && p.stream && p.stream.url) ? 1 : 0; } catch (_) { return 0; }
      };
      var _v405Cmp = function (a, b) {
        var ra = _v405Res(a), rb = _v405Res(b);
        if (rb !== ra) return rb - ra;
        var wa = _v403Whitelist.test(_v403GetTitle(a)) ? 1 : 0;
        var wb = _v403Whitelist.test(_v403GetTitle(b)) ? 1 : 0;
        if (wb !== wa) return wb - wa;
        return _v405Cached(b) - _v405Cached(a);
      };
      var _v405Pool = _promo.concat(_mid);
      _v405Pool.sort(_v405Cmp);
      _demoted.sort(function (a, b) { return _v405Res(b) - _v405Res(a); });
      parsed.length = 0;
      for (var _k = 0; _k < _v405Pool.length;   _k++) parsed.push(_v405Pool[_k]);
      for (var _k = 0; _k < _demoted.length;    _k++) parsed.push(_demoted[_k]);
      try {
        console.log('[V405 QUALITY] top3=' + _v405Pool.slice(0, 3).map(function (p) {
          return _v405Res(p) + 'p' + (_v405Cached(p) ? '(c)' : '');
        }).join(', ') + ' | demoted=' + _demoted.length);
      } catch (_) {}
'@
if (-not $id.Contains($old)) {
  Write-Host "[FATAL] anchor missing (v403 bucket-push block)" -ForegroundColor Red
  Write-Host "Run and send me:" -ForegroundColor Yellow
  Write-Host '  findstr /N /C:"V403 PROMOTE" "app\details\[type]\[id].tsx"' -ForegroundColor Yellow
  Write-Host '  findstr /N /C:"V404 PROMOTE" "app\details\[type]\[id].tsx"' -ForegroundColor Yellow
  exit 1
}
$id = $id.Replace($old, $new)

[System.IO.File]::WriteAllText($idAbs, $id)
Write-Host "[OK] parsed now sorted by resolution DESC across promo+mid" -ForegroundColor Green

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V405 applied. Then:" -ForegroundColor Cyan
Write-Host "    deploy_ota.bat" -ForegroundColor Cyan
Write-Host "    South Park S1E1 -> Play. Card 1 should now be the 4K." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
