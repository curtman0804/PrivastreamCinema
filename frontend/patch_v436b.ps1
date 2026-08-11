# patch_v436b.ps1 - ASCII-only anchors for tab bar nextFocusUp fix
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host "V436b: Tab bar nextFocusUp -> last tile"

# ---------- Part A: ContentCard v436 tag memory ----------
$fPath = 'src\components\ContentCard.tsx'
$fAbs  = (Resolve-Path -LiteralPath $fPath).Path
$f     = [System.IO.File]::ReadAllText($fAbs)

if (-not $f.Contains('V436_TAG_MEMORY')) {
  $oldMod = "let _v435LastFocusedId: string | null = null;`nexport function v435GetLastFocused(): string | null { return _v435LastFocusedId; }`nexport function v435SetLastFocused(id: string | null): void { _v435LastFocusedId = id || null; }"
  $newMod = @'
let _v435LastFocusedId: string | null = null;
export function v435GetLastFocused(): string | null { return _v435LastFocusedId; }
export function v435SetLastFocused(id: string | null): void { _v435LastFocusedId = id || null; }

/* V436_TAG_MEMORY */
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

  $oldFocus = "try {`n      const _v435Id = String((item as any)?.imdb_id || (item as any)?.id || '');`n      if (_v435Id) v435SetLastFocused(_v435Id);`n    } catch (_) {}"
  $newFocus = @'
try {
      const _v435Id = String((item as any)?.imdb_id || (item as any)?.id || '');
      if (_v435Id) v435SetLastFocused(_v435Id);
    } catch (_) {}
    /* V436_TAG_MEMORY - capture native tag for tab bar nextFocusUp. */
    try {
      const _r: any = pressableRef.current;
      if (_r) {
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

  [System.IO.File]::WriteAllText($fAbs, $f)
  Write-Host "[OK] ContentCard v436 tag memory installed"
} else {
  Write-Host "[SKIP] v436 already in ContentCard"
}

# ---------- Part B: Tabs _layout.tsx ----------
$lPath = 'app\(tabs)\_layout.tsx'
$lAbs  = (Resolve-Path -LiteralPath $lPath).Path
$l     = [System.IO.File]::ReadAllText($lAbs)

if ($l.Contains('V436_TAB_NEXTFOCUSUP')) {
  Write-Host "[SKIP] tab layout already patched"
} else {
  # Add imports
  $impAnchor = "import { useSafeAreaInsets } from 'react-native-safe-area-context';"
  $impInject = @'
import { useSafeAreaInsets } from 'react-native-safe-area-context';
/* V436_TAB_NEXTFOCUSUP */
import { v436GetLastFocusedTag, v436Subscribe } from '../../src/components/ContentCard';
'@
  if ($l.Contains($impAnchor)) {
    $l = $l.Replace($impAnchor, $impInject)
  }

  # Insert nextFocusUp BEFORE the existing "trap.nextFocusDown = selfTag" line.
  $downAnchor = @'
if (selfTag > 0) {
            trap.nextFocusDown = selfTag;
          }
'@
  $downNew = @'
if (selfTag > 0) {
            trap.nextFocusDown = selfTag;
          }
          /* V436_TAB_NEXTFOCUSUP - UP jumps to last-focused tile's native tag. */
          const _v436Tag = v436GetLastFocusedTag();
          if (_v436Tag && _v436Tag > 0) {
            trap.nextFocusUp = _v436Tag;
          }
'@
  if ($l.Contains($downAnchor)) {
    $l = $l.Replace($downAnchor, $downNew)
    Write-Host "[OK] nextFocusUp injected before nextFocusDown block"
  } else {
    Write-Host "[FATAL] downAnchor missing"; exit 1
  }

  # Subscribe to v436 changes for re-render
  $subAnchor = "const [, _force] = useState(0);"
  $subInject = @'
const [, _force] = useState(0);

          /* V436 - re-render tab button when last-focused tile tag changes. */
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
Write-Host "[OK] v436b applied"
Write-Host "Now run: deploy_ota.bat"
