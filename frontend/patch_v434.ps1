# patch_v434.ps1 - Streams cache poisoning guard (min 3 entries)
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host "========================================="
Write-Host "  V434  Streams cache poisoning guard"
Write-Host "========================================="

$sPath = 'src\store\contentStore.ts'
$sAbs  = (Resolve-Path -LiteralPath $sPath).Path
$s     = [System.IO.File]::ReadAllText($sAbs)

if ($s.Contains('V434_MIN_CACHE_GUARD')) { Write-Host "[SKIP] already applied"; exit 0 }

# ============================================================
# 1) Read-guard: return null from loadStreamsFromDisk if list is too small.
# ============================================================
$oldRead = "    if (Date.now() - parsed.time > STREAMS_DISK_TTL_MS) return null;`n    return parsed.streams as Stream[];"
$newRead = @'
    if (Date.now() - parsed.time > STREAMS_DISK_TTL_MS) return null;
    /* V434_MIN_CACHE_GUARD - reject suspiciously-small cached snapshots
       (e.g. a single stream persisted from a bad fetch window). Force a
       fresh addon call by returning null. */
    const _v434Min = 3;
    if (!Array.isArray(parsed.streams) || parsed.streams.length < _v434Min) {
      try { console.log('[V434] discarding tiny stream cache n=', parsed.streams?.length, 'key=', key); } catch (_) {}
      return null;
    }
    return parsed.streams as Stream[];
'@
if (-not $s.Contains($oldRead)) { Write-Host "[FATAL] read anchor missing"; exit 1 }
$s = $s.Replace($oldRead, $newRead)
Write-Host "[OK] added read-side guard"

# ============================================================
# 2) Write-guard: don't persist tiny lists.
# ============================================================
$oldWrite = "    if (!streams || streams.length === 0) return;"
$newWrite = @'
    if (!streams || streams.length === 0) return;
    /* V434_MIN_CACHE_GUARD - never persist tiny snapshots. Prevents a bad
       fetch window (network glitch, addon timeout) from poisoning the disk
       cache with 1-2 streams that then lock users into that state until
       manual app-data clear. */
    if (streams.length < 3) {
      try { console.log('[V434] refusing to persist tiny stream list n=', streams.length, 'key=', key); } catch (_) {}
      return;
    }
'@
if (-not $s.Contains($oldWrite)) { Write-Host "[FATAL] write anchor missing"; exit 1 }
$s = $s.Replace($oldWrite, $newWrite)
Write-Host "[OK] added write-side guard"

# ============================================================
# 3) In-memory cache guard: don't set _streamsCache for tiny lists.
# ============================================================
$oldMemSet = "export const setStreamsCache = (key: string, data: Stream[]) => { _streamsCache[key] = data; };"
$newMemSet = @'
export const setStreamsCache = (key: string, data: Stream[]) => {
  /* V434_MIN_CACHE_GUARD - reject tiny lists in memory cache too. */
  if (!Array.isArray(data) || data.length < 3) {
    try { console.log('[V434] rejecting tiny in-memory cache set n=', data?.length, 'key=', key); } catch (_) {}
    return;
  }
  _streamsCache[key] = data;
};
'@
if (-not $s.Contains($oldMemSet)) {
  Write-Host "[WARN] mem-set anchor not found (skipping)"
} else {
  $s = $s.Replace($oldMemSet, $newMemSet)
  Write-Host "[OK] added memory-set guard"
}

# ============================================================
# 4) Read-guard for in-memory: getStreamsCache returns null if tiny.
# ============================================================
$oldMemGet = "export const getStreamsCache = (key: string) => _streamsCache[key] || null;"
$newMemGet = @'
export const getStreamsCache = (key: string) => {
  /* V434_MIN_CACHE_GUARD - discard tiny memory-cached entries so a fresh
     fetch is triggered. */
  const _cached = _streamsCache[key];
  if (!_cached || _cached.length < 3) {
    if (_cached && _cached.length < 3) {
      try { console.log('[V434] discarding tiny in-mem cache n=', _cached.length, 'key=', key); } catch (_) {}
      delete _streamsCache[key];
    }
    return null;
  }
  return _cached;
};
'@
if (-not $s.Contains($oldMemGet)) {
  Write-Host "[WARN] mem-get anchor not found (skipping)"
} else {
  $s = $s.Replace($oldMemGet, $newMemGet)
  Write-Host "[OK] added memory-get guard"
}

[System.IO.File]::WriteAllText($sAbs, $s)
Write-Host ""
Write-Host "[OK] v434 patched"
Write-Host "Now run: deploy_ota.bat"
