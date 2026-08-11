# patch_v436.ps1 - Wire tab bar's nextFocusUp to last-focused tile
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host "========================================="
Write-Host "  V436  Tab bar nextFocusUp -> last tile"
Write-Host "========================================="

# ============================================================
# Part A: Extend v435 in ContentCard to track native TAG too.
# ============================================================
$fPath = 'src\components\ContentCard.tsx'
$fAbs  = (Resolve-Path -LiteralPath $fPath).Path
$f     = [System.IO.File]::ReadAllText($fAbs)

if (-not $f.Contains('V436_TAG_MEMORY')) {
  # 1. Add tag state + subscribers to the existing v435 block.
  $oldMod = 'let _v435LastFocusedId: string | null = null;
export function v435GetLastFocused(): string | null { return _v435LastFocusedId; }
export function v435SetLastFocused(id: string | null): void { _v435LastFocusedId = id || null; }'
  $newMod = @'
let _v435LastFocusedId: string | null = null;
export function v435GetLastFocused(): string | null { return _v435LastFocusedId; }
export function v435SetLastFocused(id: string | null): void { _v435LastFocusedId = id || null; }

/* V436_TAG_MEMORY - also track the native view tag of the last-focused
   tile so the tab bar can wire nextFocusUp directly to it (bypassing
   Android TV's spatial finder which lands on the wrong row with FlashList). */
let _v436LastFocusedTag: number = 0;
const _v436Listeners: Array<() => void> = [];
export function v436GetLastFocusedTag(): number { return _v436LastFocusedTag; }
export function v436SetLastFocusedTag(tag: number): void {
  if (tag === _v436LastFocusedTag) return;
  _v436LastFocusedTag = tag || 0;
  _v436Listeners.slice().forEach((fn) => { try { fn(); } catch (_) {} });
}
export function v436Subscribe(fn: () => void): () => void {
  _v436Listeners.push(fn);
  return () => {
    const i = _v436Listeners.indexOf(fn);
    if (i >= 0) _v436Listeners.splice(i, 1);
  };
}
'@
  if (-not $f.Contains($oldMod)) { Write-Host "[FATAL] v435 anchor missing"; exit 1 }
  $f = $f.Replace($oldMod, $newMod)
  Write-Host "[OK] added v436 tag memory + subscribers"

  # 2. In onFocus handler, also capture and store the native tag.
  $oldFocus = "try {
      const _v435Id = String((item as any)?.imdb_id || (item as any)?.id || '');
      if (_v435Id) v435SetLastFocused(_v435Id);
    } catch (_) {}"
  $newFocus = @'
try {
      const _v435Id = String((item as any)?.imdb_id || (item as any)?.id || '');
      if (_v435Id) v435SetLastFocused(_v435Id);
    } catch (_) {}
    /* V436_TAG_MEMORY - save native tag of this tile for tab bar's nextFocusUp. */
    try {
      const _r: any = pressableRef.current;
      if (_r) {
        // Try findNodeHandle first, then fall back to _nativeTag / __nativeTag.
        let _tag = 0;
        try { const _t = require('react-native').findNodeHandle(_r); if (_t && _t > 0) _tag = _t; } catch (_) {}
        if (!_tag && _r._nativeTag && _r._nativeTag > 0) _tag = _r._nativeTag;
        if (!_tag && _r.__nativeTag && _r.__nativeTag > 0) _tag = _r.__nativeTag;
        if (_tag) v436SetLastFocusedTag(_tag);
      }
    } catch (_) {}
'@
  if (-not $f.Contains($oldFocus)) { Write-Host "[FATAL] onFocus anchor missing"; exit 1 }
  $f = $f.Replace($oldFocus, $newFocus)
  Write-Host "[OK] tag capture wired into onFocus"

  [System.IO.File]::WriteAllText($fAbs, $f)
} else {
  Write-Host "[SKIP] v436 already in ContentCard"
}

# ============================================================
# Part B: In tabs layout, read v436 tag and set nextFocusUp.
# ============================================================
$lPath = 'app\(tabs)\_layout.tsx'
$lAbs  = (Resolve-Path -LiteralPath $lPath).Path
$l     = [System.IO.File]::ReadAllText($lAbs)

if ($l.Contains('V436_TAB_NEXTFOCUSUP')) {
    Write-Host "[SKIP] tab layout already patched"
} else {
    # 1. Add import for v436 helpers.
    $impAnchor = "import { useSafeAreaInsets } from 'react-native-safe-area-context';"
    $impInject = @'
import { useSafeAreaInsets } from 'react-native-safe-area-context';
/* V436_TAB_NEXTFOCUSUP - tab bar reads last-focused tile's native tag
   from ContentCard and sets it as nextFocusUp so D-pad UP from the tab
   bar lands on the exact tile the user was last on. */
import { v436GetLastFocusedTag, v436Subscribe } from '../../src/components/ContentCard';
'@
    if ($l.Contains($impAnchor)) {
      $l = $l.Replace($impAnchor, $impInject)
      Write-Host "[OK] added v436 imports"
    }

    # 2. Wire nextFocusUp override into the trap block.
    $oldUp = "// UP is intentionally NOT set — Android TV's positional search"
    $newUp = @'
// V436_TAB_NEXTFOCUSUP - UP now points to last-focused tile's tag.
          // Falls back to unset (Android spatial search) if no tile has been
          // focused yet this session.
          const _v436Tag = v436GetLastFocusedTag();
          if (_v436Tag && _v436Tag > 0) {
            trap.nextFocusUp = _v436Tag;
          }
          // UP is intentionally NOT set — Android TV's positional search
'@
    if ($l.Contains($oldUp)) {
      $l = $l.Replace($oldUp, $newUp)
      Write-Host "[OK] wired trap.nextFocusUp to last-focused tag"
    } else { Write-Host "[FATAL] UP anchor missing"; exit 1 }

    # 3. Subscribe to v436 changes to re-render tab buttons when tag changes.
    $subAnchor = "const [, _force] = useState(0);"
    $subInject = @'
const [, _force] = useState(0);

          /* V436_TAB_NEXTFOCUSUP - re-render when the last-focused tile's
             tag changes so nextFocusUp stays up-to-date. */
          useEffect(() => {
            const unsub = v436Subscribe(() => _force((n) => n + 1));
            return unsub;
          }, []);
'@
    if ($l.Contains($subAnchor)) {
      $l = $l.Replace($subAnchor, $subInject)
      Write-Host "[OK] subscribed to v436 tag changes"
    }

    [System.IO.File]::WriteAllText($lAbs, $l)
}

Write-Host ""
Write-Host "[OK] v436 tab bar UP routing applied"
Write-Host "Now run: deploy_ota.bat"
