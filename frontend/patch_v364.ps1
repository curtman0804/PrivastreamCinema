# patch_v364.ps1 - V364 Stremio-style standby handling for player.tsx
# ---------------------------------------------------------------------------
# PROBLEM: Premiumize stream URLs are short-lived signed links. Turning the
# device off (standby) mid-playback keeps the paused ExoPlayer session alive.
# On wake it plays the already-buffered data, then dies when ExoPlayer
# refetches from the now-expired URL. "Clearing cache" only worked because it
# forced a fresh link resolve.
#
# FIX (what Stremio does): never let a stream session survive standby.
#   - AppState -> 'background' (device off / HOME press):
#       1) flush exact position to watch-progress
#       2) tear the player screen down (unmount also fires the exit-save)
#   - On return the user re-enters via Details / Continue Watching, which
#     ALWAYS re-resolves a fresh link (V147_NO_STALE_URL) and seeks back.
#
# Implementation: TWO literal string replacements in app\player.tsx
#   A) add AppState to the react-native import list
#   B) insert the V364_STANDBY_EXIT effect before "// Format time helper"
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V364  Standby exit (Stremio-style)" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$plPath = 'app\player.tsx'
$plAbs  = (Resolve-Path -LiteralPath $plPath).Path
$txt    = [System.IO.File]::ReadAllText($plAbs)
$orig   = $txt
$nl     = if ($txt.Contains("`r`n")) { "`r`n" } else { "`n" }

if ($txt.Contains('V364_STANDBY_EXIT')) {
  Write-Host "  [NOOP] V364_STANDBY_EXIT already applied" -ForegroundColor DarkGray
} else {

  # --------------------------------------------------------------------------
  # A) Import: add AppState to the main react-native import block
  # --------------------------------------------------------------------------
  $impOldCRLF = "  BackHandler,`r`n  PanResponder,`r`n} from 'react-native';"
  $impNewCRLF = "  BackHandler,`r`n  PanResponder,`r`n  AppState,`r`n} from 'react-native';"
  $impOldLF   = "  BackHandler,`n  PanResponder,`n} from 'react-native';"
  $impNewLF   = "  BackHandler,`n  PanResponder,`n  AppState,`n} from 'react-native';"

  if ($txt.Contains($impOldCRLF)) {
    $txt = $txt.Replace($impOldCRLF, $impNewCRLF)
    Write-Host "  [OK]   A) AppState import added (CRLF)" -ForegroundColor Green
  } elseif ($txt.Contains($impOldLF)) {
    $txt = $txt.Replace($impOldLF, $impNewLF)
    Write-Host "  [OK]   A) AppState import added (LF)" -ForegroundColor Green
  } else {
    Write-Host "  [FAIL] A) react-native import anchor NOT FOUND - aborting (no write)" -ForegroundColor Red
    exit 1
  }

  # --------------------------------------------------------------------------
  # B) Insert V364_STANDBY_EXIT effect before "// Format time helper"
  # --------------------------------------------------------------------------
  $anchor = '  // Format time helper'
  if (-not $txt.Contains($anchor)) {
    Write-Host "  [FAIL] B) 'Format time helper' anchor NOT FOUND - aborting (no write)" -ForegroundColor Red
    exit 1
  }

  $fx = @(
    '  /* V364_STANDBY_EXIT - Stremio-style standby handling.  Premiumize URLs',
    '     are short-lived signed links.  If the device sleeps mid-playback the',
    '     paused session survives, plays the buffered part on wake, then dies',
    '     when ExoPlayer refetches from the expired URL.  Stremio never lets a',
    '     stream session survive standby: it keeps the timestamp, kills the',
    '     session, and re-resolves on reopen.  Same here: on background we',
    '     flush progress and tear the player down; Details/CW re-resolves a',
    '     fresh link and seeks back (V147_NO_STALE_URL flow). */',
    '  const _v364ExitedRef = useRef(false);',
    '  useEffect(() => {',
    '    if (Platform.OS === ''web'') return;',
    '    const _v364OnAppState = (next: string) => {',
    '      if (next !== ''background'') return;',
    '      if (isCasting) return; /* cast keeps playing on the remote device */',
    '      if (_v364ExitedRef.current) return;',
    '      _v364ExitedRef.current = true;',
    '      console.log(''[V364_STANDBY_EXIT] app backgrounded - saving progress + closing player'');',
    '      try { if (videoRef.current) { videoRef.current.pauseAsync(); } } catch (_) {}',
    '      try {',
    '        if (currentPositionRef.current > 0 && currentDurationRef.current > 0) {',
    '          saveWatchProgress(currentPositionRef.current, currentDurationRef.current, true);',
    '        }',
    '      } catch (_) {}',
    '      try {',
    '        let target: string | null = null;',
    '        if (seriesId && season && episode) {',
    '          target = `/details/series/${seriesId}:${season}:${episode}`;',
    '        } else if (contentId) {',
    '          const cid = String(contentId);',
    '          const base = cid.includes('':'') ? cid.split('':'')[0] : cid;',
    '          target = `/details/${(contentType as string) || ''movie''}/${base}`;',
    '        }',
    '        if (router.canGoBack && router.canGoBack()) {',
    '          router.back();',
    '        } else if (target) {',
    '          router.replace(target as any);',
    '        }',
    '      } catch (_) {',
    '        try { router.back(); } catch (__) {}',
    '      }',
    '    };',
    '    const _v364Sub = AppState.addEventListener(''change'', _v364OnAppState);',
    '    return () => { try { _v364Sub.remove(); } catch (_) {} };',
    '  }, [isCasting, seriesId, season, episode, contentId, contentType, saveWatchProgress]);',
    '',
    ''
  ) -join $nl

  $txt = $txt.Replace($anchor, ($fx + $anchor))
  Write-Host "  [OK]   B) V364_STANDBY_EXIT effect inserted" -ForegroundColor Green

  [System.IO.File]::WriteAllText($plAbs, $txt)
  Write-Host "  [WRITE] $plPath saved" -ForegroundColor Cyan
}

# ============================================================================
# Verification
# ============================================================================
Write-Host ""
Write-Host "----- Verification -----" -ForegroundColor Cyan
Write-Host ("  V364_STANDBY_EXIT hits (should be >=1) : " + (Select-String -LiteralPath $plPath -Pattern 'V364_STANDBY_EXIT' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  AppState import hits (should be 1)     : " + (Select-String -LiteralPath $plPath -Pattern '^\s*AppState,\s*$').Count) -ForegroundColor Green

# ============================================================================
# DEPLOY : full output + auto SyntaxError diagnostics
# ============================================================================
Write-Host ""
Write-Host "----- Deploy (full output below) -----" -ForegroundColor Cyan
$deployOut = & cmd /c "deploy_ota.bat 2>&1" | Out-String
Write-Host $deployOut

if ($deployOut -match 'DONE' -and $deployOut -match '"updateId":"([^"]+)"') {
  Write-Host ("  [OK]   Deploy done, updateId=" + $Matches[1]) -ForegroundColor Green
  cmd /c "adb shell am force-stop com.privastream.cinema 2>&1" | Out-Null
  Write-Host "  [OK]   TV app force-stopped (reopen it to pull the update)" -ForegroundColor Green
  Write-Host ""
  Write-Host "TEST PLAN:" -ForegroundColor Yellow
  Write-Host "  1) Play a movie for ~2 min, then turn the device OFF" -ForegroundColor Yellow
  Write-Host "  2) Wait 5+ minutes (let the PM link expire)" -ForegroundColor Yellow
  Write-Host "  3) Turn device ON -> you should land on the DETAILS page, NOT the frozen player" -ForegroundColor Yellow
  Write-Host "  4) Press Play / Continue Watching -> fresh stream, resumes at your spot" -ForegroundColor Yellow
  Write-Host "  5) It should keep playing well past the old buffer point" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Log check:" -ForegroundColor Yellow
  Write-Host '  adb logcat -d ReactNativeJS:V *:S | findstr /I "V364 V363 progress"' -ForegroundColor Gray
  exit 0
}

Write-Host "  [FAIL] Deploy did not complete cleanly - diagnosing..." -ForegroundColor Red
if ($deployOut -match 'SyntaxError[^\r\n]*?([A-Za-z]:\\[^:]+?\.(?:tsx|ts|jsx|js)):[^\(]*\((\d+):(\d+)\)') {
  $badFile = $Matches[1]
  $badLine = [int]$Matches[2]
  Write-Host ""
  Write-Host ("  Bundler SyntaxError in: " + $badFile) -ForegroundColor Red
  Write-Host ("  At line: " + $badLine) -ForegroundColor Red
  if (Test-Path -LiteralPath $badFile) {
    Write-Host "  ----- Code context -----" -ForegroundColor Yellow
    $ctx = Get-Content -LiteralPath $badFile
    $s = [Math]::Max(0, $badLine - 9); $e = [Math]::Min($ctx.Length - 1, $badLine + 7)
    for ($k = $s; $k -le $e; $k++) {
      $mark = if (($k + 1) -eq $badLine) { ' >>' } else { '   ' }
      Write-Host ("  " + ($k + 1).ToString().PadLeft(5) + $mark + ' ' + $ctx[$k])
    }
  }
  Write-Host ""
  Write-Host "  PASTE ALL OUTPUT ABOVE BACK TO THE AGENT for a surgical fix." -ForegroundColor Red
} else {
  Write-Host ""
  Write-Host "  No SyntaxError - failure is in a later step (upload/update-server)." -ForegroundColor Yellow
  Write-Host "  PASTE THE FULL DEPLOY OUTPUT ABOVE BACK TO THE AGENT." -ForegroundColor Yellow
}
