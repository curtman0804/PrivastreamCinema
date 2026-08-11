# ============================================================================
# patch_v404.ps1 - Demote disc-rip / season-pack releases so clean single-
# episode files win the pick. Also fixes v403's ordering bug where
# whitelist beat demote (letting COMPLETE.BluRay-PSA pass through).
#
# Symptom being fixed: after v403, English played but the picked file was
# a whole-Blu-Ray-disc rip that starts with a "fireside chat with the
# creators" featurette before the actual episode.
#
# Fix:
#   1) Reorder logic in v403 promote pass: check demote FIRST, then
#      whitelist, then mid.
#   2) Widen demote regex with disc-rip / season-pack / extras markers.
#
# REQUIRES: v403. Idempotent.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V404  Demote disc-rip / season-pack" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$idPath = 'app\details\[type]\[id].tsx'
$idAbs = (Resolve-Path -LiteralPath $idPath).Path
$id = [System.IO.File]::ReadAllText($idAbs)

if (-not $id.Contains('V403_ENG_GROUP_PROMOTE')) {
  Write-Host "[FATAL] v403 not applied first" -ForegroundColor Red; exit 1
}
if ($id.Contains('V404_DISCRIP_DEMOTE')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow; exit 0
}

# --- 1: replace the v403 demote regex with a widened one ---
$old = @'
      var _v403Demote = /\b(?:CTRLHD|IMMERSE|WIKI|D-Z0N3|BLURAY-USURY|USURY)\b/;
'@
$new = @'
      /* V404_DISCRIP_DEMOTE - widen demote list. These markers mean the
         file is a whole Blu-Ray disc, season pack, or contains extras
         (featurettes, commentary, fireside chats, deleted scenes, etc.).
         When Torrentio matches such a file to a single episode request,
         it just serves the concatenated disc as-is - which is why South
         Park S1E1 played through a "fireside chat with the creators"
         before the episode. Always demote below clean single-file rips. */
      var _v403Demote = /(?:\bCTRLHD\b|\bIMMERSE\b|\bWIKI\b|\bD-Z0N3\b|\bUSURY\b|\bCOMPLETE\b|\bSEASON\.?\s?\d\b|\bSEASONS?\b|\bBOXSET\b|\bBOX\.SET\b|\bBDMV\b|\bBD(?:25|50|66|100)\b|\bBLURAY-FULL\b|\bDISC\.?\d?\b|\bDISK\.?\d?\b|\bEXTRAS?\b|\bFEATURETTES?\b|\bCOMMENTAR(?:Y|IES)\b|\bBEHIND\.?THE\.?SCENES\b|\bDELETED\.?SCENES\b|\bCREATORS?\b|\bMAKING\.?OF\b|\bREMUX\b|\bUHD\.?BLURAY\.?COMPLETE\b|\bALL\.EPISODES\b)/;
'@
if (-not $id.Contains($old)) { Write-Host "[FATAL] anchor 1 missing" -ForegroundColor Red; exit 1 }
$id = $id.Replace($old, $new)
Write-Host "[OK] 1: demote regex widened" -ForegroundColor Green

# --- 2: flip the order so demote is checked BEFORE whitelist ---
$old = @'
      for (var _i = 0; _i < parsed.length; _i++) {
        var _t = _v403GetTitle(parsed[_i]);
        if (_v403Whitelist.test(_t)) _promo.push(parsed[_i]);
        else if (_v403Demote.test(_t)) _demoted.push(parsed[_i]);
        else _mid.push(parsed[_i]);
      }
'@
$new = @'
      for (var _i = 0; _i < parsed.length; _i++) {
        var _t = _v403GetTitle(parsed[_i]);
        /* V404 - check demote FIRST so a disc-rip tagged with a good
           group name (e.g. S01.COMPLETE.BluRay-PSA) still gets demoted. */
        if (_v403Demote.test(_t)) _demoted.push(parsed[_i]);
        else if (_v403Whitelist.test(_t)) _promo.push(parsed[_i]);
        else _mid.push(parsed[_i]);
      }
'@
if (-not $id.Contains($old)) { Write-Host "[FATAL] anchor 2 missing" -ForegroundColor Red; exit 1 }
$id = $id.Replace($old, $new)
Write-Host "[OK] 2: ordering fixed (demote > whitelist > mid)" -ForegroundColor Green

# --- 3: sentinel ---
$id = $id.Replace('[V403 PROMOTE]', '[V404 PROMOTE]')

[System.IO.File]::WriteAllText($idAbs, $id)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V404 applied. Then:" -ForegroundColor Cyan
Write-Host "    deploy_ota.bat" -ForegroundColor Cyan
Write-Host "    South Park S1E1 -> Play. Should be clean, straight into" -ForegroundColor Cyan
Write-Host "    the episode. If it opens with any extras/featurettes," -ForegroundColor Cyan
Write-Host "    send me the title of card 1 (whatever's now at the top" -ForegroundColor Cyan
Write-Host "    of your streams list) so I can widen the demote list." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
