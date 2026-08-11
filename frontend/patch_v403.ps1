# ============================================================================
# patch_v403.ps1 - Real fix at the PICKER (english-group whitelist boost),
#                  and remove the diag overlay + SWAP button + toast.
#
# What changed since v400/v401/v402b:
#   * fbCount was 0 -> only ONE stream reaches the player, so no cascade can
#     save us. The bad pick's title looked English (`CtrlHD`) but the audio
#     on disk is foreign - no title regex would catch that.
#   * When you manually clicked card 3 in details, English played. That
#     means English streams ARE in `parsed`; they're just not at index 0.
#
# Fix: promote streams tagged with well-known English-only p2p/scene groups
# to the very front of `parsed`, so Play grabs one of those first. Demote
# CtrlHD (which packages multi-audio Blu-Rays and hit you here).
#
# UI cleanup: kill the green diag box, the gold SWAP pill, the toast.
#
# REQUIRES: v398b + v400 + v401 + v402b applied. Idempotent.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V403  English-group whitelist + UI cleanup" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 1) [id].tsx - whitelist promote at the end of parsed build
# ---------------------------------------------------------------------------
$idPath = 'app\details\[type]\[id].tsx'
$idAbs = (Resolve-Path -LiteralPath $idPath).Path
$id = [System.IO.File]::ReadAllText($idAbs)

if (-not $id.Contains('V400_ENGLISH_HARD_GUARD')) {
  Write-Host "[FATAL] v400 not applied in id.tsx" -ForegroundColor Red; exit 1
}
if ($id.Contains('V403_ENG_GROUP_PROMOTE')) {
  Write-Host "[SKIP] id.tsx already patched" -ForegroundColor Yellow
} else {
  $old = @'
    console.log('[V398 ENGLISH WALL] eng=' + _v398eng.length + ' foreign=' + _v398for.length);
'@
  $new = @'
    console.log('[V398 ENGLISH WALL] eng=' + _v398eng.length + ' foreign=' + _v398for.length);
    /* V403_ENG_GROUP_PROMOTE - regex-based english-only release-group boost.
       Detector on release title alone cannot distinguish an English-titled
       release with foreign audio from a real English release. Instead we
       promote streams whose title contains a known English-only p2p/scene
       group tag to the very front of `parsed`, and demote known multi-
       audio Blu-Ray packagers (CtrlHD) below them. */
    try {
      var _v403GetTitle = function (p) {
        try {
          var s = (p && p.stream) || {};
          return String((s.title || s.name || s.filename || '') + ' ' + ((p && p.info && p.info.title) || '')).toUpperCase();
        } catch (_) { return ''; }
      };
      /* English-only groups: web-p2p and scene releases that virtually
         never carry foreign audio tracks. Conservative on purpose. */
      var _v403Whitelist = /\b(?:PSA|EDITH|FLUX|NTB|NTG|PLAYWEB|PLAYHD|GALAXYRG|GALAXYTV|KOGI|TEPES|RUBIK|ETHEL|HONE|TRUFFLE|ELITE|INSPIRE|EMBER|RCVR|SMURF|ORENJI|TERMINAL|MEMENTO|DEFLATE|LAZY|SVA|JYK|KRALIMARKO|TSAHDMI|MZABI|SPARKS|DIMENSION|LOL|KILLERS|ASAP|EVOLVE|FLEET|TBS|RARBG|YIFY|YTS|SUCCESSFULCRAB|MINX|FTP|KOGI|W4F|CAKES|PUBLICHD|CBFM|GGWP|WELP|SYNCOPY|CADAVER|FLUX|MEECH|FGT|SHORTBREHD)\b/;
      /* Groups whose titles look English but often ship multi-audio Blu-Ray
         (default track may not be English via debrid transcode). */
      var _v403Demote = /\b(?:CTRLHD|IMMERSE|WIKI|D-Z0N3|BLURAY-USURY|USURY)\b/;
      var _promo = [];
      var _demoted = [];
      var _mid = [];
      for (var _i = 0; _i < parsed.length; _i++) {
        var _t = _v403GetTitle(parsed[_i]);
        if (_v403Whitelist.test(_t)) _promo.push(parsed[_i]);
        else if (_v403Demote.test(_t)) _demoted.push(parsed[_i]);
        else _mid.push(parsed[_i]);
      }
      parsed.length = 0;
      for (var _k = 0; _k < _promo.length;   _k++) parsed.push(_promo[_k]);
      for (var _k = 0; _k < _mid.length;     _k++) parsed.push(_mid[_k]);
      for (var _k = 0; _k < _demoted.length; _k++) parsed.push(_demoted[_k]);
      console.log('[V403 PROMOTE] promoted=' + _promo.length + ' demoted=' + _demoted.length + ' mid=' + _mid.length);
    } catch (_) {}
'@
  if (-not $id.Contains($old)) {
    Write-Host "[FATAL] id.tsx anchor missing (v400 console.log tail)" -ForegroundColor Red; exit 1
  }
  $id = $id.Replace($old, $new)
  [System.IO.File]::WriteAllText($idAbs, $id)
  Write-Host "[OK] id.tsx: whitelist promote + demote applied" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 2) player.tsx - hide diag, remove SWAP pill, gate toast, disable MENU
# ---------------------------------------------------------------------------
$pPath = 'app\player.tsx'
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V403_UI_CLEAN')) {
  Write-Host "[SKIP] player.tsx already cleaned" -ForegroundColor Yellow
} else {
  # 2a: hide the green diag overlay by initialising _v400Tag = false
  $old = @'
  const [_v400Tag, setV400Tag] = useState(true);
'@
  $new = @'
  const [_v400Tag, setV400Tag] = useState(false); /* V403_UI_CLEAN - diag off */
'@
  if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 2a missing" -ForegroundColor Red; exit 1 }
  $p = $p.Replace($old, $new)
  Write-Host "[OK] 2a: diag overlay silenced" -ForegroundColor Green

  # 2b: remove the gold SWAP pill JSX block entirely
  $old = @'
            {/* V402_STREAM_HOP - focusable SWAP pill top-left */}
            <TouchableOpacity
              onPress={_v402Swap}
              activeOpacity={0.7}
              focusable
              style={{
                position: 'absolute',
                top: 24,
                left: 24,
                backgroundColor: 'rgba(15,15,15,0.88)',
                borderColor: '#B8A05C',
                borderWidth: 1.5,
                borderRadius: 8,
                paddingHorizontal: 16,
                paddingVertical: 10,
                zIndex: 61,
              }}
            >
              <Text style={{ color: '#B8A05C', fontSize: 13, fontWeight: '800', letterSpacing: 0.6 }}>
                SWAP STREAM
              </Text>
              <Text style={{ color: '#888', fontSize: 9, marginTop: 2 }}>
                MENU key or focus + SELECT
              </Text>
            </TouchableOpacity>
'@
  $new = @'
            {/* V403_UI_CLEAN - SWAP pill removed */}
'@
  if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 2b missing (SWAP pill JSX)" -ForegroundColor Red; exit 1 }
  $p = $p.Replace($old, $new)
  Write-Host "[OK] 2b: SWAP pill removed" -ForegroundColor Green

  # 2c: gate the toast off (also blocks any accidental MENU trigger)
  $old = @'
            {_v402Toast && (
'@
  $new = @'
            {false && _v402Toast && ( /* V403_UI_CLEAN - toast off */
'@
  if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 2c missing (toast gate)" -ForegroundColor Red; exit 1 }
  $p = $p.Replace($old, $new)
  Write-Host "[OK] 2c: toast off" -ForegroundColor Green

  # 2d: disable the MENU TVEventHandler so no hidden swaps happen
  $old = @'
      if (TVEventHandler) {
        _sub = new TVEventHandler();
        _sub.enable(null, (_c: any, evt: any) => {
          try {
            const et = String((evt && (evt.eventType || evt.eventKeyAction)) || '').toLowerCase();
            if (et === 'menu' || et === 'info') _v402Swap();
          } catch (_) {}
        });
      }
'@
  $new = @'
      if (false && TVEventHandler) { /* V403_UI_CLEAN - MENU handler off */
        _sub = new TVEventHandler();
        _sub.enable(null, (_c: any, evt: any) => {
          try {
            const et = String((evt && (evt.eventType || evt.eventKeyAction)) || '').toLowerCase();
            if (et === 'menu' || et === 'info') _v402Swap();
          } catch (_) {}
        });
      }
'@
  if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 2d missing (TVEventHandler)" -ForegroundColor Red; exit 1 }
  $p = $p.Replace($old, $new)
  Write-Host "[OK] 2d: MENU handler disabled" -ForegroundColor Green

  [System.IO.File]::WriteAllText($pAbs, $p)
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V403 applied. Then:" -ForegroundColor Cyan
Write-Host "    deploy_ota.bat" -ForegroundColor Cyan
Write-Host "    South Park S1E1 -> Play." -ForegroundColor Cyan
Write-Host "    No overlays, no buttons. English should play." -ForegroundColor Cyan
Write-Host "    If it does NOT: send me the title text of card 1 and" -ForegroundColor Cyan
Write-Host "    the card that DID play English (whatever number it is)." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
