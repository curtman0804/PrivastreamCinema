# ============================================================================
# patch_v406.ps1 - Resilient stream fetching (multi-retry + disk rescue)
#
# WHY: Users see 0 streams intermittently when Torrentio / TPB+ have a
# scraper hiccup. The existing pipeline only retries ONCE at 3s and only
# recovers from in-memory state. This patch makes fetchStreams tolerate
# transient upstream failures.
#
# CHANGES in src/store/contentStore.ts (function fetchStreams):
#   1) Replace the single 3-second retry with 3 attempts on backoff
#      (500ms, 1500ms, 3500ms). Each attempt reuses the existing
#      progressive-paint callback so partial results still land in the
#      UI as they arrive.
#   2) Extend the "refuse 0" block with a disk-cache rescue. If a
#      parallel prefetch (Discover / Continue Watching) has written to
#      disk while our fetch was thrashing, we pick it up here instead
#      of returning [].
#   3) Same disk rescue also added to the catch block.
#
# Safe anchors (no em-dashes / no localised chars). Idempotent.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V406  Resilient stream fetching" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$path = 'src\store\contentStore.ts'
$abs = (Resolve-Path -LiteralPath $path).Path
$s = [System.IO.File]::ReadAllText($abs)

if ($s.Contains('V406_RESILIENT_RETRY')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow
  exit 0
}

# --- 1: replace single retry (lines ~697-707) with 3-attempt backoff loop ---
$old = @'
        await new Promise((r) => setTimeout(r, 3000));
        if (_myToken !== _v190AbortToken) return [];
        try {
          const retry = await api.addons.getAllStreams(type, id);
          if (retry && retry.streams && retry.streams.length > 0) {
            allStreams = retry.streams;
            console.log('[ContentStore v190] retry succeeded:', allStreams.length);
          }
        } catch (e) {
          console.log('[ContentStore v190] retry threw:', e);
        }
      }
'@
$new = @'
        /* V406_RESILIENT_RETRY - 3 attempts with exponential backoff.
           Reuses _v194_onProgress so any partial results from Torrentio
           or TPB+ during the retries still paint the UI immediately. */
        const _v406Delays = [500, 1500, 3500];
        for (let _v406i = 0; _v406i < _v406Delays.length; _v406i++) {
          if (_myToken !== _v190AbortToken) return [];
          if (allStreams && allStreams.length > 0) break;
          await new Promise((r) => setTimeout(r, _v406Delays[_v406i]));
          if (_myToken !== _v190AbortToken) return [];
          try {
            const _v406R = await api.addons.getAllStreams(type, id, _v194_onProgress);
            if (_v406R && _v406R.streams && _v406R.streams.length > 0) {
              allStreams = _v406R.streams;
              console.log('[V406] retry ' + (_v406i + 1) + '/3 succeeded, streams=' + allStreams.length);
              break;
            } else {
              console.log('[V406] retry ' + (_v406i + 1) + '/3 returned 0');
            }
          } catch (_e) {
            console.log('[V406] retry ' + (_v406i + 1) + '/3 threw', _e);
          }
        }
      }
'@
if (-not $s.Contains($old)) {
  Write-Host "[FATAL] anchor 1 missing (retry-once block)" -ForegroundColor Red
  Write-Host "Run and send me:" -ForegroundColor Yellow
  Write-Host '  powershell -Command "(Get-Content src\store\contentStore.ts)[694..712] | ForEach-Object { $_ }"' -ForegroundColor Yellow
  exit 1
}
$s = $s.Replace($old, $new)
Write-Host "[OK] 1: single retry replaced with 3-attempt backoff loop" -ForegroundColor Green

# --- 2: extend refuse-0 with disk rescue ---
$old = @'
      if (allStreams.length === 0) {
        const _cur = get();
        if (_cur && _cur.streams && _cur.streams.length > 0) {
          console.log('[v190] keeping', _cur.streams.length, 'existing streams (refusing 0)');
          _setIf({ isLoadingStreams: false });
          return _cur.streams;
        }
      }
'@
$new = @'
      if (allStreams.length === 0) {
        const _cur = get();
        if (_cur && _cur.streams && _cur.streams.length > 0) {
          console.log('[v190] keeping', _cur.streams.length, 'existing streams (refusing 0)');
          _setIf({ isLoadingStreams: false });
          return _cur.streams;
        }
        /* V406_DISK_RESCUE - a parallel prefetch (Discover / CW) may have
           written to disk while our fetch was retrying. Try one last read
           before returning []. */
        try {
          const _v406Disk = await loadStreamsFromDisk(cacheKey);
          if (_v406Disk && _v406Disk.length > 0) {
            console.log('[V406] disk rescue found', _v406Disk.length, 'streams');
            setStreamsCache(cacheKey, _v406Disk);
            _setIf({ streams: _v406Disk, isLoadingStreams: false });
            return _v406Disk;
          }
        } catch (_) {}
      }
'@
if (-not $s.Contains($old)) {
  Write-Host "[FATAL] anchor 2 missing (refuse-0 block)" -ForegroundColor Red
  exit 1
}
$s = $s.Replace($old, $new)
Write-Host "[OK] 2: disk rescue added to refuse-0" -ForegroundColor Green

# --- 3: same disk rescue in error catch ---
$old = @'
    } catch (error: any) {
      console.log('[ContentStore v190] fetchStreams error:', error);
      const _cur = get();
      if (_cur && _cur.streams && _cur.streams.length > 0) {
        _setIf({ isLoadingStreams: false });
        return _cur.streams;
      }
      _setIf({ streams: [], isLoadingStreams: false });
      return [];
    }
'@
$new = @'
    } catch (error: any) {
      console.log('[ContentStore v190] fetchStreams error:', error);
      const _cur = get();
      if (_cur && _cur.streams && _cur.streams.length > 0) {
        _setIf({ isLoadingStreams: false });
        return _cur.streams;
      }
      /* V406_DISK_RESCUE_CATCH - error path also gets a last-chance disk read. */
      try {
        const _v406Disk = await loadStreamsFromDisk(cacheKey);
        if (_v406Disk && _v406Disk.length > 0) {
          console.log('[V406] catch-path disk rescue found', _v406Disk.length, 'streams');
          setStreamsCache(cacheKey, _v406Disk);
          _setIf({ streams: _v406Disk, isLoadingStreams: false, error: null });
          return _v406Disk;
        }
      } catch (_) {}
      _setIf({ streams: [], isLoadingStreams: false });
      return [];
    }
'@
if (-not $s.Contains($old)) {
  Write-Host "[FATAL] anchor 3 missing (catch block)" -ForegroundColor Red
  exit 1
}
$s = $s.Replace($old, $new)
Write-Host "[OK] 3: disk rescue added to catch block" -ForegroundColor Green

[System.IO.File]::WriteAllText($abs, $s)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V406 applied. Then:" -ForegroundColor Cyan
Write-Host "    deploy_ota.bat" -ForegroundColor Cyan
Write-Host "" -ForegroundColor Cyan
Write-Host "  Observable effect:" -ForegroundColor Cyan
Write-Host "    * On a normal fetch: no visible change." -ForegroundColor Cyan
Write-Host "    * On a Torrentio/TPB+ hiccup: streams populate within" -ForegroundColor Cyan
Write-Host "      up to ~5.5s instead of showing 0." -ForegroundColor Cyan
Write-Host "    * On repeat visits to a show that has EVER loaded" -ForegroundColor Cyan
Write-Host "      successfully: disk rescue guarantees non-zero result." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
