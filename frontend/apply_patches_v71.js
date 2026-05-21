/**
 * apply_patches_v71.js — Patch A (Tier 1 navigation fixes).
 *
 * Two surgical changes to app/(tabs)/_layout.tsx:
 *
 *   1. PATCH_V71_TAB_FOCUS_TRAP
 *      First tab (Discover) gets nextFocusLeft={self}, last tab
 *      (Profile) gets nextFocusRight={self}. Pressing LEFT on
 *      Discover or RIGHT on Profile is absorbed — no more leaking
 *      up into the posters. The selector stays within the tab bar.
 *
 *   2. PATCH_V71_BACK_ROUTE_AWARE
 *      Hardware back is now route-aware:
 *        • Nested screens (details, user management, etc.)
 *           → router.back() to previous screen
 *        • Non-Discover tabs (search / library / addons / profile)
 *           → navigate to Discover
 *        • Discover (root)
 *           → return false → system exits the app
 *      Replaces the previous "absorb everything silently" handler.
 *
 * Idempotent. Aborts cleanly if any anchor is missing — your file
 * is restored exactly as-is. Backup with timestamp.
 *
 * Run:
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   curl -o apply_patches_v71.js https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v71.js
 *   node apply_patches_v71.js
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'app', '(tabs)', '_layout.tsx');
if (!fs.existsSync(TARGET)) {
  console.error('[FAIL] not found:', TARGET);
  process.exit(1);
}
console.log(`[ok] target: ${TARGET}`);

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes('PATCH_V71_TAB_FOCUS_TRAP')) {
  console.log('[OK] v71 already applied.');
  process.exit(0);
}

const bak = `${TARGET}.bak.v71.${Date.now()}`;
fs.writeFileSync(bak, src);
console.log(`[ok] backup -> ${bak}`);

const steps = [];
function step(name, fn) {
  const before = src;
  fn();
  if (src === before) {
    console.error(`[FAIL] step "${name}" made no change. Anchor missing.`);
    fs.writeFileSync(TARGET, before);
    process.exit(2);
  }
  steps.push(name);
  console.log(`[ok] ${name}`);
}

// ─── 1. Add usePathname + useRouter to expo-router import ───
step('add-router-imports', () => {
  src = src.replace(
    /import\s*\{\s*Tabs\s*\}\s*from\s*'expo-router';/,
    `import { Tabs, usePathname, useRouter } from 'expo-router';`
  );
});

// ─── 2. Add findNodeHandle to react-native import ───
step('add-findnodehandle-import', () => {
  const re = /import\s*\{\s*([^}]*)\s*\}\s*from\s*'react-native';/;
  if (!re.test(src)) throw new Error('react-native import not found');
  src = src.replace(re, (full, inside) => {
    if (inside.includes('findNodeHandle')) return full; // already present
    return `import { ${inside.trim()}, findNodeHandle } from 'react-native';`;
  });
});

// ─── 3. Replace the entire BackHandler useEffect with route-aware version ───
step('replace-backhandler', () => {
  const re = /\/\/\s*PATCH_V34_ROOT_SILENT_NO_OP[\s\S]*?useEffect\(\(\)\s*=>\s*\{[\s\S]*?\},\s*\[\]\s*\);/;
  if (!re.test(src)) throw new Error('PATCH_V34 backhandler block not found');
  src = src.replace(re,
`// PATCH_V71_BACK_ROUTE_AWARE - hardware back is route-aware now.
  //   Nested screens -> router.back()
  //   Non-Discover tabs -> go to Discover
  //   Discover (root) -> return false, OS exits the app
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const onBack = () => {
      try {
        if (router.canGoBack && router.canGoBack()) {
          router.back();
          return true;
        }
      } catch (_) {}
      const p = String(pathname || '').toLowerCase();
      // On Discover (root) -> let system exit
      if (p === '/' || p.endsWith('/discover') || p === '/(tabs)' || p === '/(tabs)/discover') {
        return false;
      }
      // Any other tab -> back to Discover
      try {
        router.replace('/(tabs)/discover');
        return true;
      } catch (_) {
        return false;
      }
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBack);
    return () => { try { sub.remove(); } catch (_) {} };
  }, [pathname]);`
  );
});

// ─── 4. Replace tabBarButton with focus-trap version ───
step('replace-tabBarButton', () => {
  const re = /tabBarButton:\s*\(props\)\s*=>\s*\{[\s\S]*?\n\s*\},/;
  if (!re.test(src)) throw new Error('tabBarButton block not found');
  src = src.replace(re,
`tabBarButton: (props) => {
          // PATCH_V71_TAB_FOCUS_TRAP - first tab traps LEFT, last tab traps RIGHT.
          const [isFocused, setIsFocused] = useState(false);
          const btnRef = useRef(null);
          const [selfTag, setSelfTag] = useState(0);
          const label = String(props.accessibilityLabel || '').toLowerCase();
          const isFirst = label.includes('discover');
          const isLast = label.includes('profile');
          const onLayout = () => {
            if ((isFirst || isLast) && btnRef.current) {
              try {
                const tag = findNodeHandle(btnRef.current);
                if (tag && tag > 0 && tag !== selfTag) setSelfTag(tag);
              } catch (_) {}
            }
          };
          const trap = {};
          if (isFirst && selfTag) trap.nextFocusLeft = selfTag;
          if (isLast && selfTag) trap.nextFocusRight = selfTag;
          return (
            <Pressable
              ref={btnRef}
              {...props}
              {...trap}
              onLayout={onLayout}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              style={({ focused }) => [
                props.style,
                (focused || isFocused) && styles.tabItemFocused,
              ]}
            />
          );
        },`
  );
});

// ─── 5. Persist ───
fs.writeFileSync(TARGET, src);

console.log('');
console.log('===================================================================');
console.log(` V71 APPLIED - ${steps.length} steps. Patch A complete.`);
console.log('===================================================================');
steps.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));
console.log('');
console.log(' Expected after rebuild:');
console.log('   - LEFT on Discover tab    -> stays on Discover (no jump up)');
console.log('   - RIGHT on Profile tab    -> stays on Profile (no jump up)');
console.log('   - Back on User Management -> goes to previous screen');
console.log('   - Back on Search/Library  -> goes to Discover');
console.log('   - Back on Discover        -> exits the app');
console.log('');
console.log(' ROLLBACK:');
console.log(`   copy /Y "${bak}" "${TARGET}"`);
console.log('');
