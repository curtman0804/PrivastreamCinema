/**
 * apply_patches_v71b.js — Hardened tab focus trap.
 *
 * v71 used a single findNodeHandle() call on the Pressable; on Android TV
 * with the new architecture that often returns 0 BEFORE the native view
 * is fully attached, so nextFocusLeft never got set and focus could
 * still escape upward.
 *
 * v71b:
 *   - Detects first/last tab from MULTIPLE sources (accessibilityLabel,
 *     to, href, route, target — whichever is present).
 *   - Tries to grab the native tag from THREE sources
 *     (findNodeHandle, ref._nativeTag, ref.__nativeTag).
 *   - Retries on a 50/200/500/1000 ms ladder after mount, also on
 *     onLayout and onFocus, until a valid tag is found.
 *   - Sets BOTH nextFocusLeft/nextFocusRight to self AND
 *     nextFocusUp to self for the edge tab — so LEFT on Discover and
 *     diagonal-UP fallback both stay trapped.
 *     Other tabs retain default UP behavior (back to content).
 *   - Adds focusable={true} explicitly.
 *
 * Only touches tabBarButton — the BackHandler change from v71 stays.
 *
 * Idempotent. Run:
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   curl -o apply_patches_v71b.js https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v71b.js
 *   node apply_patches_v71b.js
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

if (src.includes('PATCH_V71B_TAB_FOCUS_TRAP')) {
  console.log('[OK] v71b already applied.');
  process.exit(0);
}

// Refuse to apply if v71 wasn't applied first (we depend on its imports)
if (!src.includes('PATCH_V71_BACK_ROUTE_AWARE') && !src.includes('findNodeHandle')) {
  console.error('[FAIL] expected v71 imports (findNodeHandle, usePathname, useRouter) to be in place.');
  console.error('       Apply apply_patches_v71.js first, then this one.');
  process.exit(3);
}

const bak = `${TARGET}.bak.v71b.${Date.now()}`;
fs.writeFileSync(bak, src);
console.log(`[ok] backup -> ${bak}`);

// ─── Replace the tabBarButton block ───
// Match either the original v71 tabBarButton or the pre-v71 version (be tolerant)
const re = /tabBarButton:\s*\(props\)\s*=>\s*\{[\s\S]*?\n\s*\},/;
if (!re.test(src)) {
  console.error('[FAIL] tabBarButton block not found');
  fs.writeFileSync(TARGET, src); // restore (no-op since we didn't change)
  process.exit(2);
}

const newBlock =
`tabBarButton: (props) => {
          // PATCH_V71B_TAB_FOCUS_TRAP - hardened trap with multi-source tag detection.
          const [isFocused, setIsFocused] = useState(false);
          const btnRef = useRef(null);
          const [selfTag, setSelfTag] = useState(0);

          // Detect first/last tab from any available source.
          const blob = String(
            (props.accessibilityLabel || '') + ' ' +
            (props.to || '') + ' ' +
            (props.href || '') + ' ' +
            (props.route?.name || '') + ' ' +
            (props.target || '')
          ).toLowerCase();
          const isFirst = blob.includes('discover');
          const isLast = blob.includes('profile');

          // Try to grab a valid native tag from multiple sources.
          const grabTag = () => {
            if (!btnRef.current || !(isFirst || isLast)) return;
            const r = btnRef.current;
            let tag = 0;
            try {
              const t = findNodeHandle(r);
              if (t && t > 0) tag = t;
            } catch (_) {}
            if (!tag && r._nativeTag && r._nativeTag > 0) tag = r._nativeTag;
            if (!tag && r.__nativeTag && r.__nativeTag > 0) tag = r.__nativeTag;
            if (tag && tag !== selfTag) setSelfTag(tag);
          };

          // Ladder of retries so we don't depend on a single mount-time call.
          useEffect(() => {
            if (!(isFirst || isLast)) return;
            const timers = [50, 200, 500, 1000, 2000].map((ms) => setTimeout(grabTag, ms));
            return () => { timers.forEach(clearTimeout); };
          }, [isFirst, isLast]);

          const trap = {};
          if (selfTag > 0) {
            if (isFirst) {
              trap.nextFocusLeft = selfTag;
              trap.nextFocusUp   = selfTag; // block diagonal-up fallback too
            }
            if (isLast) {
              trap.nextFocusRight = selfTag;
              trap.nextFocusUp    = selfTag; // block diagonal-up fallback too
            }
          }

          return (
            <Pressable
              ref={btnRef}
              {...props}
              {...trap}
              focusable={true}
              onLayout={grabTag}
              onFocus={() => { setIsFocused(true); grabTag(); }}
              onBlur={() => setIsFocused(false)}
              style={({ focused }) => [
                props.style,
                (focused || isFocused) && styles.tabItemFocused,
              ]}
            />
          );
        },`;

const before = src;
src = src.replace(re, newBlock);
if (src === before) {
  console.error('[FAIL] tabBarButton replacement was a no-op?!');
  fs.writeFileSync(TARGET, before);
  process.exit(2);
}

fs.writeFileSync(TARGET, src);

console.log('[ok] replace-tabBarButton-hardened');
console.log('');
console.log('===================================================================');
console.log(' V71B APPLIED - hardened tab focus trap.');
console.log('===================================================================');
console.log(' Expected after rebuild:');
console.log('   - LEFT on Discover tab  -> stays on Discover (no jump up)');
console.log('   - RIGHT on Profile tab  -> stays on Profile (no jump up)');
console.log('   - UP from middle tabs   -> still works as before');
console.log('   - UP from Discover/Profile tabs -> stays (use Search/Library to go up)');
console.log('');
console.log(' Note: UP from Discover/Profile is also trapped (intentional). To');
console.log(' navigate back up to posters from the edge, press LEFT or RIGHT first');
console.log(' to a middle tab (Search/Library/Addons), then UP.');
console.log('');
console.log(' ROLLBACK:');
console.log(`   copy /Y "${bak}" "${TARGET}"`);
console.log('');
