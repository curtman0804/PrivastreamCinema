# patch_v363b.ps1 - Fix the broken discover.tsx from patch_v363.ps1
# ---------------------------------------------------------------------------
# WHAT WENT WRONG in v363:
#   The inject used PowerShell `$inject.Replace('$1','$$1')` for the .NET regex
#   replacement pattern, which produced a LITERAL "$1" inside the file right
#   after `=> {`. Depending on where Babel unwinds, it manifested as an
#   unbalanced brace error on the closing `}, []);` of handleSectionFocus.
#
# WHAT v363b DOES:
#   1) Roll back the broken V363_SECTION_FOCUS_DEBOUNCE inject on discover.tsx
#      by regex-stripping the injected block AND restoring the original
#      single `}, []);` close.
#   2) Re-apply the debounce wrapper using System.String.Replace() (which
#      does NOT interpret $1) so the file compiles cleanly.
#   3) Leaves fixes B (SNAP_ABORT), C (BROAD_UNMOUNT), D (curplay write),
#      E (curplay read) alone -- those applied cleanly last run.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V363b  Fix broken discover.tsx" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$discPath = 'app\(tabs)\discover.tsx'
$discAbs = (Resolve-Path -LiteralPath $discPath).Path
$disc = [System.IO.File]::ReadAllText($discAbs)
$discOrig = $disc

# ---------------------------------------------------------------------------
# STEP 1: Roll back the broken V363 inject
# ---------------------------------------------------------------------------
# The broken text starts with either literal `$1` right after `=> {` OR the
# comment marker. We match from the useCallback open through the last line
# of my inject: `if (key !== sectionKey) return;  /* newer focus took over */`
# and replace it with the ORIGINAL open (just `=> {` + newline).

if ($disc.Contains('V363_SECTION_FOCUS_DEBOUNCE')) {
  Write-Host "  [STEP1] Rolling back broken V363 open inject..." -ForegroundColor Yellow

  # Anchor: from `useCallback((sectionKey: string) => {` up to and including
  # `if (key !== sectionKey) return;  /* newer focus took over */\n`
  # (?s) = single-line so `.` matches newlines.
  $reBroken = '(?s)(const\s+handleSectionFocus\s*=\s*useCallback\(\(sectionKey:\s*string\)\s*=>\s*\{).*?if\s*\(key\s*!==\s*sectionKey\)\s*return;\s*/\*\s*newer\s+focus\s+took\s+over\s*\*/[^\n]*\n'
  if ($disc -match $reBroken) {
    # Replacement rebuilds the original opening EXACTLY (no captures needed).
    $originalOpen = "const handleSectionFocus = useCallback((sectionKey: string) => {`n"
    $disc = [regex]::Replace($disc, $reBroken, $originalOpen, 1)
    Write-Host "    [OK] Broken open block stripped" -ForegroundColor Green
  } else {
    Write-Host "    [FAIL] Broken open anchor NOT FOUND - aborting rollback" -ForegroundColor Red
    exit 1
  }

  # Now strip the stray `});` we added just before `}, []);`.
  # Match: `lastFocusedSection.current = sectionKey;\n  });\n  }, []);`
  # Rewrite as:  `lastFocusedSection.current = sectionKey;\n  }, []);`
  $reStrayClose = '(?s)(lastFocusedSection\.current\s*=\s*sectionKey;\s*)\}\s*\)\s*;\s*(\}\s*,\s*\[\]\s*\)\s*;)'
  if ($disc -match $reStrayClose) {
    $disc = [regex]::Replace($disc, $reStrayClose, '$1$2', 1)
    Write-Host "    [OK] Stray rAF close removed" -ForegroundColor Green
  } else {
    Write-Host "    [WARN] Stray rAF close anchor NOT FOUND (maybe already clean)" -ForegroundColor Yellow
  }
} else {
  Write-Host "  [SKIP] No V363_SECTION_FOCUS_DEBOUNCE marker - file already clean" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# STEP 2: Re-apply the debounce cleanly using System.String.Replace
# ---------------------------------------------------------------------------
# NOTE: use STRING replace so `$1` inside our injected text is safe.
if (-not $disc.Contains('V363B_SECTION_FOCUS_DEBOUNCE')) {
  Write-Host "  [STEP2] Applying clean V363b debounce..." -ForegroundColor Cyan

  $openLiteral = 'const handleSectionFocus = useCallback((sectionKey: string) => {'

  # Multiline replacement text. Uses ONLY LF newlines via "`n".
  $inject = @"
const handleSectionFocus = useCallback((sectionKey: string) => {
    /* V363B_SECTION_FOCUS_DEBOUNCE - coalesce rapid D-pad focus hops into
       a single scrollTo per animation frame. Prevents "focus cascade"
       where arrowing past 3-4 rails fired 3-4 scrollTos back-to-back. */
    (globalThis as any).__v363_pendingSection = sectionKey;
    if ((globalThis as any).__v363_pendingRAF) {
      cancelAnimationFrame((globalThis as any).__v363_pendingRAF);
    }
    (globalThis as any).__v363_pendingRAF = requestAnimationFrame(() => {
      (globalThis as any).__v363_pendingRAF = null;
      const key = (globalThis as any).__v363_pendingSection;
      if (!key || key !== sectionKey) { return; }
"@

  if ($disc.Contains($openLiteral)) {
    $disc = $disc.Replace($openLiteral, $inject)
    Write-Host "    [OK] Debounce head injected" -ForegroundColor Green
  } else {
    Write-Host "    [FAIL] Original openLiteral not found - probably ROLLBACK MISFIRED" -ForegroundColor Red
    exit 1
  }

  # Now close the extra rAF `{` we just opened. Insert `});` right BEFORE
  # the existing `}, []);` that closes the outer arrow + useCallback.
  # We do a literal String.Replace to avoid regex `$1` traps.
  #
  # Anchor uses ONLY the last body line + close, which is unique enough:
  $closeAnchor = "    lastFocusedSection.current = sectionKey;`r`n  }, []);"
  $closeReplace = "    lastFocusedSection.current = sectionKey;`r`n    });`r`n  }, []);"

  if ($disc.Contains($closeAnchor)) {
    $disc = $disc.Replace($closeAnchor, $closeReplace)
    Write-Host "    [OK] rAF close injected (CRLF variant)" -ForegroundColor Green
  } else {
    # Try LF-only variant in case the file uses LF line endings
    $closeAnchorLF = "    lastFocusedSection.current = sectionKey;`n  }, []);"
    $closeReplaceLF = "    lastFocusedSection.current = sectionKey;`n    });`n  }, []);"
    if ($disc.Contains($closeAnchorLF)) {
      $disc = $disc.Replace($closeAnchorLF, $closeReplaceLF)
      Write-Host "    [OK] rAF close injected (LF variant)" -ForegroundColor Green
    } else {
      Write-Host "    [FAIL] close anchor NOT FOUND - manual patch needed" -ForegroundColor Red
      # Do NOT save a broken file - abort.
      Write-Host "    [ABORT] leaving file untouched" -ForegroundColor Red
      exit 1
    }
  }
} else {
  Write-Host "  [NOOP] V363B_SECTION_FOCUS_DEBOUNCE already applied" -ForegroundColor DarkGray
}

if ($disc -ne $discOrig) {
  [System.IO.File]::WriteAllText($discAbs, $disc)
  Write-Host "  [WRITE] $discPath saved" -ForegroundColor Cyan
} else {
  Write-Host "  [NOOP] discover.tsx already up to date" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "----- Verification -----" -ForegroundColor Cyan
Write-Host ("  V363B_SECTION_FOCUS_DEBOUNCE hits : " + (Select-String -LiteralPath $discPath -Pattern 'V363B_SECTION_FOCUS_DEBOUNCE' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  Old V363_SECTION_FOCUS_DEBOUNCE   : " + (Select-String -LiteralPath $discPath -Pattern 'V363_SECTION_FOCUS_DEBOUNCE' -SimpleMatch).Count + " (should be 0)") -ForegroundColor Green
Write-Host ("  Literal `$1 leftover check         : " + (Select-String -LiteralPath $discPath -Pattern '=> \{\$1' -SimpleMatch).Count + " (should be 0)") -ForegroundColor Green
Write-Host ("  V363_SNAP_ABORT (from v363)       : " + (Select-String -LiteralPath $discPath -Pattern 'V363_SNAP_ABORT' -SimpleMatch).Count + " (kept)") -ForegroundColor Green

# ---------------------------------------------------------------------------
# Deploy + reload
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "----- Deploy + reload -----" -ForegroundColor Cyan
$deployOut = & cmd /c "deploy_ota.bat 2>&1" | Out-String
if ($deployOut -match 'DONE' -and $deployOut -match '"updateId":"([^"]+)"') {
  Write-Host ("  [OK]   Deploy done, updateId=" + $Matches[1]) -ForegroundColor Green
} else {
  Write-Host "  [FAIL] Deploy did not complete cleanly" -ForegroundColor Red
  Write-Host $deployOut
}
& adb shell am force-stop com.privastream.cinema 2>&1 | Out-Null
Write-Host "  [OK]   Firestick app force-stopped" -ForegroundColor Green

Write-Host ""
Write-Host "Reopen the app. If bundling still fails, upload the current" -ForegroundColor Yellow
Write-Host "discover.tsx via:" -ForegroundColor Yellow
Write-Host '  curl.exe -X POST --data-binary "@app\(tabs)\discover.tsx" -H "X-Filename: discover.tsx" https://git-update-staging.preview.emergentagent.com/api/upload_raw' -ForegroundColor Gray
