# patch_v324_force_4k_large.ps1
# V324 - Lock auto-pick to the largest 4K/2160p English stream available.
#
# User has identified the exact class of stream they want:
#   "Project.Hail.Mary.2026.2160p.WEB-DL.DDP5.1.Atmos.H.265-RDNYB"
#   23.82 GB / 2160p / 1619 seeders / English.
#
# Changes:
#   1. Add a +6000 bonus for any stream tagged 4K AND size >= 15 GB.
#      This dominates every other score factor (cache bonus +5000,
#      quality +800, language +1000, size +1500).  A legit big 4K
#      stream now wins by margin >2000 over any 1080p competitor.
#   2. Log at the top of sortStreamsByLanguage the count of incoming
#      streams by quality.  If the 4K stream never enters the
#      function (filtered out somewhere upstream), we'll see
#      "4K=0" and know to look at the backend addon path instead.
#
# Target: app\details\[type]\[id].tsx only.  ASCII anchors.

$ErrorActionPreference = 'Stop'
$f = 'app\details\[type]\[id].tsx'
if (-not (Test-Path -LiteralPath $f)) {
  $alt = 'app\details\id.tsx'
  if (Test-Path -LiteralPath $alt) { $f = $alt }
  else { Write-Host '[v324] ERROR: cannot find id.tsx'; exit 1 }
}

$s = Get-Content -Raw -LiteralPath $f
if ($s -match 'V324_FORCE_4K') {
  Write-Host '[v324] already patched, skipping'
  exit 0
}

# ---------- Part 1: Quality histogram at the top of sortStreams ----------
$bad1 = 'function sortStreamsByLanguage(streams: Stream[]): Stream[] {'
$good1 = @'
function sortStreamsByLanguage(streams: Stream[]): Stream[] {
  /* V324_FORCE_4K - quality histogram of input streams so we can see
     whether 4K options are even reaching the scorer. */
  try {
    const _v324hist: { [k: string]: number } = {};
    let _v324bigCount = 0;
    let _v324big4kCount = 0;
    for (const _s of (streams || [])) {
      const _t = (((_s as any)?.title || '') + ' ' + ((_s as any)?.name || '')).toUpperCase();
      let _q = 'SD';
      if (_t.includes('4K') || _t.includes('2160')) _q = '4K';
      else if (_t.includes('1080')) _q = '1080p';
      else if (_t.includes('720')) _q = '720p';
      _v324hist[_q] = (_v324hist[_q] || 0) + 1;
      const _szm = _t.match(/([\d.]+)\s*GB/);
      const _sz = _szm ? parseFloat(_szm[1]) : 0;
      if (_sz >= 15) _v324bigCount++;
      if (_sz >= 15 && _q === '4K') _v324big4kCount++;
    }
    console.log('[V324 INPUT]', 'total=' + (streams || []).length, 'hist=' + JSON.stringify(_v324hist), 'bigStreams(>=15GB)=' + _v324bigCount, 'big4K=' + _v324big4kCount);
  } catch (_) {}
'@
if (-not $s.Contains($bad1)) { Write-Host '[v324] ERROR: sortStreamsByLanguage signature anchor not found'; exit 2 }
$s = $s.Replace($bad1, $good1)

# ---------- Part 2: +6000 bonus for big 4K streams ----------
# Inject inside computeScore right after V323's foreign-penalty block.
$bad2 = @'
      if (_v323isForeign) {
        s -= 5000;
        try {
          console.log('[V323] FOREIGN penalty -5000 (cyrillic=' + _v323HasCyrillic + ' cjk=' + _v323HasCJK + ' tags=' + _v323foreignTags + ') | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
        } catch (_) {}
      }
    }
'@
$good2 = @'
      if (_v323isForeign) {
        s -= 5000;
        try {
          console.log('[V323] FOREIGN penalty -5000 (cyrillic=' + _v323HasCyrillic + ' cjk=' + _v323HasCJK + ' tags=' + _v323foreignTags + ') | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
        } catch (_) {}
      }
      /* V324_FORCE_4K - lock auto-pick to large 4K English streams.
         A legit big 4K rip in English now beats every other option by
         margin >2000.  Foreign 4K streams still lose because V323
         already subtracted 5000 above. */
      if (info.quality === '4K' && !_v323isForeign) {
        // Parse size from the same blob we already built.
        const _v324szM = (_v323blob + ' ' + (info.size || '')).toUpperCase().match(/([\d.]+)\s*GB/);
        const _v324GB = _v324szM ? parseFloat(_v324szM[1]) : 0;
        if (_v324GB >= 15) {
          s += 6000;
          try {
            console.log('[V324] BIG-4K bonus +6000 size=' + _v324GB + 'GB | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
          } catch (_) {}
        } else if (_v324GB >= 8) {
          s += 2000;
          try {
            console.log('[V324] MID-4K bonus +2000 size=' + _v324GB + 'GB | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
          } catch (_) {}
        }
      }
    }
'@
if (-not $s.Contains($bad2)) { Write-Host '[v324] ERROR: V323 foreign-penalty anchor not found - is V323 applied?'; exit 3 }
$s = $s.Replace($bad2, $good2)

Set-Content -LiteralPath $f -Value $s -NoNewline -Encoding UTF8

Write-Host '[v324] id.tsx patched - V324_FORCE_4K marker present'
Write-Host '[v324] Effect: any 4K English stream >= 15 GB now wins auto-pick by margin >2000'
Write-Host '[v324] Also: every load of stream list logs [V324 INPUT] with quality histogram'
Write-Host '[v324]   - If big4K=0, the 23.82 GB stream is NOT reaching the scorer (backend issue)'
Write-Host '[v324]   - If big4K>=1, V324 will pick it deterministically'
Write-Host '[v324] Run deploy_ota.bat, force-stop app, reopen, retry PHM.'
