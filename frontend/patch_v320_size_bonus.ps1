# patch_v320_size_bonus.ps1
# V320 - File-size bonus.  V319 confirmed that 4K is now winning the
# auto-pick on most titles, but the user reports the 4K SDR/low-bitrate
# results still look "pale" while a 23.82 GB 4K stream looks great.
# Add a strong size-based bonus so high-bitrate REMUX/BluRay rips
# (typically 20-50 GB at 4K) beat low-bitrate WEB-DL encodes (4-12 GB)
# at the same nominal quality tier.  Size is already parsed by
# parseStreamInfo as a string like "23.82 GB".
#
# Tiers (added on top of V319's quality/HDR/HEVC scoring):
#   > 20 GB  -> +1500   (REMUX / full-bitrate BluRay rips)
#   > 10 GB  -> +800    (high-bitrate WEB-DL or compressed BluRay)
#   > 5  GB  -> +300    (standard WEB-DL)
#   <= 5 GB  ->  +0
#
# Net impact:
#   23.82 GB 4K = +800 (4K) + 500 (HDR if tagged) + 1500 (size) = ~+2800
#   8 GB 4K     = +800 (4K) + 0 (likely SDR)     + 300 (size)  = ~+1100
#   So the big stream wins by ~1700 points.

$ErrorActionPreference = 'Stop'
$f = 'app\details\[type]\[id].tsx'
if (-not (Test-Path -LiteralPath $f)) {
  $alt = 'app\details\id.tsx'
  if (Test-Path -LiteralPath $alt) { $f = $alt }
  else { Write-Host '[v320] ERROR: cannot find id.tsx'; exit 1 }
}

$s = Get-Content -Raw -LiteralPath $f
if ($s -match 'V320_SIZE_BONUS') {
  Write-Host '[v320] already patched, skipping'
  exit 0
}

# Anchor: the QUALITY_PTS line that adds quality points.  We inject the
# size bonus block IMMEDIATELY AFTER it.  ASCII-only anchor.
$bad = '    s += QUALITY_PTS[info.quality] || 0;'
$good = @'
    s += QUALITY_PTS[info.quality] || 0;
    /* V320_SIZE_BONUS - bigger files = better visual quality
       (higher bitrate REMUX/BluRay vs low-bitrate WEB-DL). */
    {
      const _v320size = (info.size || '').toString().toUpperCase();
      const _v320m = _v320size.match(/([\d.]+)\s*(GB|MB)/);
      if (_v320m) {
        const _v320n = parseFloat(_v320m[1]);
        const _v320GB = _v320m[2] === 'GB' ? _v320n : (_v320n / 1024);
        if (_v320GB > 20)      s += 1500;
        else if (_v320GB > 10) s += 800;
        else if (_v320GB > 5)  s += 300;
      }
    }
'@
if (-not $s.Contains($bad)) { Write-Host '[v320] ERROR: QUALITY_PTS anchor not found'; exit 2 }
$s = $s.Replace($bad, $good)

Set-Content -LiteralPath $f -Value $s -NoNewline -Encoding UTF8

Write-Host '[v320] id.tsx patched - V320_SIZE_BONUS marker now present'
Write-Host '[v320] After deploy_ota.bat + restart, auto-pick should land on the biggest 4K stream.'
Write-Host '[v320] Verify: adb logcat -d -t 200 ReactNativeJS:V *:S | findstr SORT'
