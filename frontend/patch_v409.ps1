# ============================================================================
# patch_v409.ps1 - Wider foreign-scene classifier (italics + name-lang tags).
#
# v408 detector caught non-Latin scripts and explicit "[Spanish]"-style
# language brackets but MISSED the most common Blu-Ray convention:
# translated foreign dialogue wrapped in <i>...</i> italics (Shang-Chi's
# opening Mandarin narration, Inglourious Basterds French scenes, most
# Marvel/Bond bilingual films, etc.).
#
# Also adds:
#   * <font color=...> spans (some releases colour foreign lines)
#   * Character-name-plus-language pattern:  "Wenwu: [Mandarin] ..." or
#     "WENWU (in Chinese): ..."
#   * Bracket-only language token at head of cue:  "[MANDARIN]"
#
# REQUIRES: v408. Idempotent.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V409  Wider foreign-scene classifier" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if (-not $p.Contains('V408_FOREIGN_ONLY')) {
  Write-Host "[FATAL] v408 not applied first" -ForegroundColor Red; exit 1
}
if ($p.Contains('V409_WIDER_FOREIGN')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow; exit 0
}

# --- swap the whole _v408IsForeignCue body with a wider version ---
$old = @'
  const _v408IsForeignCue = (raw: any) => {
    try {
      const text = String(raw || '');
      if (!text) return false;
      const plain = text.replace(/<[^>]+>/g, '').trim();
      if (!plain) return false;
      // Non-Latin scripts (Cyrillic, CJK, Hebrew, Arabic, Devanagari/Tamil/Telugu)
      if (/[\u0400-\u04FF]/.test(plain)) return true;
      if (/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(plain)) return true;
      if (/[\u0590-\u05FF]/.test(plain)) return true;
      if (/[\u0600-\u06FF]/.test(plain)) return true;
      if (/[\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F]/.test(plain)) return true;
      // Explicit descriptor tags: [speaks Spanish], (in French), [FOREIGN LANGUAGE]
      if (/[\[\(](?:speaks|speaking|in|foreign)\s+[a-z]+[\]\)]/i.test(plain)) return true;
      const _langs = 'SPANISH|FRENCH|GERMAN|RUSSIAN|JAPANESE|ITALIAN|CHINESE|MANDARIN|CANTONESE|ARABIC|KOREAN|PORTUGUESE|DUTCH|POLISH|HINDI|TAMIL|TELUGU|SWEDISH|NORWEGIAN|DANISH|FINNISH|HEBREW|GREEK|TURKISH|VIETNAMESE|THAI|INDONESIAN|SWAHILI|LATIN|ALIEN|FOREIGN\\s+LANGUAGE|NATIVE|TRIBAL|KLINGON|ELVISH|DOTHRAKI|VALYRIAN|NAVI|SPEAKING\\s+FOREIGN';
      if (new RegExp('[\\[\\(](?:' + _langs + ')(?:\\b|[\\]\\)])', 'i').test(plain)) return true;
      return false;
    } catch (_) { return false; }
  };
'@
$new = @'
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
if (-not $p.Contains($old)) {
  Write-Host "[FATAL] anchor missing (v408 detector body)" -ForegroundColor Red
  Write-Host "Run and send me:" -ForegroundColor Yellow
  Write-Host '  findstr /N /C:"V408_FOREIGN_ONLY" app\player.tsx' -ForegroundColor Yellow
  exit 1
}
$p = $p.Replace($old, $new)
[System.IO.File]::WriteAllText($pAbs, $p)

Write-Host "[OK] classifier widened (italics + font color + name-lang tags)" -ForegroundColor Green
Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V409 applied. Then:" -ForegroundColor Cyan
Write-Host "    deploy_ota.bat" -ForegroundColor Cyan
Write-Host "" -ForegroundColor Cyan
Write-Host "  Shang-Chi opening (Mandarin narration wrapped in <i>) will" -ForegroundColor Cyan
Write-Host "  now light up captions. South Park stays silent (no italics," -ForegroundColor Cyan
Write-Host "  no non-Latin script, no language tags in the cues)." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
