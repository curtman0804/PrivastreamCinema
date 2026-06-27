# patch_v323_strict_english.ps1
# V323 - Strict English-only language detection + heavy foreign penalty.
#
# Root cause confirmed via V322 diagnostic:
#   18.39 GB stream "Projet.Derniere.Chance.2026.VOSTFR.1080p..." (FRENCH)
#   12.24 GB stream "Проект «Конец света» ... WEB-DL 1080p"     (RUSSIAN)
#   12.10 GB stream "Project.Hail.Mary.2026.MULTi.1080p..."     (MULTi/foreign)
# All were classified as English by the parser and won auto-pick on
# size+seeders.  User reports playback is audio-only / black-screen on
# these because the Russian/French audio mismatches their expectation
# and the codec stack chokes on some foreign-language audio tracks.
#
# Fix:
#   1. Detect VOSTFR, VOSTA, VFF, VF, FRENCH, ITA, iTA, MULTi, PL,
#      ESP, ESPAÑOL, RUSSIAN, RUS, KOR, JPN, GER, DUAL, and ANY
#      Cyrillic chars in title -> language = 'FOREIGN'
#   2. Bump foreign penalty so English wins even at lower size/seeders:
#      sort priority adds +1000 for ENG; we now subtract -5000 for
#      detected foreign.  Net delta = 6000 - dwarfs the +1500 max size
#      bonus and +240 max seeder bonus.
#
# Target: app\details\[type]\[id].tsx only.

$ErrorActionPreference = 'Stop'
$f = 'app\details\[type]\[id].tsx'
if (-not (Test-Path -LiteralPath $f)) {
  $alt = 'app\details\id.tsx'
  if (Test-Path -LiteralPath $alt) { $f = $alt }
  else { Write-Host '[v323] ERROR: cannot find id.tsx'; exit 1 }
}

$s = Get-Content -Raw -LiteralPath $f
if ($s -match 'V323_STRICT_ENGLISH') {
  Write-Host '[v323] already patched, skipping'
  exit 0
}

# Inject right after V322 logging block (end of the size scoring section).
# Anchor on V322's NO-SIZE log so we extend at the bottom of the block.
$bad = @'
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
$good = @'
      } else {
        try {
          const _v322name = ((stream as any)?.title || (stream as any)?.name || '').slice(0, 60).replace(/\n/g, ' ');
          console.log('[V322 NO-SIZE] q=' + info.quality + ' cached=' + (!!stream.url) + ' score=' + s + ' | ' + _v322name);
        } catch (_) {}
      }
    }
    /* V323_STRICT_ENGLISH - aggressive foreign-language detection.
       parseStreamInfo missed VOSTFR / Cyrillic / MULTi, so apply a
       heavy penalty here in computeScore where we have the raw text. */
    {
      const _v323blob = ((stream as any)?.title || '') + ' ' + ((stream as any)?.name || '') + ' ' + ((stream as any)?.filename || '');
      const _v323upper = _v323blob.toUpperCase();
      // Cyrillic char range U+0400..U+04FF
      const _v323HasCyrillic = /[\u0400-\u04FF]/.test(_v323blob);
      // CJK ranges (Korean Hangul, Japanese Hiragana/Katakana, Chinese)
      const _v323HasCJK = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(_v323blob);
      const _v323foreignTags = (
        /\bVOSTFR\b|\bVOSTA\b|\bVFF\b|\bVFQ\b|\bVO\b|\bVF\b/.test(_v323upper) ||
        /\bFRENCH\b|\bFRA\b|\bFR-?[\d]+\b/.test(_v323upper) ||
        /\bITALIAN\b|\bITA\b|\bIT\b\.|\.IT\.|\bITA-/.test(_v323upper) ||
        /\bGERMAN\b|\bGER\b|\bDEU\b|\bDEUTSCH\b/.test(_v323upper) ||
        /\bSPANISH\b|\bESP\b|\bESPANOL\b|\bLATIN\b|\bLATINO\b|\bCASTELLANO\b/.test(_v323upper) ||
        /\bRUSSIAN\b|\bRUS\b|\bUKR\b|\bUKRAINIAN\b/.test(_v323upper) ||
        /\bKOREAN\b|\bKOR\b|\bJAPANESE\b|\bJPN\b|\bJAP\b/.test(_v323upper) ||
        /\bPOLISH\b|\bPL\b\.|\.PL\.|\bPL-/.test(_v323upper) ||
        /\bTURKISH\b|\bTUR\b|\bTRK\b/.test(_v323upper) ||
        /\bHINDI\b|\bHIN\b|\bTAMIL\b|\bTAM\b|\bTELUGU\b|\bTEL\b/.test(_v323upper) ||
        /\bPORTUGUESE\b|\bPOR\b|\bPT-BR\b|\bBRAZILIAN\b/.test(_v323upper) ||
        /\bDUTCH\b|\bNLD\b|\bNED\b/.test(_v323upper) ||
        /\bMULTI\b|\bMULTI-AUDIO\b|\bDUAL\b|\bDUAL-AUDIO\b|\bMULTI-LANG\b/.test(_v323upper)
      );
      const _v323isForeign = _v323HasCyrillic || _v323HasCJK || _v323foreignTags;
      if (_v323isForeign) {
        s -= 5000;
        try {
          console.log('[V323] FOREIGN penalty -5000 (cyrillic=' + _v323HasCyrillic + ' cjk=' + _v323HasCJK + ' tags=' + _v323foreignTags + ') | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
        } catch (_) {}
      }
    }
'@
if (-not $s.Contains($bad)) { Write-Host '[v323] ERROR: V322 NO-SIZE anchor not found'; exit 2 }
$s = $s.Replace($bad, $good)

Set-Content -LiteralPath $f -Value $s -NoNewline -Encoding UTF8

Write-Host '[v323] id.tsx patched - V323_STRICT_ENGLISH marker present'
Write-Host '[v323] Foreign-detected streams (VOSTFR/Cyrillic/MULTi/etc) now penalized -5000'
Write-Host '[v323] Expected new auto-pick for PHM: the 18.18 GB English WEB-DL x264 (62 seeders)'
Write-Host '[v323] Run deploy_ota.bat, force-stop the app, reopen, retry PHM playback.'
