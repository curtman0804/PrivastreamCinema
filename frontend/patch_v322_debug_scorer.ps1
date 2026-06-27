# patch_v322_debug_scorer.ps1
# V322 - DIAGNOSTIC ONLY. Adds a console.log inside the V320 size-bonus
# block so we can see, for each stream:
#   - the parsed quality string ('4K' / '1080p' / ...)
#   - the raw size string from the title
#   - the parsed GB value
#   - the V320 size bonus applied
#   - the V321 sanity penalty applied
#
# Captures the top 5 highest-scoring streams' diagnostics so we can
# decide whether V321 is actually firing on the picked stream and what
# size/quality the stream pool actually contains.
#
# No scoring behavior change.  Pure logging.

$ErrorActionPreference = 'Stop'
$f = 'app\details\[type]\[id].tsx'
if (-not (Test-Path -LiteralPath $f)) {
  $alt = 'app\details\id.tsx'
  if (Test-Path -LiteralPath $alt) { $f = $alt }
  else { Write-Host '[v322] ERROR: cannot find id.tsx'; exit 1 }
}

$s = Get-Content -Raw -LiteralPath $f
if ($s -match 'V322_DEBUG_SCORER') {
  Write-Host '[v322] already patched, skipping'
  exit 0
}

# Anchor at the end of the V321 size-penalty cascade.  Add logging
# AFTER all the score adjustments so we capture the final size/penalty.
$bad = @'
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
$good = @'
        if (info.quality === '4K') {
          if (_v320GB > 0 && _v320GB < 6)        s -= 8000;
          else if (_v320GB > 0 && _v320GB < 10)  s -= 4000;
        } else if (info.quality === '1080p') {
          if (_v320GB > 0 && _v320GB < 1.5)      s -= 3000;
          else if (_v320GB > 0 && _v320GB < 2.5) s -= 1000;
        } else if (info.quality === '720p') {
          if (_v320GB > 0 && _v320GB < 0.5)      s -= 1500;
        }
        // V322_DEBUG_SCORER - log size/quality/score every stream parsed.
        try {
          const _v322name = ((stream as any)?.title || (stream as any)?.name || '').slice(0, 60).replace(/\n/g, ' ');
          console.log('[V322] q=' + info.quality + ' size="' + (info.size || '') + '" GB=' + (_v320m ? _v320GB.toFixed(2) : 'NONE') + ' cached=' + (!!stream.url) + ' score=' + s + ' | ' + _v322name);
        } catch (_) {}
      } else {
        // Also log streams with NO size info so we know if Torrentio is
        // omitting size data entirely (which would defeat V320/V321).
        try {
          const _v322name = ((stream as any)?.title || (stream as any)?.name || '').slice(0, 60).replace(/\n/g, ' ');
          console.log('[V322 NO-SIZE] q=' + info.quality + ' cached=' + (!!stream.url) + ' score=' + s + ' | ' + _v322name);
        } catch (_) {}
      }
    }
'@

if (-not $s.Contains($bad)) {
  Write-Host '[v322] ERROR: V321 cascade anchor not found - was V321 applied first?'
  exit 2
}
$s = $s.Replace($bad, $good)

Set-Content -LiteralPath $f -Value $s -NoNewline -Encoding UTF8

Write-Host '[v322] id.tsx patched - V322_DEBUG_SCORER added'
Write-Host '[v322] After deploy_ota.bat + restart, every stream evaluated will log a [V322] line.'
Write-Host '[v322] Capture for PHM with:'
Write-Host '[v322]   adb logcat -c'
Write-Host '[v322]   <open PHM details page on Firestick>'
Write-Host '[v322]   adb logcat -d -t 1000 ReactNativeJS:V *:S | findstr V322 > C:\Users\Curtm\v322.log'
Write-Host '[v322] Then upload the log so we can see why V321 is not pushing the auto-pick.'
