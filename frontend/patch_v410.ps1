# ============================================================================
# patch_v410.ps1 - Tighter foreign-scene classifier (kills SDH false positives).
#
# Problem after v409: SDH English subs include LOTS of italicized content
# that's not foreign speech - sound effects `<i>(door slam)</i>`, music
# `<i>♪ song lyrics ♪</i>`, character labels `<i>KYLE:</i>`, off-screen
# markers `<i>MAN ON TV:</i>`. v409 tripped on all of them, showing wrong
# CC during English scenes.
#
# v410 fix: only fire on cues that look like TRANSLATED FOREIGN DIALOGUE:
#   * Cue is FULLY wrapped in italics (start-to-end, not partial)
#   * At least 3 words
#   * Not a parenthesized/bracketed sound effect
#   * No music note characters (♪ ♫)
#   * Doesn't match "NAME:" character-label pattern
# Plus all existing high-precision signals (non-Latin scripts, [in French]
# language brackets, name+language patterns).
#
# REQUIRES: v409. Idempotent.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V410  Precise foreign-scene classifier" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if (-not $p.Contains('V409_WIDER_FOREIGN')) {
  Write-Host "[FATAL] v409 not applied first" -ForegroundColor Red; exit 1
}
if ($p.Contains('V410_PRECISE_FOREIGN')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow; exit 0
}

$old = @'
  /* V409_WIDER_FOREIGN - italics is the dominant Blu-Ray convention for
     translated foreign dialogue. Also handle <font color> spans and
     character-name-with-language patterns. */
  const _v408IsForeignCue = (raw: any) => {
    try {
      const text = String(raw || '');
      if (!text) return false;
      // 1) Italics: <i>...</i> is the standard marker for translated
      //    foreign speech in modern .srt/.vtt releases.
      if (/<i\b[^>]*>[\s\S]*?<\/i>/i.test(text)) return true;
      if (/\{i\}[\s\S]*?\{\/i\}/i.test(text)) return true;
      // 2) Coloured font spans - some releases mark foreign speech with a
      //    specific colour so the human viewer knows it's translated.
      if (/<font[^>]+color[^>]*>[\s\S]*?<\/font>/i.test(text)) return true;
      const plain = text.replace(/<[^>]+>/g, '').replace(/\{\/?[a-z]+\}/gi, '').trim();
      if (!plain) return false;
      // 3) Non-Latin scripts: Cyrillic, CJK, Hebrew, Arabic, Devanagari/Tamil/Telugu
      if (/[\u0400-\u04FF]/.test(plain)) return true;
      if (/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(plain)) return true;
      if (/[\u0590-\u05FF]/.test(plain)) return true;
      if (/[\u0600-\u06FF]/.test(plain)) return true;
      if (/[\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F]/.test(plain)) return true;
      // 4) Descriptor tags:  [speaks Spanish], (in French), [FOREIGN LANGUAGE]
      if (/[\[\(](?:speaks|speaking|in|foreign)\s+[a-z]+[\]\)]/i.test(plain)) return true;
      const _langs = 'SPANISH|FRENCH|GERMAN|RUSSIAN|JAPANESE|ITALIAN|CHINESE|MANDARIN|CANTONESE|ARABIC|KOREAN|PORTUGUESE|DUTCH|POLISH|HINDI|TAMIL|TELUGU|SWEDISH|NORWEGIAN|DANISH|FINNISH|HEBREW|GREEK|TURKISH|VIETNAMESE|THAI|INDONESIAN|SWAHILI|LATIN|ALIEN|NATIVE|TRIBAL|KLINGON|ELVISH|DOTHRAKI|VALYRIAN|NAVI|SPEAKING\\s+FOREIGN|FOREIGN\\s+LANGUAGE';
      if (new RegExp('[\\[\\(](?:' + _langs + ')(?:\\b|[\\]\\)])', 'i').test(plain)) return true;
      // 5) Char-name lang lead-in:  "WENWU (in Chinese):", "LIU: [Mandarin]"
      if (new RegExp('[:.]\\s*[\\[\\(]\\s*(?:' + _langs + ')\\s*[\\]\\)]', 'i').test(plain)) return true;
      if (new RegExp('\\([^)]*\\bin\\s+(?:' + _langs + ')\\)', 'i').test(plain)) return true;
      return false;
    } catch (_) { return false; }
  };
'@
$new = @'
  /* V410_PRECISE_FOREIGN - tightened classifier. Only fires on cues that
     look like actual translated foreign DIALOGUE, not the endless
     SDH italic noise (sound effects, music, character labels).
     False-positive killers:
       * cue must be FULLY italic-wrapped (start to end)
       * >= 3 words of actual content
       * not a parenthesized sound effect
       * no music notes
       * doesn't look like "NAME:" character label
     Plus all high-precision signals (non-Latin scripts, [in X] tags). */
  const _v408IsForeignCue = (raw: any) => {
    try {
      const text = String(raw || '').trim();
      if (!text) return false;
      const plain = text.replace(/<[^>]+>/g, '').replace(/\{\/?[a-z]+\}/gi, '').trim();
      if (!plain) return false;

      // === HIGH-PRECISION SIGNALS (100% foreign, never false-positive) ===
      // A) Non-Latin scripts in the plain text
      if (/[\u0400-\u04FF]/.test(plain)) return true;
      if (/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(plain)) return true;
      if (/[\u0590-\u05FF]/.test(plain)) return true;
      if (/[\u0600-\u06FF]/.test(plain)) return true;
      if (/[\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F]/.test(plain)) return true;
      // B) Descriptor tags:  [speaks Spanish], (in French), [FOREIGN LANGUAGE]
      if (/[\[\(](?:speaks|speaking|in|foreign)\s+[a-z]+[\]\)]/i.test(plain)) return true;
      const _langs = 'SPANISH|FRENCH|GERMAN|RUSSIAN|JAPANESE|ITALIAN|CHINESE|MANDARIN|CANTONESE|ARABIC|KOREAN|PORTUGUESE|DUTCH|POLISH|HINDI|TAMIL|TELUGU|SWEDISH|NORWEGIAN|DANISH|FINNISH|HEBREW|GREEK|TURKISH|VIETNAMESE|THAI|INDONESIAN|SWAHILI|LATIN|ALIEN|NATIVE|TRIBAL|KLINGON|ELVISH|DOTHRAKI|VALYRIAN|NAVI|SPEAKING\\s+FOREIGN|FOREIGN\\s+LANGUAGE';
      if (new RegExp('[\\[\\(](?:' + _langs + ')(?:\\b|[\\]\\)])', 'i').test(plain)) return true;
      if (new RegExp('[:.]\\s*[\\[\\(]\\s*(?:' + _langs + ')\\s*[\\]\\)]', 'i').test(plain)) return true;
      if (new RegExp('\\([^)]*\\bin\\s+(?:' + _langs + ')\\)', 'i').test(plain)) return true;

      // === ITALICS SIGNAL (guarded by SDH-noise rejectors) ===
      // Cue must be FULLY wrapped in <i>...</i> (start and end).
      const _fullItalic = /^<i\b[^>]*>[\s\S]*?<\/i>\s*$/i.test(text)
                       || /^\{i\}[\s\S]*?\{\/i\}\s*$/i.test(text);
      if (!_fullItalic) return false;

      // Reject SDH sound effects:  (door slam), [phone ringing], etc.
      if (/^\s*[\(\[][\s\S]*[\)\]]\s*$/.test(plain)) return false;
      // Reject music cues
      if (/[\u266A\u266B\u266C\u2669]/.test(plain)) return false;
      if (/^\s*[#*]\s/.test(plain)) return false;
      // Reject character labels  "KYLE:", "MAN ON TV:", "-KYLE:"
      if (/^-?\s*[A-Z][A-Z\s'\-]{1,20}:\s*(?:$|\S{0,6}$)/.test(plain)) return false;
      // Reject onomatopoeia / short exclamations
      if (/^(?:whispers|whispering|gasps|sighs|groans|laughs|chuckles|screams|shouting|grunts|panting|breathing|footsteps|knocking|beeping|ringing)$/i.test(plain)) return false;
      // Need at least 3 words of real content to look like a dialogue line
      const _wc = plain.split(/\s+/).filter((w: string) => w.length > 0).length;
      if (_wc < 3) return false;
      return true;
    } catch (_) { return false; }
  };
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor missing (v409 detector body)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)

# Bump sentinel
$p = $p.Replace('V409_WIDER_FOREIGN', 'V410_PRECISE_FOREIGN')

[System.IO.File]::WriteAllText($pAbs, $p)

Write-Host "[OK] classifier tightened (SDH italics no longer trip it)" -ForegroundColor Green
Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V410 frontend applied. Then:" -ForegroundColor Cyan
Write-Host "    deploy_ota.bat" -ForegroundColor Cyan
Write-Host "" -ForegroundColor Cyan
Write-Host "  Requires backend V410 too - apply patch_backend_v410.py on" -ForegroundColor Cyan
Write-Host "  Hetzner and docker-restart before testing." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
