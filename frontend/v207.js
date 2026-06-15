// =============================================================================
// PATCH v207 — Addon-install lag, Add-Addon focus jump, Search infinite scroll,
//              Search→Discover back-nav lag.
//
// Run from C:\Users\Curtm\PrivastreamCinema\frontend:
//   curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v207_addons_search.js -o v207.js
//   node v207.js
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
function abs(p) { return path.join(ROOT, p); }
function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, c) { fs.writeFileSync(p, c, 'utf8'); }
function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function patch(label, file, mutator) {
  const full = abs(file);
  if (!exists(full)) { console.log('  [skip] ' + label + ' — not found: ' + file); return; }
  const before = read(full);
  const after = mutator(before);
  if (after === before) { console.log('  [noop] ' + label); return; }
  fs.writeFileSync(full + '.bak_v207', before, 'utf8');
  write(full, after);
  console.log('  [ok]   ' + label);
}

console.log('--- Applying v207 patch ---');

// ============================================================================
// FIX A — Addon install lag: close modal instantly, drop Alert.alert,
//         fire-and-forget the discover/addons refetches.
// ============================================================================
patch('addons — instant-close install + no blocking alert', 'app/(tabs)/addons.tsx', (src) => {
  let s = src;

  // 1) Code-flow install (handleResolveAndInstall) — replace the block from
  //    setShowModal(false) down to Alert.alert('Success', ...).
  s = s.replace(
    /await api\.addons\.install\(resolvedUrl\);\s*\n\s*setShowModal\(false\);\s*\n\s*setShortCode\(''\);\s*\n\s*\/\/ V204_SOFT_REFRESH[\s\S]*?fetchAddons\(true\);\s*\n\s*InteractionManager\.runAfterInteractions\(\(\) => \{ fetchDiscover\(true\); \}\);\s*\n\s*Alert\.alert\('Success', 'Addon installed!'\);/,
    `await api.addons.install(resolvedUrl);
        // v207 — close + reset BEFORE doing anything else so the user sees
        // an instant snap back to the addons list.  Both refetches run in
        // the background; no Alert.alert (it blocks the UI thread on TV).
        setShowModal(false);
        setShortCode('');
        setIsInstalling(false);
        InteractionManager.runAfterInteractions(() => {
          try { (useContentStore.getState() as any).nukeDiscoverCache?.(true); } catch (_) {}
          fetchAddons(true);
          fetchDiscover(true);
        });`
  );

  // 2) URL-flow install (handleInstallAddon) — same treatment.
  s = s.replace(
    /if \(successCount > 0\) \{\s*\n\s*setShowModal\(false\);\s*\n\s*setAddonUrl\(''\);\s*\n\s*\/\/ V204_SOFT_REFRESH[\s\S]*?fetchAddons\(true\);\s*\n\s*InteractionManager\.runAfterInteractions\(\(\) => \{ fetchDiscover\(true\); \}\);\s*\n\s*\}/,
    `if (successCount > 0) {
      // v207 — instant close + background refetch (no Alert.alert)
      setShowModal(false);
      setAddonUrl('');
      InteractionManager.runAfterInteractions(() => {
        try { (useContentStore.getState() as any).nukeDiscoverCache?.(true); } catch (_) {}
        fetchAddons(true);
        fetchDiscover(true);
      });
    }`
  );

  return s;
});

// ============================================================================
// FIX B — Add-Addon focus jump: TextInput "Next" key should land on Install,
//         not the X close button.  Wire onSubmitEditing → install button ref.
// ============================================================================
patch('addons — Next/Done on TextInput focuses Install', 'app/(tabs)/addons.tsx', (src) => {
  let s = src;

  // 1) Inject Install-button refs near the other state hooks.  We anchor on
  //    the existing `const [codeTabFocused, setCodeTabFocused] = useState(false);`
  if (!s.includes('_v207InstallCodeRef')) {
    s = s.replace(
      /const \[codeTabFocused, setCodeTabFocused\] = useState\(false\);/,
      `const [codeTabFocused, setCodeTabFocused] = useState(false);
  // v207 — refs so TextInput "Next" can punch focus directly into Install
  const _v207InstallCodeRef = useRef<any>(null);
  const _v207InstallUrlRef = useRef<any>(null);
  const _v207FocusInstall = (which: 'code' | 'url') => {
    const ref = which === 'code' ? _v207InstallCodeRef : _v207InstallUrlRef;
    try {
      const node = ref.current;
      if (!node) return;
      if (typeof node.focus === 'function') node.focus();
      else if (typeof node.setNativeProps === 'function') node.setNativeProps({ hasTVPreferredFocus: true });
    } catch (_) {}
  };`
    );
  }

  // 2) Make sure useRef is imported.  If not, append to existing react import.
  if (!/from ['"]react['"];\s*$/m.test(s) || !/useRef/.test(s.split(/from ['"]react['"];/)[0])) {
    // Targeted: locate `import { useEffect, useState ... } from 'react';`
    s = s.replace(
      /import \{([^}]*)\} from 'react';/,
      (m, names) => {
        if (/\buseRef\b/.test(names)) return m;
        return `import {${names.trimEnd().replace(/,?\s*$/, '')}, useRef } from 'react';`;
      }
    );
  }

  // 3) Add onSubmitEditing + returnKeyType + blurOnSubmit on the code TextInput
  s = s.replace(
    /(<TextInput\s+style=\[styles\.modalInput, codeFocused && styles\.modalInputFocused\][\s\S]*?keyboardType="number-pad"\s*\/>)/,
    (m) => m.replace(
      /\/>/,
      `  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => _v207FocusInstall('code')}
                />`
    )
  );

  // 4) Add onSubmitEditing on URL TextInput (multiline — RN ignores returnKeyType
  //    on multiline, so we additionally toggle multiline off).
  s = s.replace(
    /(<TextInput\s+style=\[styles\.modalInput, inputFocused && styles\.modalInputFocused\][\s\S]*?numberOfLines=\{3\}\s*\/>)/,
    (m) => m
      .replace(/multiline=\{true\}/, 'multiline={false}')
      .replace(/numberOfLines=\{3\}/, 'numberOfLines={1}')
      .replace(
        /\/>/,
        `  returnKeyType="done"
                  blurOnSubmit={false}
                  onSubmitEditing={() => _v207FocusInstall('url')}
                />`
      )
  );

  // 5) Attach refs to the Install <FocusButton>s.  FocusButton must forward
  //    refs — we add `ref={...}`.  If FocusButton doesn't forwardRef, this
  //    is harmless and we still benefit from setNativeProps fallback.
  s = s.replace(
    /<FocusButton\s+onPress=\{handleResolveAndInstall\}\s+disabled=\{isInstalling \|\| isResolvingCode\}/,
    '<FocusButton\n                  ref={_v207InstallCodeRef}\n                  onPress={handleResolveAndInstall}\n                  disabled={isInstalling || isResolvingCode}'
  );
  s = s.replace(
    /<FocusButton\s+onPress=\{handleInstallAddon\}\s+disabled=\{isInstalling\}/,
    '<FocusButton\n                  ref={_v207InstallUrlRef}\n                  onPress={handleInstallAddon}\n                  disabled={isInstalling}'
  );

  return s;
});

// ============================================================================
// FIX B-helper — FocusButton must accept a ref so the focus jump can land.
// Wrap the existing function component in React.forwardRef.
// ============================================================================
patch('addons — make FocusButton forwardRef-aware', 'app/(tabs)/addons.tsx', (src) => {
  let s = src;
  if (s.includes('// v207 FocusButton forwardRef')) return s;

  // Match: function FocusButton({ ... }: { ... }) { ... }
  // We capture the destructured props, the typed-props block, the body, and
  // the JSX return.
  const re = /function FocusButton\(\{([\s\S]*?)\}: \{([\s\S]*?)\}\) \{([\s\S]*?)return \(([\s\S]*?<Pressable[\s\S]*?<\/Pressable>)([\s\S]*?)\);\s*\n\}/;
  if (!re.test(s)) return s;

  s = s.replace(re, (_m, props, types, body, jsxOpen, jsxClose) => {
    let newJsx = jsxOpen;
    if (!/\bref=\{/.test(newJsx)) {
      newJsx = newJsx.replace(/<Pressable\b/, '<Pressable ref={_v207fbRef as any}');
    }
    return `// v207 FocusButton forwardRef — accept ref so addon Install can be
// programmatically focused from TextInput onSubmitEditing.
const FocusButton = React.forwardRef<any, any>(function FocusButton({${props}}: {${types}}, _v207fbRef: any) {${body}return (${newJsx}${jsxClose});\n});`;
  });

  // Ensure React (default) is imported alongside the named hooks
  if (!/import React/.test(s)) {
    s = s.replace(
      /import \{([^}]*)\} from 'react';/,
      `import React, {${'$1'.trim()}} from 'react';`
    );
  } else if (/^import \{([^}]*)\} from 'react';/m.test(s) && !/^import React/m.test(s)) {
    s = s.replace(
      /^import \{([^}]*)\} from 'react';/m,
      `import React, {$1} from 'react';`
    );
  }

  return s;
});

// ============================================================================
// FIX C — Search 30-cap → infinite scroll. Bump per-page limit, drop the
//          15-page hard ceiling, and switch to onScroll-near-end pagination
//          instead of unbounded auto-fire on every state change.
// ============================================================================
patch('contentStore — bump search page size 30→50', 'src/store/contentStore.ts', (src) => {
  let s = src;
  // search() initial page
  s = s.replace(
    /const data = await api\.content\.search\(query, 0, 30\);/,
    'const data = await api.content.search(query, 0, 50); // v207'
  );
  s = s.replace(
    /searchSkip: 30,/g,
    'searchSkip: 50, // v207'
  );
  // loadMoreSearch page
  s = s.replace(
    /const data = await api\.content\.search\(currentSearchQuery, searchSkip, 30\);/,
    'const data = await api.content.search(currentSearchQuery, searchSkip, 50); // v207'
  );
  s = s.replace(
    /searchSkip: searchSkip \+ 30,/g,
    'searchSkip: searchSkip + 50, // v207'
  );
  return s;
});

patch('search — onScroll-near-end pagination + lift hard cap', 'app/(tabs)/search.tsx', (src) => {
  let s = src;

  // 1) Lift the pagesLoaded.current >= 15 ceiling
  s = s.replace(
    /if \(pagesLoaded\.current >= 15\) return;/,
    '// v207 — hard cap lifted; backend hasMore now controls termination'
  );

  // 2) Convert the always-fire auto-load to scroll-triggered.
  //    Find the existing useEffect that calls loadMoreSearch and add a
  //    scrollOffsetRef guard so it only loads when the user has scrolled
  //    near the bottom (or the result list is still small).
  if (!s.includes('_v207ScrollY')) {
    s = s.replace(
      /const pagesLoaded = useRef<number>\(0\);/,
      `const pagesLoaded = useRef<number>(0);
  // v207 — scroll-triggered pagination
  const _v207ScrollY = useRef<number>(0);
  const _v207ContentH = useRef<number>(0);
  const _v207ViewH = useRef<number>(0);
  const _v207NearBottom = () => {
    if (_v207ContentH.current <= 0 || _v207ViewH.current <= 0) return true; // before first layout
    return (_v207ScrollY.current + _v207ViewH.current) > (_v207ContentH.current - 400);
  };`
    );
  }

  // 3) Gate loadMoreSearch on near-bottom OR small result count
  s = s.replace(
    /const handle = InteractionManager\.runAfterInteractions\(\(\) => \{\s*\n\s*pagesLoaded\.current \+= 1;\s*\n\s*loadMoreSearch\(\);\s*\n\s*\}\);/,
    `const handle = InteractionManager.runAfterInteractions(() => {
      const total = (searchMovies?.length || 0) + (searchSeries?.length || 0);
      // v207 — only auto-load if we still have very few results OR user has
      // scrolled near the bottom.  Prevents the eager 15-page flood.
      if (total < 60 || _v207NearBottom()) {
        pagesLoaded.current += 1;
        loadMoreSearch();
      }
    });`
  );

  // 4) Wire ScrollView onScroll + onContentSizeChange + onLayout so the
  //    refs above are populated.
  s = s.replace(
    /<ScrollView\s+ref=\{scrollViewRef\}/,
    `<ScrollView
          ref={scrollViewRef}
          onScroll={(e) => {
            _v207ScrollY.current = e.nativeEvent.contentOffset.y;
            _v207ViewH.current = e.nativeEvent.layoutMeasurement.height;
            if (_v207NearBottom() && searchHasMore && !isLoadingMoreSearch && !isLoadingSearch) {
              loadMoreSearch();
            }
          }}
          scrollEventThrottle={120}
          onContentSizeChange={(_w, h) => { _v207ContentH.current = h; }}
          onLayout={(e) => { _v207ViewH.current = e.nativeEvent.layout.height; }}`
  );

  return s;
});

// ============================================================================
// FIX D — Search→Discover back-nav lag.  Search screen carries heavy
//          ServiceRow trees in the store.  On blur, drop searchResults so
//          the Discover paint isn't competing with stale row reconciliation.
// ============================================================================
patch('search — clear results on blur (snappy back to Discover)', 'app/(tabs)/search.tsx', (src) => {
  let s = src;
  if (s.includes('// v207 — clear on blur')) return s;

  // Switch to useFocusEffect for proper blur cleanup.  Anchor on the existing
  // "Reset when component unmounts" effect.
  s = s.replace(
    /\/\/ Reset when component unmounts\s*\n\s*useEffect\(\(\) => \{\s*\n\s*return \(\) => \{\s*\n\s*hasTriggeredInitialSearch\.current = false;\s*\n\s*\}\;\s*\n\s*\}, \[queryParam\]\);/,
    `// Reset when component unmounts
  useEffect(() => {
    return () => {
      hasTriggeredInitialSearch.current = false;
    };
  }, [queryParam]);

  // v207 — clear on blur: drop heavy search rows from the store before the
  // Discover screen starts painting, so the back-nav animation is smooth.
  // Also cancels in-flight stream fetches that might pin the JS thread.
  useEffect(() => {
    return () => {
      try { clearSearch && clearSearch(); } catch (_) {}
      try { (useContentStore.getState() as any).cancelInFlightStreams?.(); } catch (_) {}
    };
  }, []);`
  );

  return s;
});

console.log('--- v207 patch complete ---');
console.log('');
console.log('Reload Metro (press r).  Then on Firestick verify:');
console.log('  1. Install an addon → modal closes instantly, no popup, no freeze.');
console.log('  2. + → Code/URL → typing + pressing Next jumps to Install (not X).');
console.log('  3. Search "horror" → posters keep loading as you scroll right then down.');
console.log('  4. Back from Search → Discover paints with no perceptible lag.');
console.log('');
console.log('If search results are still pinned at ~50 per row, the backend is capping');
console.log('hasMore=false early — separate backend patch needed, tell the agent.');
