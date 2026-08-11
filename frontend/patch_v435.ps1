# patch_v435.ps1 - Focus memory for Discover tiles (restore on return from details)
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host "========================================="
Write-Host "  V435  Discover tile focus memory"
Write-Host "========================================="

$fPath = 'src\components\ContentCard.tsx'
$fAbs  = (Resolve-Path -LiteralPath $fPath).Path
$f     = [System.IO.File]::ReadAllText($fAbs)

if ($f.Contains('V435_FOCUS_MEMORY')) { Write-Host "[SKIP] already applied"; exit 0 }

# ============================================================
# 1) Add module-level focus-memory variable near the other module state.
# ============================================================
$modAnchor = "const _v160PosterRegistry: Record<string, string> = {};"
$modInject = @'
const _v160PosterRegistry: Record<string, string> = {};

/* V435_FOCUS_MEMORY - remember the last-focused tile id across mounts.
   When user backs out of details to Discover, the tiles remount and Android
   TV either loses focus entirely or picks a random default. We remember
   which tile last had focus and imperatively re-focus it on mount so
   D-pad navigation resumes exactly where the user left off. */
let _v435LastFocusedId: string | null = null;
export function v435GetLastFocused(): string | null { return _v435LastFocusedId; }
export function v435SetLastFocused(id: string | null): void { _v435LastFocusedId = id || null; }
'@
if (-not $f.Contains($modAnchor)) { Write-Host "[FATAL] module anchor missing"; exit 1 }
$f = $f.Replace($modAnchor, $modInject)
Write-Host "[OK] added _v435LastFocusedId module state"

# ============================================================
# 2) In the onFocus handler, save this card's id to the memory.
# ============================================================
$focusAnchor = "try { console.log('[V176M] focus reg id=' + String((item as any)?.imdb_id || (item as any)?.id || '?')); } catch (_) {}"
$focusInject = @'
try { console.log('[V176M] focus reg id=' + String((item as any)?.imdb_id || (item as any)?.id || '?')); } catch (_) {}
    /* V435_FOCUS_MEMORY - save id so next Discover mount can restore focus. */
    try {
      const _v435Id = String((item as any)?.imdb_id || (item as any)?.id || '');
      if (_v435Id) v435SetLastFocused(_v435Id);
    } catch (_) {}
'@
if (-not $f.Contains($focusAnchor)) { Write-Host "[FATAL] focus anchor missing"; exit 1 }
$f = $f.Replace($focusAnchor, $focusInject)
Write-Host "[OK] hooked focus memory into onFocus handler"

# ============================================================
# 3) Add mount-time restore effect right after pressableRef is declared.
# ============================================================
$mountAnchor = "const pressableRef = useRef<any>(null);"
$mountInject = @'
const pressableRef = useRef<any>(null);

  /* V435_FOCUS_MEMORY - on mount, if this tile matches the last-focused
     id, imperatively focus it. Delayed to next paint so layout is ready. */
  useEffect(() => {
    const _v435MyId = String((item as any)?.imdb_id || (item as any)?.id || '');
    if (!_v435MyId || _v435MyId !== _v435LastFocusedId) return;
    const _t = setTimeout(() => {
      try {
        const _r: any = pressableRef.current;
        if (_r) {
          if (typeof _r.focus === 'function') _r.focus();
          else if (typeof _r.requestTVFocus === 'function') _r.requestTVFocus();
          else if (typeof _r.setNativeProps === 'function') _r.setNativeProps({ hasTVPreferredFocus: true });
        }
      } catch (_) {}
    }, 120);
    return () => clearTimeout(_t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
'@
if (-not $f.Contains($mountAnchor)) { Write-Host "[FATAL] mount anchor missing"; exit 1 }
# Only replace FIRST occurrence
$idx = $f.IndexOf($mountAnchor)
$f = $f.Substring(0, $idx) + $mountInject + $f.Substring($idx + $mountAnchor.Length)
Write-Host "[OK] added mount-time focus restore effect"

[System.IO.File]::WriteAllText($fAbs, $f)
Write-Host ""
Write-Host "[OK] v435 patched"
Write-Host "Now run: deploy_ota.bat"
