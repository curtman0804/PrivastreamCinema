# patch_v316d_drop_claim_guard.ps1
# V316d - Remove the once-only claim guard from V316c so every Continue-
# Watching poster mount refreshes the global __firstCWPosterTag and
# re-emits the v316c:firstCWTag DeviceEventEmitter event.  This handles
# the case where a prior Discover session left the global set to a now-
# unmounted (stale) native view tag, which made Android TV's nextFocusUp
# silently fall through to default spatial nav.
#
# Also bumps the log marker to '[V316d]' so we can confirm via logcat
# whether the OTA bundle actually shipped the new code.
#
# Touches only discover.tsx.

$ErrorActionPreference = 'Stop'
$f = 'app\(tabs)\discover.tsx'

if (-not (Test-Path -LiteralPath $f)) {
  Write-Host '[v316d] ERROR: cannot find app\(tabs)\discover.tsx'
  exit 1
}

$s = Get-Content -Raw -LiteralPath $f
if ($s -match 'V316d_DROP_GUARD') {
  Write-Host '[v316d] already patched, skipping'
  exit 0
}

$bad = @'
    let _v316cClaimed = false;
    if (pTag) {
      try {
        const g: any = globalThis as any;
        if (!g.__firstCWPosterTag) {
          g.__firstCWPosterTag = pTag;
          _v316cClaimed = true;
          console.log('[V316c] first CW poster tag=' + pTag + ' (claimed)');
          try { DeviceEventEmitter.emit('v316c:firstCWTag', pTag); } catch (_) {}
        }
      } catch (_) {}
    }
'@

$good = @'
    // V316d_DROP_GUARD - removed once-only claim guard so every CW mount
    // refreshes the global tag and re-emits the event.  Multiple CW items
    // mount near-simultaneously so the last one wins; cleanup below still
    // gates on tag-match so unmounts of inactive items don't blank a live
    // claim.
    let _v316cClaimed = false;
    if (pTag) {
      try {
        const g: any = globalThis as any;
        g.__firstCWPosterTag = pTag;
        _v316cClaimed = true;
        console.log('[V316d] CW poster claim tag=' + pTag);
        try { DeviceEventEmitter.emit('v316c:firstCWTag', pTag); } catch (_) {}
      } catch (_) {}
    }
'@

if (-not $s.Contains($bad)) {
  Write-Host '[v316d] ERROR: V316c claim block not found - was patch_v316c run first?'
  exit 2
}

$s2 = $s.Replace($bad, $good)
Set-Content -LiteralPath $f -Value $s2 -NoNewline -Encoding UTF8

Write-Host '[v316d] discover.tsx patched - V316d_DROP_GUARD marker now present'
Write-Host '[v316d] After deploy_ota.bat + app restart, you should see in logcat:'
Write-Host '[v316d]   [V316d] CW poster claim tag=NNNNN'
Write-Host '[v316d] within ~2 seconds of Discover loading.  If still nothing, the OTA bundle'
Write-Host '[v316d] is not picking up the change and you need to force a fresh APK install.'
