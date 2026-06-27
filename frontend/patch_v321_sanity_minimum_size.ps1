# patch_v321_sanity_minimum_size.ps1
# V321 - Quality-vs-size sanity check.
#
# Root cause confirmed via logcat:
#   [v241 PLAY] picked: 'Torrentio 4k DV | HDR10+'
#   MediaCodecLogger: dolby-vision.bitrateInKbps = 973
# A 973 kbps "4K DV" stream is YouTube-240p quality with a fancy HDR
# metadata wrapper.  Real 4K UHD = 25-60 Mbps; the picked file is
# clearly a transcoded fake with junk tags.  V320's size bonus puts
# real big streams ahead WHEN BOTH ARE IN THE POOL, but if the only
# Premiumize-cached option is a fake low-bitrate transcode, the +5000
# cached bonus drowns out V320's +1500 from a real uncached 23GB rip.
#
# Fix: penalize streams whose declared quality is implausible for their
# file size.  Modern encodes have minimum size floors:
#   4K  : >= 10 GB  for ANY HDR/HEVC encode worth watching
#   1080p: >= 2 GB
#   720p : >= 800 MB
# Anything claiming 4K but under 10 GB is almost guaranteed a transcoded
# fake.  Apply heavy negative penalties so cached fakes lose to real
# uncached rips even with the +5000 PM cache bonus.
#
# Tiers (subtracted from score):
#   4K   <  6 GB:  -8000   (definitely fake / sub-DVD quality)
#   4K   < 10 GB:  -4000   (probably transcoded, looks pale)
#   1080p < 1.5GB: -3000   (definitely fake / heavily compressed)
#   1080p < 2.5GB: -1000   (probably transcoded)
#   720p  < 0.5GB: -1500   (definitely fake)
#
# This sits ON TOP of V320's size bonus, so genuinely large files win
# big and fake-tag low-size files are pushed below uncached real ones.

$ErrorActionPreference = 'Stop'
$f = 'app\details\[type]\[id].tsx'
if (-not (Test-Path -LiteralPath $f)) {
  $alt = 'app\details\id.tsx'
  if (Test-Path -LiteralPath $alt) { $f = $alt }
  else { Write-Host '[v321] ERROR: cannot find id.tsx'; exit 1 }
}

$s = Get-Content -Raw -LiteralPath $f
if ($s -match 'V321_SANITY_MIN_SIZE') {
  Write-Host '[v321] already patched, skipping'
  exit 0
}

# Anchor at the END of the V320 size-bonus block (its closing braces are
# distinctive enough).  We extend the block with a sanity-floor check.
$bad = @'
        if (_v320GB > 20)      s += 1500;
        else if (_v320GB > 10) s += 800;
        else if (_v320GB > 5)  s += 300;
      }
    }
'@
$good = @'
        if (_v320GB > 20)      s += 1500;
        else if (_v320GB > 10) s += 800;
        else if (_v320GB > 5)  s += 300;
        // V321_SANITY_MIN_SIZE - minimum-size floors per quality tier.
        // Anything claiming 4K under 10GB is almost guaranteed a fake/
        // transcoded torrent.  Heavily penalize so they lose to real
        // uncached high-bitrate rips even with the PM cache bonus.
        if (info.quality === '4K') {
          if (_v320GB > 0 && _v320GB < 6)        s -= 8000;
          else if (_v320GB > 0 && _v320GB < 10)  s -= 4000;
        } else if (info.quality === '1080p') {
          if (_v320GB > 0 && _v320GB < 1.5)      s -= 3000;
          else if (_v320GB > 0 && _v320GB < 2.5) s -= 1000;
        } else if (info.quality === '720p') {
          if (_v320GB > 0 && _v320GB < 0.5)      s -= 1500;
        }
      }
    }
'@

if (-not $s.Contains($bad)) {
  Write-Host '[v321] ERROR: V320 size-bonus block anchor not found - is V320 applied first?'
  exit 2
}
$s = $s.Replace($bad, $good)

Set-Content -LiteralPath $f -Value $s -NoNewline -Encoding UTF8

Write-Host '[v321] id.tsx patched - V321_SANITY_MIN_SIZE marker now present'
Write-Host '[v321] Effect: anything tagged 4K under 10GB now LOSES to real uncached rips'
Write-Host '[v321] (cache bonus +5000 minus V321 -4000 = +1000, beaten by a real 23GB 4K +3000).'
Write-Host '[v321] Run deploy_ota.bat + restart.  PHM should auto-pick a real high-bitrate stream'
Write-Host '[v321] (might add 3-5s before play if uncached - PM resolves on demand).'
