# ============================================================================
# patch_v386.ps1 - back-to-series-root fix + CW poster consistency (OTA)
#
# [A] BACK BUG: Continue Watching pushes the EPISODE page directly from
#     Discover (v238b), so the series root is NOT underneath in the nav
#     stack. Back from the episode page did a plain router.back() and
#     landed on Discover. Fix: inspect the nav state - if the previous
#     route is this series' root, back() as before; otherwise REPLACE the
#     episode page with the series root (episode pre-focused), so back
#     ALWAYS lands on episode selection.
#
# [B] CW POSTERS: rails register the canonical poster only when a rail
#     card actually renders that content. If nothing has claimed it yet,
#     the CW card now registers ITS poster as the canon (first-write-wins,
#     no-op when a rail already registered), so CW and rails always agree.
#
# Idempotent: safe to re-run.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V386 Back Fix + CW Poster Consistency" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# [A] details [id].tsx - smart back
# ---------------------------------------------------------------------------
$dPath = Get-ChildItem -Path 'app' -Recurse -File | Where-Object { $_.Name -eq '[id].tsx' } | Select-Object -First 1
if (-not $dPath) { Write-Host "[FATAL] [id].tsx not found" -ForegroundColor Red; exit 1 }
$d = [System.IO.File]::ReadAllText($dPath.FullName)

if ($d.Contains('V386_BACK_TO_SERIES_ROOT')) {
  Write-Host "[SKIP] [id].tsx already patched" -ForegroundColor Yellow
} else {
$old = @'
    console.log('[BACK-UI v124w] fired idStr=' + idStr + ' season=' + s + ' episode=' + e);
    try {
      router.back();
      // After back lands us on RMroot, push focus params so the selector
      // highlights the just-watched episode.
      setTimeout(() => {
        try { router.setParams({ selectedSeason: s, selectedEpisode: e } as any); }
        catch (err) { console.log('[BACK-UI v124w] setParams error', err); }
      }, 80);
      return true;
    } catch (err) {
      console.log('[BACK-UI v124w] router.back error', err);
      return false;
    }
'@
$new = @'
    console.log('[BACK-UI v124w] fired idStr=' + idStr + ' season=' + s + ' episode=' + e);
    /* V386_BACK_TO_SERIES_ROOT - Continue Watching (and other deep links)
       push the EPISODE page directly from Discover, so the series root is
       NOT underneath us in the stack and a plain router.back() lands on
       Discover. Inspect the nav state: if the previous route IS this
       series' root, back() as before; otherwise REPLACE this episode page
       with the series root so back always lands on episode selection. */
    const _v386Base = parts[0] || idStr;
    let _v386PrevIsRoot = false;
    try {
      const _st: any = (navigation as any).getState ? (navigation as any).getState() : null;
      const _routes: any[] = (_st && _st.routes) ? _st.routes : [];
      const _idx = (typeof _st?.index === 'number') ? _st.index : (_routes.length - 1);
      const _prev = _idx > 0 ? _routes[_idx - 1] : null;
      const _prevId = (_prev && _prev.params) ? decodeURIComponent(String((_prev.params as any).id || '')) : '';
      _v386PrevIsRoot = !!_prev && _prevId === _v386Base;
      console.log('[V386_BACK] prevId=' + _prevId + ' base=' + _v386Base + ' prevIsRoot=' + _v386PrevIsRoot);
    } catch (_e386) { console.log('[V386_BACK] state inspect failed'); }
    try {
      if (_v386PrevIsRoot) {
        router.back();
        // After back lands us on RMroot, push focus params so the selector
        // highlights the just-watched episode.
        setTimeout(() => {
          try { router.setParams({ selectedSeason: s, selectedEpisode: e } as any); }
          catch (err) { console.log('[BACK-UI v124w] setParams error', err); }
        }, 80);
      } else {
        console.log('[V386_BACK] no series root beneath - replacing with root');
        router.replace({
          pathname: `/details/series/${encodeURIComponent(_v386Base)}`,
          params: { selectedSeason: s, selectedEpisode: e },
        } as any);
      }
      return true;
    } catch (err) {
      console.log('[BACK-UI v124w] router.back error', err);
      return false;
    }
'@
if (-not $d.Contains($old)) { Write-Host "[FATAL] A anchor missing" -ForegroundColor Red; exit 1 }
$d = $d.Replace($old, $new)
[System.IO.File]::WriteAllText($dPath.FullName, $d)
Write-Host "[OK] A: smart back written to [id].tsx" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# [B] discover.tsx - CW registers its poster as fallback canon
# ---------------------------------------------------------------------------
$sPath = 'app\(tabs)\discover.tsx'
if (!(Test-Path -LiteralPath $sPath)) { Write-Host "[FATAL] discover.tsx not found" -ForegroundColor Red; exit 1 }
$sAbs = (Resolve-Path -LiteralPath $sPath).Path
$s = [System.IO.File]::ReadAllText($sAbs)

if ($s.Contains('V386_CW_REGISTERS_POSTER')) {
  Write-Host "[SKIP] discover.tsx already patched" -ForegroundColor Yellow
} else {
$old = @'
  v160SubscribePoster as _v160SubscribePoster /* V166_POSTER_SUB */,
'@
$new = @'
  v160SubscribePoster as _v160SubscribePoster /* V166_POSTER_SUB */,
  v160RegisterPoster as _v160RegisterPoster /* V386_CW_REGISTERS_POSTER */,
'@
if (-not $s.Contains($old)) { Write-Host "[FATAL] B1 anchor missing" -ForegroundColor Red; exit 1 }
$s = $s.Replace($old, $new)
Write-Host "[OK] B1: import added" -ForegroundColor Green

$old = @'
  useEffect(() => {
    const unsub = _v160SubscribePoster((item as any).content_id, (u: string) => _v166SetPoster(u));
    return unsub;
  }, [(item as any).content_id]);
'@
$new = @'
  useEffect(() => {
    const unsub = _v160SubscribePoster((item as any).content_id, (u: string) => _v166SetPoster(u));
    return unsub;
  }, [(item as any).content_id]);

  /* V386_CW_REGISTERS_POSTER - if nothing has claimed this content's
     canonical poster yet (fresh registry / rails never mounted), the CW
     card's own poster becomes the canon so rails adopt it when they mount.
     First-write-wins: no-op when a rail already registered. Persisted by
     V383, so rails + CW agree from cold boot onward. */
  useEffect(() => {
    const _p = (item as any).poster;
    if (_p) { try { _v160RegisterPoster((item as any).content_id, _p); } catch (_) {} }
  }, []);
'@
if (-not $s.Contains($old)) { Write-Host "[FATAL] B2 anchor missing" -ForegroundColor Red; exit 1 }
$s = $s.Replace($old, $new)
[System.IO.File]::WriteAllText($sAbs, $s)
Write-Host "[OK] B2: CW poster registration written" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. Run deploy_ota.bat, relaunch twice." -ForegroundColor Cyan
Write-Host ""
