# patch_v427.ps1 - Auto-detect subtitle sync offset based on first-cue timestamp
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host "========================================="
Write-Host "  V427  Auto-sync subtitles"
Write-Host "========================================="

$pPath = 'app\player.tsx'
$pAbs  = (Resolve-Path -LiteralPath $pPath).Path
$p     = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V427_AUTOSYNC')) { Write-Host "[SKIP] already applied"; exit 0 }

# --- 1. Inject auto-sync logic right after cues are set ---
$old1 = @'
      console.log(`[SUBTITLES] Parsed ${cues.length} subtitle cues`);
      setSubtitleCues(cues);
    } catch (err) {
'@
$new1 = @'
      console.log(`[SUBTITLES] Parsed ${cues.length} subtitle cues`);
      setSubtitleCues(cues);

      /* V427_AUTOSYNC - Auto-detect sync offset from first-cue timestamp.
         Most TV episodes have their first spoken/title cue at ~25s (after
         the 20-30s opening theme). If the sub's first cue is far later
         than that, the sub is timed for a version with extra intro content
         (commentary/fireside/etc.) that the user's WEB stream lacks.
         Compute offset so first cue lands near the 25s mark. Clamp so we
         never shift by more than 2 minutes. */
      try {
        if (cues.length > 0) {
          const firstMs = cues[0].start;
          const TARGET_MS = 25000;      // aim first cue at ~25s of playback
          const IGNORE_UNDER = 20000;   // if first cue < 20s, no need to shift
          if (firstMs > IGNORE_UNDER) {
            let suggested = -(firstMs - TARGET_MS);
            // Clamp to sane range: never more than +/- 2 minutes
            suggested = Math.max(-120000, Math.min(0, suggested));
            if (suggested !== 0) {
              setSubtitleOffset(suggested);
              setAutoSyncNotice((suggested / 1000).toFixed(1));
              console.log(`[V427 AUTOSYNC] first_cue=${firstMs}ms  applied_offset=${suggested}ms`);
              // Auto-hide the notice after 4s
              setTimeout(() => setAutoSyncNotice(null), 4000);
            }
          } else {
            // Already close - clear any previous offset
            setSubtitleOffset(0);
          }
        }
      } catch (_v427err) {
        console.log('[V427 AUTOSYNC] error:', _v427err);
      }
    } catch (err) {
'@
if (-not $p.Contains($old1)) { Write-Host "[FATAL] anchor1 missing"; exit 1 }
$p = $p.Replace($old1, $new1)

# --- 2. Add autoSyncNotice state ---
$old2 = "const [subtitleOffset, setSubtitleOffset] = useState<number>(0); // Offset in ms (positive = subtitles appear later)"
$new2 = @'
const [subtitleOffset, setSubtitleOffset] = useState<number>(0); // Offset in ms (positive = subtitles appear later)
  /* V427_AUTOSYNC - short-lived notice to tell the user we auto-synced. */
  const [autoSyncNotice, setAutoSyncNotice] = useState<string | null>(null);
'@
if (-not $p.Contains($old2)) { Write-Host "[FATAL] anchor2 missing"; exit 1 }
$p = $p.Replace($old2, $new2)

# --- 3. Add the on-screen notice overlay (right before the OTA stamp block) ---
$old3 = '{/* V416_STAMP - visible boot pill so we can confirm the OTA'
$new3 = @'
{/* V427_AUTOSYNC - toast telling the user we auto-adjusted subs */}
            {autoSyncNotice && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: 80, alignSelf: 'center',
                  paddingHorizontal: 14, paddingVertical: 8,
                  backgroundColor: 'rgba(0,120,0,0.85)',
                  borderRadius: 8,
                  zIndex: 998,
                }}
              >
                <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>
                  Auto-synced subtitles {autoSyncNotice}s
                </Text>
              </View>
            )}

            {/* V416_STAMP - visible boot pill so we can confirm the OTA
'@
if (-not $p.Contains($old3)) { Write-Host "[FATAL] anchor3 missing"; exit 1 }
$p = $p.Replace($old3, $new3)

# Bump stamp
$p = $p.Replace("OTA v426", "OTA v427")

[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] v427 auto-sync patched"
Write-Host ""
Write-Host "Now run: deploy_ota.bat"
