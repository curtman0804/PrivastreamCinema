# patch_v325_webdl_over_webrip.ps1
# V325 - Refine V324 to specifically prefer the user's exact target class:
#   Project.Hail.Mary.2026.2160p.WEB-DL.DDP5.1.Atmos.H.265-RDNYB
#
# Distinguishing tags vs the watermarked 4K competitor:
#   - WEB-DL    (clean direct rip from streaming service)
#   - DDP5.1 Atmos (lossy multi-channel audio - widely playable)
#   - H.265 / HEVC (modern codec)
# vs the bad one:
#   - WEBRip    (screen-recorded torrent - frequently watermarked)
#   - usually generic audio tag
#
# Changes (all ADDITIVE on top of V324):
#   1. +4000 EXTRA for any stream containing "WEB-DL" (not WEBRip)
#      in title or name.  Sums with V324's +6000 -> +10000 for the
#      target stream.
#   2. -3000 for any stream containing "WEBRIP" (treats it as a
#      cam-rip cousin since most WEBRips on Torrentio are screen
#      captures with burned ads).
#   3. +1500 for the WEB-DL + ATMOS + HEVC combo (RDNYB-style).
#
# Result for PHM:
#   RDNYB-style (4K WEB-DL Atmos H.265, 23.82 GB):
#     V321 (0) + V320 (1500) + V324 (6000) + V325 (4000+1500) = +13000
#   Watermarked 4K WEBRip (15-20 GB):
#     V321 (0) + V320 (1500) + V324 (6000) + V325 (-3000) = +4500
#   Clean 1080p WEB-DL x264 (18.18 GB):
#     V321 (0) + V320 (1500) + V325 (4000) = +5500
#
# RDNYB wins by 7500+.  Watermarked WEBRip ranks below clean 1080p.

$ErrorActionPreference = 'Stop'
$f = 'app\details\[type]\[id].tsx'
if (-not (Test-Path -LiteralPath $f)) {
  $alt = 'app\details\id.tsx'
  if (Test-Path -LiteralPath $alt) { $f = $alt }
  else { Write-Host '[v325] ERROR: cannot find id.tsx'; exit 1 }
}

$s = Get-Content -Raw -LiteralPath $f
if ($s -match 'V325_WEBDL_OVER_WEBRIP') {
  Write-Host '[v325] already patched, skipping'
  exit 0
}

# Anchor: extend right after V324's bonus block.  Use the V324 MID-4K
# log line as the unique end-of-block marker.
$bad = @'
        } else if (_v324GB >= 8) {
          s += 2000;
          try {
            console.log('[V324] MID-4K bonus +2000 size=' + _v324GB + 'GB | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
          } catch (_) {}
        }
      }
    }
'@
$good = @'
        } else if (_v324GB >= 8) {
          s += 2000;
          try {
            console.log('[V324] MID-4K bonus +2000 size=' + _v324GB + 'GB | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
          } catch (_) {}
        }
      }
      /* V325_WEBDL_OVER_WEBRIP - prefer clean WEB-DL rips over
         screen-captured WEBRip torrents (which often carry burned-in
         1xbet/affiliate overlays even when filename looks clean). */
      {
        const _v325upper = _v323blob.toUpperCase();
        const _v325isWebDl = /\bWEB-?DL\b/.test(_v325upper);
        const _v325isWebRip = /\bWEBRIP\b|\bWEB-?RIP\b/.test(_v325upper) && !_v325isWebDl;
        const _v325hasAtmos = /\bATMOS\b/.test(_v325upper);
        const _v325hasHevc = /\bH\.?265\b|\bHEVC\b|\bX265\b/.test(_v325upper);
        if (_v325isWebDl && !_v323isForeign) {
          s += 4000;
          if (_v325hasAtmos && _v325hasHevc) {
            s += 1500;
            try {
              console.log('[V325] WEB-DL+Atmos+HEVC combo +5500 | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
            } catch (_) {}
          } else {
            try {
              console.log('[V325] WEB-DL bonus +4000 | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
            } catch (_) {}
          }
        }
        if (_v325isWebRip) {
          s -= 3000;
          try {
            console.log('[V325] WEBRip penalty -3000 (often burned ad overlay) | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
          } catch (_) {}
        }
      }
    }
'@

if (-not $s.Contains($bad)) {
  Write-Host '[v325] ERROR: V324 MID-4K anchor not found - is V324 still applied?'
  exit 2
}
$s = $s.Replace($bad, $good)
Set-Content -LiteralPath $f -Value $s -NoNewline -Encoding UTF8

Write-Host '[v325] id.tsx patched - V325_WEBDL_OVER_WEBRIP marker present'
Write-Host '[v325] WEB-DL streams now get +4000 bonus (+5500 with Atmos+HEVC combo).'
Write-Host '[v325] WEBRip streams get -3000 penalty - removes burned-overlay risk.'
Write-Host '[v325] PHM target (2160p.WEB-DL.DDP5.1.Atmos.H.265-RDNYB) wins by ~7500 over WEBRip competitors.'
Write-Host '[v325] Run deploy_ota.bat, force-stop app, reopen, retry PHM.'
