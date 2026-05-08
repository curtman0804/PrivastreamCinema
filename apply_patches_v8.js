/* eslint-disable */
// apply_patches_v8.js
// Run from project root:   node apply_patches_v8.js
//
// Unifies the player's loading screen with the details autoplay overlay so
// the visual handoff between them is seamless.
//
// Old player loading: breathing-zoom logo + progress-fill animation + dynamic
//   "Starting Playback..." status text. Visually different from the autoplay
//   overlay user sees just before the player mounts.
//
// New player loading: static logo + episode title + thin sliding gold bar +
//   "Loading..." caption. Matches the autoplay overlay 1:1.

const fs = require('fs');
const path = require('path');

const PLAYER = path.join('frontend', 'app', 'player.tsx');
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(PLAYER)) { bad('player.tsx not found'); process.exit(1); }

let src = fs.readFileSync(PLAYER, 'utf8');
const orig = src;
const bak = PLAYER + '.bak.' + Date.now();
fs.copyFileSync(PLAYER, bak);
info('backup → ' + bak);

console.log('\n=== Patching ' + PLAYER + ' ===');

// --- 1: Add a sliding-bar animation ref + effect (only once)
{
  const MARKER = 'PATCH_V8_LOADBAR_ANIM';
  if (src.includes(MARKER)) {
    ok('V8 loading-bar animation already installed');
  } else {
    const anchor = '  const breatheAnim = useRef(new Animated.Value(1)).current;';
    if (!src.includes(anchor)) {
      bad('could not find breatheAnim anchor for loading-bar animation');
    } else {
      const insert = [
        '  const breatheAnim = useRef(new Animated.Value(1)).current;',
        '',
        '  // ' + MARKER + ' — sliding gold bar for unified loading screen',
        '  const loadingBarAnim = useRef(new Animated.Value(-120)).current;',
        '  useEffect(() => {',
        '    if (!isLoading || error) return;',
        '    const w = Dimensions.get(\'window\').width;',
        '    const loop = Animated.loop(',
        '      Animated.sequence([',
        '        Animated.timing(loadingBarAnim, { toValue: w * 0.6, duration: 1400, useNativeDriver: true }),',
        '        Animated.timing(loadingBarAnim, { toValue: -120, duration: 0, useNativeDriver: true }),',
        '      ])',
        '    );',
        '    loop.start();',
        '    return () => { try { loop.stop(); } catch (_) {} };',
        '  }, [isLoading, error]);',
      ].join('\n');
      src = src.replace(anchor, insert);
      ok('added sliding-bar animation ref + effect');
    }
  }
}

// --- 2: Replace the entire stremio loading-screen JSX block
{
  const MARKER = 'PATCH_V8_UNIFIED_LOADING';
  if (src.includes(MARKER)) {
    ok('V8 unified loading screen already installed');
  } else {
    // Match from the comment "/* Stremio-Style Loading Screen */" through the
    // outermost closing of the conditional render.
    // The block is large; we identify it by its unique opening and closing
    // signatures using a regex.
    const re = /\{\/\*\s*Stremio-Style Loading Screen\s*\*\/\}\s*\n\s*\{isLoading && !error && \(\s*\n\s*<View style=\{styles\.stremioLoadingContainer\}>[\s\S]*?\n\s*\)\}\n/m;

    if (!re.test(src)) {
      bad('could not locate the existing loading-screen JSX block');
      info('looked for /* Stremio-Style Loading Screen */ ... <View styles.stremioLoadingContainer>');
    } else {
      const replacement = [
        "      {/* " + MARKER + " — unified loading screen (matches autoplay overlay) */}",
        "      {isLoading && !error && (",
        "        <View style={styles.stremioLoadingContainer}>",
        "          {/* Backdrop with blur — same image the autoplay overlay used */}",
        "          {(backdrop || poster) ? (",
        "            <Image",
        "              source={{ uri: backdrop || poster }}",
        "              style={styles.loadingBackdrop}",
        "              blurRadius={Platform.OS === 'web' ? 0 : 8}",
        "            />",
        "          ) : null}",
        "",
        "          {/* Dark overlay for legibility */}",
        "          <View style={styles.loadingDarkOverlay} />",
        "",
        "          {/* Centered content — series logo + episode title + thin gold bar */}",
        "          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>",
        "            {logo ? (",
        "              <Image",
        "                source={{ uri: logo }}",
        "                style={{ width: 280, height: 90, marginBottom: 18 }}",
        "                resizeMode=\"contain\"",
        "              />",
        "            ) : null}",
        "",
        "            {title ? (",
        "              <Text",
        "                style={{",
        "                  color: '#FFFFFF',",
        "                  fontSize: 22,",
        "                  fontWeight: '700',",
        "                  textAlign: 'center',",
        "                  marginBottom: 28,",
        "                  paddingHorizontal: 16,",
        "                  letterSpacing: 0.3,",
        "                }}",
        "                numberOfLines={2}",
        "              >",
        "                {title}",
        "              </Text>",
        "            ) : null}",
        "",
        "            {/* Indeterminate sliding gold bar */}",
        "            <View",
        "              style={{",
        "                width: Math.min(Dimensions.get('window').width * 0.6, 480),",
        "                height: 3,",
        "                backgroundColor: 'rgba(255,255,255,0.15)',",
        "                borderRadius: 2,",
        "                overflow: 'hidden',",
        "              }}",
        "            >",
        "              <Animated.View",
        "                style={{",
        "                  position: 'absolute',",
        "                  left: 0,",
        "                  top: 0,",
        "                  width: 120,",
        "                  height: '100%',",
        "                  backgroundColor: '#B8A05C',",
        "                  borderRadius: 2,",
        "                  transform: [{ translateX: loadingBarAnim }],",
        "                }}",
        "              />",
        "            </View>",
        "",
        "            <Text",
        "              style={{",
        "                color: 'rgba(255,255,255,0.7)',",
        "                fontSize: 13,",
        "                marginTop: 16,",
        "                fontWeight: '500',",
        "                letterSpacing: 0.5,",
        "              }}",
        "            >",
        "              Loading\u2026",
        "            </Text>",
        "          </View>",
        "        </View>",
        "      )}",
        "",
      ].join('\n');

      src = src.replace(re, replacement);
      ok('replaced loading screen with unified autoplay-overlay style');
    }
  }
}

// --- 3: Stop setting "Starting Playback..." status text (for any remaining renders)
{
  let count = 0;
  const before = src;
  src = src.replace(/setLoadingStatus\(\s*`Starting Playback\$\{dots\}`\s*\)/g, () => { count++; return 'setLoadingStatus(\'\')'; });
  src = src.replace(/setLoadingStatus\(\s*'Starting Playback\.\.\.'\s*\)/g, () => { count++; return 'setLoadingStatus(\'\')'; });
  src = src.replace(/setLoadingStatus\(peerCount > 0 \? `Starting Playback\$\{dots\}` : 'Searching for streams\.\.\.'\)/g, () => { count++; return 'setLoadingStatus(\'\')'; });
  if (count > 0) {
    ok('blanked ' + count + ' "Starting Playback..." status updates');
  } else if (before === src) {
    ok('no "Starting Playback..." status updates left to blank');
  }
}

// Save
if (src !== orig) {
  fs.writeFileSync(PLAYER, src, 'utf8');
  ok('saved ' + PLAYER);
} else {
  info('no changes made — already patched or anchors not found');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nSome patches failed. Originals are safe in .bak files.');
  process.exit(1);
} else {
  console.log('\nV8 installed. Rebuild the APK and test:');
  console.log('  ✓ Auto-play handoff: details overlay → player loading should look IDENTICAL');
  console.log('  ✓ No more "Starting Playback..." text changes');
  console.log('  ✓ Same backdrop + logo + episode title + thin gold bar throughout');
  console.log('\n(Auto-pick highest-quality English stream coming in V9.)');
}
