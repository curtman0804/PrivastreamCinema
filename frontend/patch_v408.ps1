# ============================================================================
# patch_v408.ps1 - Auto CC only during foreign-language scenes.
#
# WHY: v407 auto-selects the release-matched sub AND auto-shows every cue.
# User wants the sub silent by default, only lit up when characters are
# speaking a foreign language (Cyrillic / CJK / bracketed language tags).
# No manual toggling required for the normal English case.
#
# BEHAVIOR:
#   * Auto-matched sub is still loaded silently in the background (v407).
#   * A new state _v408AutoActive gates the overlay renderer:
#       - AutoActive=true (default): only cues whose text is non-Latin or
#         explicitly tagged foreign are displayed.
#       - AutoActive=false (user has picked something in the CC modal):
#         renders every cue like normal CC.
#   * Any interaction with the picker (Off, English, another sub) flips
#     AutoActive to false forever for this player session, giving the
#     user full manual control.
#
# REQUIRES: v407. Idempotent.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V408  Auto CC for foreign scenes only" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if (-not $p.Contains('V407_SUB_AUTOMATCH')) {
  Write-Host "[FATAL] v407 not applied first" -ForegroundColor Red; exit 1
}
if ($p.Contains('V408_FOREIGN_ONLY')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow; exit 0
}

# --- 1: add AutoActive state + foreign-cue detector next to v407 ref ---
$old = @'
  const _v407AutoMatchRef = useRef<{ url: string; reason: string } | null>(null);
'@
$new = @'
  const _v407AutoMatchRef = useRef<{ url: string; reason: string } | null>(null);
  /* V408_FOREIGN_ONLY - true until user explicitly picks anything from
     the CC modal. While true, the auto-matched sub is loaded silently
     but only cues that look foreign (non-Latin script or bracketed
     language tag) are rendered. */
  const [_v408AutoActive, setV408AutoActive] = useState<boolean>(true);
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
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 1 missing (v407 ref)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 1: AutoActive state + foreign-cue detector added" -ForegroundColor Green

# --- 2: gate the setCurrentSubtitleText call inside the position effect ---
$old = @'
      setCurrentSubtitleText(currentCue?.text || '');
    } else {
      setCurrentSubtitleText('');
    }
  }, [position, subtitleCues, subtitleOffset]);
'@
$new = @'
      /* V408_FOREIGN_ONLY - while user hasn't picked anything, only cues
         classified as foreign render. Once they interact with the CC
         picker, full CC applies (autoActive becomes false). */
      const _v408Raw = currentCue?.text || '';
      if (_v408AutoActive && _v408Raw && !_v408IsForeignCue(_v408Raw)) {
        setCurrentSubtitleText('');
      } else {
        setCurrentSubtitleText(_v408Raw);
      }
    } else {
      setCurrentSubtitleText('');
    }
  }, [position, subtitleCues, subtitleOffset, _v408AutoActive]);
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 2 missing (position effect tail)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 2: cue rendering gated by foreign-scene classifier" -ForegroundColor Green

# --- 3: picker onPress -> user takeover, kill AutoActive ---
$old = @'
                      setSelectedSubtitle(item.lang === 'off' ? null : item.url);
                      setShowSubtitlePicker(false);
'@
$new = @'
                      setSelectedSubtitle(item.lang === 'off' ? null : item.url);
                      setV408AutoActive(false); /* V408 - user is now in control */
                      setShowSubtitlePicker(false);
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 3 missing (picker onPress)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 3: picker interaction flips AutoActive -> false" -ForegroundColor Green

# --- 4: add a subtle mode hint in the picker header ---
$old = @'
              <Text style={styles.subtitleModalTitle}>Subtitles</Text>
'@
$new = @'
              <View>
                <Text style={styles.subtitleModalTitle}>Subtitles</Text>
                {_v408AutoActive && (
                  <Text style={{ color: '#B8A05C', fontSize: 11, marginTop: 2, letterSpacing: 0.3 }}>
                    Auto: CC on for foreign-language scenes only
                  </Text>
                )}
              </View>
'@
if ($p.Contains($old)) {
  $p = $p.Replace($old, $new)
  Write-Host "[OK] 4: header hint added" -ForegroundColor Green
} else {
  Write-Host "[WARN] 4: header anchor not found - non-fatal" -ForegroundColor DarkYellow
}

[System.IO.File]::WriteAllText($pAbs, $p)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V408 applied. Then:" -ForegroundColor Cyan
Write-Host "    deploy_ota.bat" -ForegroundColor Cyan
Write-Host "" -ForegroundColor Cyan
Write-Host "  Default playback: no visible subs during English dialog." -ForegroundColor Cyan
Write-Host "  When a character speaks a foreign language, subs appear" -ForegroundColor Cyan
Write-Host "  automatically. Any manual pick in the CC modal switches" -ForegroundColor Cyan
Write-Host "  the session to full manual CC control." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
