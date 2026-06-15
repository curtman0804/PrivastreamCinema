// =============================================================================
// PATCH v208 — Discover cold-boot, CW row focus snap, mobile drag-to-FF
//
// Run from C:\Users\Curtm\PrivastreamCinema\frontend:
//   curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v208_coldboot_cwfocus_dragff.js -o v208.js
//   node v208.js
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const abs = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, c) => fs.writeFileSync(p, c, 'utf8');
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

function patch(label, file, mutator) {
  const full = abs(file);
  if (!exists(full)) { console.log('  [skip] ' + label + ' — not found: ' + file); return; }
  const before = read(full);
  const after = mutator(before);
  if (after === before) { console.log('  [noop] ' + label); return; }
  fs.writeFileSync(full + '.bak_v208', before, 'utf8');
  write(full, after);
  console.log('  [ok]   ' + label);
}

console.log('--- Applying v208 patch ---');

// =============================================================================
// FIX 1 — Discover cold-boot: defer fetchAddons + use InteractionManager so the
//         first paint isn't competing with non-critical network calls.
// =============================================================================
patch('discover — defer fetchAddons on cold boot', 'app/(tabs)/discover.tsx', (src) => {
  let s = src;
  if (s.includes('// v208 cold-boot defer')) return s;

  // Replace the cold-boot useEffect that fires all three fetches in parallel.
  s = s.replace(
    /useEffect\(\(\) => \{\s*\n\s*fetchAddons\(\);\s*\n\s*fetchDiscover\(\);\s*\n\s*fetchContinueWatching\(\);\s*\n\s*\}, \[\]\);/,
    `useEffect(() => {
    // v208 cold-boot defer — paint Discover/CW first, push the non-critical
    // addon list fetch out past the first frame so cold boot is snappy.
    fetchDiscover();
    fetchContinueWatching();
    const _v208h = InteractionManager.runAfterInteractions(() => {
      try { fetchAddons(); } catch (_) {}
    });
    return () => { try { _v208h.cancel && _v208h.cancel(); } catch (_) {} };
  }, []);`
  );

  return s;
});

// =============================================================================
// FIX 2 — CW row focus snap: register the FIRST Continue-Watching poster's
//         native node-handle as a global "upward focus target" so every
//         ContentCard below uses it for `nextFocusUp`.  When CW has only
//         one poster, UP from any service-row card lands on that poster.
// =============================================================================
patch('ContentCard — global upward-focus target (v208UpwardTarget)', 'src/components/ContentCard.tsx', (src) => {
  let s = src;
  if (s.includes('_v208UpwardTarget')) return s;

  // 1) Add the module-level state + setter + subscribers near the top of the
  //    file, right after the v160 poster registry block.
  s = s.replace(
    /(\/\/ V160_POSTER_REGISTRY[\s\S]*?const _v160PosterRegistry: Record<string, string> = \{\};)/,
    `$1
// v208 — Global upward focus target.  Discover registers the FIRST Continue
// Watching poster's nodeHandle here; every ContentCard below sets it on
// Pressable.nextFocusUp so pressing UP from any service-row poster — even
// when CW has just one item — always lands on the CW poster.
export let _v208UpwardTarget: number | null = null;
const _v208UpwardSubs = new Set<() => void>();
export function v208SetUpwardTarget(tag: number | null): void {
  if (_v208UpwardTarget === tag) return;
  _v208UpwardTarget = tag;
  _v208UpwardSubs.forEach((cb) => { try { cb(); } catch (_) {} });
}
export function v208SubscribeUpwardTarget(cb: () => void): () => void {
  _v208UpwardSubs.add(cb);
  return () => { _v208UpwardSubs.delete(cb); };
}`
  );

  // 2) Inside the ContentCard component, subscribe to the upward target so the
  //    card re-renders when it changes.  Anchor on the existing _v172Bump state.
  s = s.replace(
    /const \[, _v172Bump\] = useState\(0\);\s*\n\s*useEffect\(\(\) => v172SubscribeWatched/,
    `const [, _v172Bump] = useState(0);
  // v208 — re-render this card whenever the upward focus target changes.
  useEffect(() => v208SubscribeUpwardTarget(() => _v172Bump((x) => (x + 1) & 0xff)), []);
  useEffect(() => v172SubscribeWatched`
  );

  // 3) Add the nextFocusUp prop on the Pressable, only on Android (TV).
  //    Anchor on the existing nextFocusRight block.
  s = s.replace(
    /nextFocusRight=\{\s*isLastInRow && selfNode\s*\?\s*selfNode\s*:\s*undefined\s*\}/,
    `nextFocusRight={
        isLastInRow && selfNode
          ? selfNode
          : undefined
      }

      /* v208 — punch UP focus into the registered CW item if any */
      nextFocusUp={
        Platform.OS === 'android' && _v208UpwardTarget
          ? _v208UpwardTarget
          : undefined
      }`
  );

  // 4) Make sure Platform is imported.
  if (!/from ['"]react-native['"];/.test(s)) {
    // shouldn't happen, but bail safely
  } else if (!/\bPlatform\b/.test(s.split("from 'react-native';")[0])) {
    s = s.replace(
      /import \{([\s\S]+?)\} from 'react-native';/,
      (_m, names) => {
        if (/\bPlatform\b/.test(names)) return `import {${names}} from 'react-native';`;
        const cleaned = names.replace(/\s+$/,'').replace(/,\s*$/,'');
        return `import {${cleaned}, Platform } from 'react-native';`;
      }
    );
  }

  return s;
});

patch('discover — register first CW poster as upward target', 'app/(tabs)/discover.tsx', (src) => {
  let s = src;
  if (s.includes('v208SetUpwardTarget')) return s;

  // 1) Import the helpers from ContentCard alongside existing imports.
  if (!/v208SetUpwardTarget/.test(s)) {
    // Look for an existing import from ContentCard with v176k* names and append.
    if (/from\s+['"]\.\.\/\.\.\/src\/components\/ContentCard['"]/.test(s)) {
      s = s.replace(
        /(import \{[\s\S]*?)(\} from ['"]\.\.\/\.\.\/src\/components\/ContentCard['"];)/,
        '$1  v208SetUpwardTarget,\n$2'
      );
    } else {
      // Fallback: inject a fresh import
      s = `import { v208SetUpwardTarget } from '../../src/components/ContentCard';\n` + s;
    }
  }

  // 2) In the ContinueWatchingItem function, register the first item's tag.
  //    Anchor on the existing posterTag setter inside the useEffect.
  s = s.replace(
    /if \(pTag\) setPosterTag\(pTag\);\s*\n\s*if \(xTag\) setXButtonTag\(xTag\);\s*\n\s*\}, \[\]\);/,
    `if (pTag) setPosterTag(pTag);
    if (xTag) setXButtonTag(xTag);
    // v208 — first CW item exposes its tag as the global "press UP from below" target
    if (pTag && (item as any).__v208IsFirstCW) {
      try { v208SetUpwardTarget(pTag); } catch (_) {}
    }
  }, []);

  // v208 — clear on unmount of the first CW item so we don't keep a stale tag.
  useEffect(() => {
    return () => {
      if ((item as any).__v208IsFirstCW) {
        try { v208SetUpwardTarget(null); } catch (_) {}
      }
    };
  }, []);`
  );

  // 3) In renderContinueWatchingItem, tag the first item with __v208IsFirstCW
  //    so the registration above fires only on index 0.
  s = s.replace(
    /const renderContinueWatchingItem = useCallback\(\s*\n?\s*\(\{ item, index \}: \{ item: WatchProgress; index: number \}\) => \(/,
    `const renderContinueWatchingItem = useCallback(
  ({ item, index }: { item: WatchProgress; index: number }) => (`
  );
  s = s.replace(
    /<ContinueWatchingItem\s*\n?\s*item=\{item\}/,
    `<ContinueWatchingItem
      // v208 — flag the FIRST CW item so it registers as the upward focus target
      item={{ ...(item as any), __v208IsFirstCW: index === 0 } as any}`
  );

  return s;
});

// =============================================================================
// FIX 3 — Mobile drag-to-FF: PanResponder on the player progress bar so users
//         can swipe-scrub on touch devices.  On Android TV the existing
//         L/R focus-trap arrow controls are untouched.
// =============================================================================
patch('player — PanResponder drag-to-FF on progress bar', 'app/player.tsx', (src) => {
  let s = src;
  if (s.includes('// v208 drag-to-FF')) return s;

  // 1) Ensure PanResponder is imported from react-native.
  s = s.replace(
    /import \{([\s\S]+?)\} from 'react-native';/,
    (_m, names) => {
      if (/\bPanResponder\b/.test(names)) return `import {${names}} from 'react-native';`;
      const cleaned = names.replace(/\s+$/,'').replace(/,\s*$/,'');
      return `import {${cleaned}, PanResponder } from 'react-native';`;
    }
  );

  // 2) Replace the ProgressBar Pressable body to add the PanResponder hooks
  //    and a "dragging" overlay.  We use a minimal patch — keep all existing
  //    focus/keyboard behavior intact, just layer the touch responder on top.
  //
  //    Anchor on the existing `const focusTrapProps: any = {};` block which
  //    is unique to the ProgressBar inside player.tsx.
  s = s.replace(
    /\/\/ Build focus trap props - when focused, left\/right stays on this bar\s*\n\s*const focusTrapProps: any = \{\};\s*\n\s*if \(selfTag > 0\) \{\s*\n\s*focusTrapProps\.nextFocusLeft = selfTag;\s*\n\s*focusTrapProps\.nextFocusRight = selfTag;\s*\n\s*\}/,
    `// Build focus trap props - when focused, left/right stays on this bar
  const focusTrapProps: any = {};
  if (selfTag > 0) {
    focusTrapProps.nextFocusLeft = selfTag;
    focusTrapProps.nextFocusRight = selfTag;
  }

  // ─── v208 drag-to-FF ──────────────────────────────────────────────────
  // Mobile/touch users can swipe the progress bar to scrub.  We capture
  // the bar's window-relative X + width via measureInWindow at gesture
  // start so it works regardless of layout (rotated phones, tablets).
  const [_v208DragPct, _v208SetDragPct] = useState<number | null>(null);
  const _v208BarRectRef = useRef<{ x: number; width: number }>({ x: 0, width: 1 });
  const _v208MeasureBar = () => {
    try {
      const node = barRef.current as any;
      if (node && typeof node.measureInWindow === 'function') {
        node.measureInWindow((x: number, _y: number, w: number) => {
          if (typeof x === 'number' && typeof w === 'number' && w > 0) {
            _v208BarRectRef.current = { x, width: w };
          }
        });
      }
    } catch (_) {}
  };
  const _v208PctFromPageX = (pageX: number) => {
    const { x, width: w } = _v208BarRectRef.current;
    if (w <= 0) return 0;
    return Math.max(0, Math.min(1, (pageX - x) / w));
  };
  const _v208PanResponder = React.useMemo(() => PanResponder.create({
    // Only claim a gesture if it starts as a clear horizontal drag (>4px) so
    // single taps still go through onPress.  We also stay out of the way on
    // Android TV — the focus-trap arrow controls remain primary.
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_evt, g) => Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderGrant: (evt) => {
      _v208MeasureBar();
      const pct = _v208PctFromPageX(evt.nativeEvent.pageX);
      _v208SetDragPct(pct);
    },
    onPanResponderMove: (evt) => {
      const pct = _v208PctFromPageX(evt.nativeEvent.pageX);
      _v208SetDragPct(pct);
    },
    onPanResponderRelease: (evt) => {
      const pct = _v208PctFromPageX(evt.nativeEvent.pageX);
      _v208SetDragPct(null);
      if (duration > 0) {
        try { (onSeek as any)?.(Math.floor(pct * duration)); } catch (_) {}
      }
    },
    onPanResponderTerminate: () => { _v208SetDragPct(null); },
  }), [duration, onSeek]);
  const _v208DisplayPct = _v208DragPct != null
    ? Math.round(_v208DragPct * 100)
    : null;`
  );

  // 3) Inject the PanResponder handlers onto the Pressable by replacing the
  //    `{...focusTrapProps}` line with both spreads + an onLayout hook.
  s = s.replace(
    /\{\.\.\.focusTrapProps\}\s*\n\s*>/,
    `{...focusTrapProps}
      {..._v208PanResponder.panHandlers}
      onLayout={_v208MeasureBar}
    >`
  );

  // 4) When dragging, render the fill at the drag percentage instead of the
  //    playback percentage so the user gets immediate visual feedback.
  s = s.replace(
    /<View style=\{\[styles\.progressBarFill, \{ width: `\$\{percentage\}%` \}\]\} \/>\s*\n\s*<View style=\{\[styles\.progressBarThumb, \{ left: `\$\{percentage\}%` \}\]\} \/>/,
    `<View style={[styles.progressBarFill, { width: \`\${_v208DisplayPct != null ? _v208DisplayPct : percentage}%\` }]} />
      <View style={[styles.progressBarThumb, { left: \`\${_v208DisplayPct != null ? _v208DisplayPct : percentage}%\` }]} />`
  );

  return s;
});

console.log('--- v208 patch complete ---');
console.log('');
console.log('Press r in Expo CLI.  Then verify:');
console.log('  1. Cold boot Discover paints faster (CW + Discover first, Addons later).');
console.log('  2. From any poster in any row, press UP — focus lands on a CW poster');
console.log('     and the CW row title scrolls into view.  With only 1 CW item,');
console.log('     focus ALWAYS lands on it regardless of horizontal position.');
console.log('  3. Open player on a phone, drag the progress bar with your finger —');
console.log('     the thumb tracks your finger, release to seek.');
