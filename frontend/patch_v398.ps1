# ============================================================================
# patch_v398.ps1 - ENGLISH WALL: foreign streams can never win (OTA)
#
# ROOT CAUSE of South Park S1E1 playing in another language:
#   The details ranker's cached/uncached hard partition (V357) runs ABOVE
#   language. A Premiumize-cached German/Russian release therefore beats
#   EVERY uncached English stream - V323's -5000 foreign penalty only
#   reorders WITHIN a bucket, it can't cross the partition wall.
#
# FIX:
#   1. [id].tsx: language becomes the TOPMOST wall. All English buckets
#      (cached-SDR > cached-HDR > uncached-SDR > uncached-HDR) come first;
#      ALL detected-foreign streams go to the very back. Detection is also
#      widened: non-English flag emojis (Torrentio often tags language with
#      flags only), CJK characters, MULTi/DUAL releases (default audio track
#      is usually not English), GER/DEU/ITA/KOR/JPN short tags.
#   2. player.tsx: the Play Next binge path's v388 foreign detector gets the
#      same widened keyword set + CJK detection.
#
# REQUIRES: v357 + v388 applied.
# Idempotent: safe to re-run.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V398 English Wall" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# ------------------------------------------------------------------
# 1) [id].tsx - English wall above the cached/HDR partition
# ------------------------------------------------------------------
$idPath = 'app\details\[type]\[id].tsx'
if (!(Test-Path -LiteralPath $idPath)) { Write-Host "[FATAL] $idPath not found - wrong CWD?" -ForegroundColor Red; exit 1 }
$idAbs = (Resolve-Path -LiteralPath $idPath).Path
$id = [System.IO.File]::ReadAllText($idAbs)

if ($id.Contains('V398_ENGLISH_WALL')) {
  Write-Host "[SKIP] id.tsx already patched" -ForegroundColor Yellow
} else {
  if (-not $id.Contains('V357_SDR_HARD_PARTITION')) {
    Write-Host "[FATAL] V357 partition not found in id.tsx - run patch_v357.ps1 first!" -ForegroundColor Red
    exit 1
  }

  $old = @'
    const _v357_isHdr = (p: any) => !!(p && p.info && p.info.isHDR);
    const _v357_cSdr = parsed.filter((p) => !!p.stream.url && !_v357_isHdr(p));
    const _v357_cHdr = parsed.filter((p) => !!p.stream.url && _v357_isHdr(p));
    const _v357_uSdr = parsed.filter((p) => !p.stream.url && !_v357_isHdr(p));
    const _v357_uHdr = parsed.filter((p) => !p.stream.url && _v357_isHdr(p));
'@
  $new = @'
    const _v357_isHdr = (p: any) => !!(p && p.info && p.info.isHDR);
    /* V398_ENGLISH_WALL - language is now the TOPMOST wall. The cached
       partition used to run above language, so a PM-cached foreign release
       always beat every uncached English stream (V323's -5000 only reorders
       WITHIN a bucket). All foreign streams now go to the very back.
       Detection widened: flag emojis, CJK, MULTi/DUAL, short lang tags. */
    const _v398IsForeign = (p: any): boolean => {
      try {
        if (p && p.info && p.info.isForeign === true) return true;
        const _raw = String((p && p.stream && ((p.stream as any).title || (p.stream as any).name || (p.stream as any).filename)) || '');
        if (/[\u0400-\u04FF]/.test(_raw)) return true; /* Cyrillic */
        if (/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(_raw)) return true; /* CJK */
        const _fl = _raw.match(/\uD83C[\uDDE6-\uDDFF]\uD83C[\uDDE6-\uDDFF]/g) || [];
        const _engFl = ['\uD83C\uDDEC\uD83C\uDDE7', '\uD83C\uDDFA\uD83C\uDDF8', '\uD83C\uDDE8\uD83C\uDDE6', '\uD83C\uDDE6\uD83C\uDDFA', '\uD83C\uDDF3\uD83C\uDDFF', '\uD83C\uDDEE\uD83C\uDDEA'];
        for (let _i = 0; _i < _fl.length; _i++) { if (_engFl.indexOf(_fl[_i]) === -1) return true; }
        const _u = _raw.toUpperCase().replace(/MULTI[\s.\-]?SUBS?/g, '');
        if (/\bVOSTFR\b|\bVOSTA\b|\bVFF\b|\bVFQ\b|\bTRUEFRENCH\b|\bFRENCH\b|\bFRA\b/.test(_u)) return true;
        if (/\bGERMAN\b|\bDEUTSCH\b|\bGER\b|\bDEU\b/.test(_u)) return true;
        if (/\bITALIAN\b|\bITALIANO\b|\bITA\b/.test(_u)) return true;
        if (/\bSPANISH\b|\bESPANOL\b|\bCASTELLANO\b|\bLATINO\b/.test(_u)) return true;
        if (/\bRUSSIAN\b|\bRUS\b|\bUKRAINIAN\b|\bUKR\b/.test(_u)) return true;
        if (/\bKOREAN\b|\bKOR\b|\bJAPANESE\b|\bJPN\b|\bCHINESE\b|\bCHS\b|\bCHT\b/.test(_u)) return true;
        if (/\bPOLISH\b|\bLEKTOR\b|\bTURKISH\b|\bHINDI\b|\bTAMIL\b|\bTELUGU\b|\bDUBLADO\b|\bPORTUGUESE\b|\bDUTCH\b/.test(_u)) return true;
        if (/\bMULTI\b|\bMULTI[\s.\-]?AUDIO\b|\bDUAL\b|\bDUAL[\s.\-]?AUDIO\b|\bDUBBED\b/.test(_u)) return true;
        return false;
      } catch (_) { return false; }
    };
    const _v398eng = parsed.filter((p) => !_v398IsForeign(p));
    const _v398for = parsed.filter((p) => _v398IsForeign(p));
    const _v357_cSdr = _v398eng.filter((p) => !!p.stream.url && !_v357_isHdr(p));
    const _v357_cHdr = _v398eng.filter((p) => !!p.stream.url && _v357_isHdr(p));
    const _v357_uSdr = _v398eng.filter((p) => !p.stream.url && !_v357_isHdr(p));
    const _v357_uHdr = _v398eng.filter((p) => !p.stream.url && _v357_isHdr(p));
    const _v398f_c = _v398for.filter((p) => !!p.stream.url);
    const _v398f_u = _v398for.filter((p) => !p.stream.url);
'@
  if (-not $id.Contains($old)) { Write-Host "[FATAL] id.tsx anchor 1 missing (V357 bucket filters)" -ForegroundColor Red; exit 1 }
  $id = $id.Replace($old, $new)

  $old = @'
    for (const p of _v357_uHdr) parsed.push(p);
    console.log('[V357 PARTITION]',
'@
  $new = @'
    for (const p of _v357_uHdr) parsed.push(p);
    _v398f_c.sort(_v357_sortScore);
    _v398f_u.sort(_v357_sortScore);
    for (const p of _v398f_c) parsed.push(p);
    for (const p of _v398f_u) parsed.push(p);
    console.log('[V398 ENGLISH WALL] eng=' + _v398eng.length + ' foreign=' + _v398for.length);
    console.log('[V357 PARTITION]',
'@
  if (-not $id.Contains($old)) { Write-Host "[FATAL] id.tsx anchor 2 missing (V357 pushes)" -ForegroundColor Red; exit 1 }
  $id = $id.Replace($old, $new)

  [System.IO.File]::WriteAllText($idAbs, $id)
  Write-Host "[OK] id.tsx: English wall above cached partition" -ForegroundColor Green
}

# ------------------------------------------------------------------
# 2) player.tsx - widen v388 binge-path foreign detection
# ------------------------------------------------------------------
$pPath = 'app\player.tsx'
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V398_STRICT_ENGLISH')) {
  Write-Host "[SKIP] player.tsx already patched" -ForegroundColor Yellow
} else {
  if (-not $p.Contains('V388_ENGLISH_FIRST')) {
    Write-Host "[FATAL] V388 not found in player.tsx - run patch_v388.ps1 first!" -ForegroundColor Red
    exit 1
  }
  $old = @'
              if (/\b(RUS|RUSSIAN|HINDI|VOSTFR|TRUEFRENCH|FRENCH|LATINO|CASTELLANO|SPANISH|GERMAN|DEUTSCH|ITALIAN|ITALIANO|DUBLADO|LEKTOR|KOREAN|POLISH|UKRAINIAN)\b/.test(t)) return true;
'@
  $new = @'
              /* V398_STRICT_ENGLISH - widened: short lang tags, MULTi/DUAL
                 (default audio usually not English), CJK characters. */
              const _v398t = t.replace(/MULTI[\s.\-]?SUBS?/g, '');
              if (/\b(RUS|RUSSIAN|HINDI|TAMIL|TELUGU|VOSTFR|VOSTA|VFF|VFQ|TRUEFRENCH|FRENCH|FRA|LATINO|CASTELLANO|SPANISH|ESPANOL|GERMAN|DEUTSCH|GER|DEU|ITALIAN|ITALIANO|ITA|DUBLADO|PORTUGUESE|LEKTOR|KOREAN|KOR|JAPANESE|JPN|CHINESE|CHS|CHT|POLISH|UKRAINIAN|UKR|TURKISH|DUTCH|MULTI|DUAL|DUBBED)\b/.test(_v398t)) return true;
              if (/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(t)) return true;
'@
  if (-not $p.Contains($old)) { Write-Host "[FATAL] player.tsx anchor missing (v388 keyword line)" -ForegroundColor Red; exit 1 }
  $p = $p.Replace($old, $new)
  [System.IO.File]::WriteAllText($pAbs, $p)
  Write-Host "[OK] player.tsx: binge foreign detection widened" -ForegroundColor Green
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V398 applied. Verify on disk:" -ForegroundColor Cyan
Write-Host '  findstr /C:"V398_ENGLISH_WALL" "app\details\[type]\[id].tsx"'
Write-Host "=========================================" -ForegroundColor Cyan
