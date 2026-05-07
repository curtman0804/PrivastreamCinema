/* eslint-disable */
// apply_patches_v2.js
// Run from project root:   node apply_patches_v2.js
//
// Fixes:
//   (1) Hardware back in player → ONE press lands on CURRENT episode info page
//       (no more walking back through every binge-watched episode).
//   (2) "Up Next" poster shows episode backdrop (not series poster) — fixes
//       a field-name mismatch between details (sent `nextEpisodeBackdrop`)
//       and player (reads `nextEpisodePoster`).
//   (3) Auto-play loading overlay in details now uses the EPISODE backdrop,
//       so the visual handoff to the player loading screen looks continuous
//       (no more "switching between two loading screens").

const fs = require('fs');
const path = require('path');

const PLAYER  = path.join('frontend', 'app', 'player.tsx');
const DETAILS = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

function backup(file) {
  const bak = file + '.bak.' + Date.now();
  fs.copyFileSync(file, bak);
  info('backup → ' + bak);
}

// ====================================================================
// PLAYER.TSX
// ====================================================================
console.log('\n=== Patching ' + PLAYER + ' ===');

if (!fs.existsSync(PLAYER)) { bad('file not found'); process.exit(1); }
let player = fs.readFileSync(PLAYER, 'utf8');
const playerOrig = player;
backup(PLAYER);

// --- 1a: Add BackHandler to react-native imports (if missing)
{
  // Look for an `import { ... } from 'react-native'` block.
  // The block in this file is multi-line, so we match across newlines.
  const reRN = /import\s*\{([\s\S]*?)\}\s*from\s*['"]react-native['"]/m;
  const m = player.match(reRN);
  if (!m) {
    bad('could not locate `import { ... } from "react-native"` block');
  } else if (/\bBackHandler\b/.test(m[1])) {
    ok('BackHandler already imported from react-native');
  } else {
    // Insert "  BackHandler," right before the closing brace, preserving newline style.
    const inside = m[1];
    // Trim trailing whitespace/comma, then append on a new line.
    const trimmed = inside.replace(/[\s,]+$/, '');
    const newInside = trimmed + ',\n  BackHandler,\n';
    const replaced = player.replace(reRN, "import {" + newInside + "} from 'react-native'");
    if (replaced !== player) {
      player = replaced;
      ok('added BackHandler to react-native imports');
    } else {
      bad('failed to inject BackHandler import');
    }
  }
}

// --- 1b: Add the BackHandler effect right after `const router = useRouter();`
{
  const MARKER = 'BACK_BUTTON_INTERCEPTOR_V2';
  if (player.includes(MARKER)) {
    ok('back-button interceptor already installed');
  } else {
    const anchor = '  const router = useRouter();';
    if (!player.includes(anchor)) {
      bad('could not find `const router = useRouter();` anchor');
    } else {
      const effect = [
        '',
        '  // ============================================================',
        '  // ' + MARKER + ' (Stremio-style binge-stack killer)',
        '  // ONE hardware-back press from the player → land on the CURRENT',
        '  // episode\'s info page. Pops the entire stack of player+details',
        '  // entries that built up while binge-watching.',
        '  // ============================================================',
        '  useEffect(() => {',
        '    if (Platform.OS !== \'android\') return;',
        '    const onBackPress = () => {',
        '      try {',
        '        let target: string | null = null;',
        '        if (seriesId && season && episode) {',
        '          target = `/details/series/${seriesId}:${season}:${episode}`;',
        '        } else if (contentId) {',
        '          const cid = String(contentId);',
        '          const base = cid.includes(\':\') ? cid.split(\':\')[0] : cid;',
        '          target = `/details/${(contentType as string) || \'movie\'}/${base}`;',
        '        }',
        '        if (target) {',
        '          // Pop any stacked binge-watch screens, then land on episode info',
        '          try { (router as any).dismissAll && (router as any).dismissAll(); } catch (_) {}',
        '          router.replace(target as any);',
        '        } else {',
        '          router.back();',
        '        }',
        '      } catch (_) {',
        '        try { router.back(); } catch (__) {}',
        '      }',
        '      return true; // consume — prevent default OS pop',
        '    };',
        '    const sub = BackHandler.addEventListener(\'hardwareBackPress\', onBackPress);',
        '    return () => { try { sub.remove(); } catch (_) {} };',
        '  }, [seriesId, season, episode, contentId, contentType]);',
        '',
      ].join('\n');
      player = player.replace(anchor, anchor + '\n' + effect);
      ok('installed back-button interceptor after useRouter()');
    }
  }
}

// Save player.tsx
if (player !== playerOrig) {
  fs.writeFileSync(PLAYER, player, 'utf8');
  ok('saved ' + PLAYER);
} else {
  info('no changes needed to ' + PLAYER);
}

// ====================================================================
// DETAILS/[type]/[id].tsx
// ====================================================================
console.log('\n=== Patching ' + DETAILS + ' ===');

if (!fs.existsSync(DETAILS)) { bad('file not found'); process.exit(1); }
let details = fs.readFileSync(DETAILS, 'utf8');
const detailsOrig = details;
backup(DETAILS);

// --- 2: Fix nextEpisodeData → add nextEpisodePoster (player consumes that name)
{
  // Match the EXACT block from your dump.
  const oldBlock = [
    'const nextEpisodeData = nextEpisode ? {',
    '  nextEpisodeId: `${baseId}:${nextEpisode.season}:${nextEpisode.episode}`,',
    '  nextEpisodeTitle: `S${nextEpisode.season}E${nextEpisode.episode} - ${nextEpisode.name || \'Next Episode\'}`,',
    '  nextEpisodeBackdrop: nextEpisode.thumbnail || content?.background || \'\',',
    '} : {};',
  ].join('\n');

  const newBlock = [
    'const nextEpisodeData = nextEpisode ? {',
    '  nextEpisodeId: `${baseId}:${nextEpisode.season}:${nextEpisode.episode}`,',
    '  nextEpisodeTitle: `S${nextEpisode.season}E${nextEpisode.episode} - ${nextEpisode.name || \'Next Episode\'}`,',
    '  // PATCH v2: player.tsx consumes `nextEpisodePoster`, not `nextEpisodeBackdrop`.',
    '  // Send the EPISODE thumbnail so the Up Next overlay shows the right image.',
    '  nextEpisodePoster: nextEpisode.thumbnail || content?.background || \'\',',
    '  nextEpisodeBackdrop: nextEpisode.thumbnail || content?.background || \'\',',
    '} : {};',
  ].join('\n');

  if (details.includes(newBlock) || /nextEpisodePoster:\s*nextEpisode\.thumbnail/.test(details)) {
    ok('nextEpisodePoster field already present');
  } else if (details.includes(oldBlock)) {
    details = details.replace(oldBlock, newBlock);
    ok('added nextEpisodePoster field for player Up Next overlay');
  } else {
    bad('could not find nextEpisodeData block — leaving untouched');
  }
}

// --- 3: Auto-play overlay backdrop → prefer EPISODE thumbnail
//    Lines ~996-998 in your file. Match exactly with original whitespace.
{
  const oldBg = [
    "          {(content?.background || content?.poster || nextBackdropParam || nextPosterParam) && (",
    "            <RNImage",
    "              source={{ uri: (content?.background || nextBackdropParam || content?.poster || nextPosterParam) as string }}",
  ].join('\n');

  const newBg = [
    "          {/* PATCH v2: prefer EPISODE backdrop so transition into player loading is seamless */}",
    "          {(currentEpisode?.thumbnail || nextBackdropParam || content?.background || content?.poster || nextPosterParam) && (",
    "            <RNImage",
    "              source={{ uri: (currentEpisode?.thumbnail || nextBackdropParam || content?.background || content?.poster || nextPosterParam) as string }}",
  ].join('\n');

  if (details.includes(newBg) || /currentEpisode\?\.thumbnail \|\| nextBackdropParam/.test(details)) {
    ok('autoplay overlay already uses episode backdrop');
  } else if (details.includes(oldBg)) {
    details = details.replace(oldBg, newBg);
    ok('autoplay overlay now uses EPISODE backdrop (matches player loading)');
  } else {
    bad('could not find autoplay overlay backdrop block — leaving untouched');
  }
}

// Save details
if (details !== detailsOrig) {
  fs.writeFileSync(DETAILS, details, 'utf8');
  ok('saved ' + DETAILS);
} else {
  info('no changes needed to ' + DETAILS);
}

// ====================================================================
// SUMMARY
// ====================================================================
console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nSome patches failed. Don\'t worry — your originals are safe in the .bak files.');
  console.log('Paste this output back to me and I\'ll adapt the script to your exact text.');
  process.exit(1);
} else {
  console.log('\nAll patches applied. Now rebuild the APK and test:');
  console.log('  ✓ Binge-watch 3 episodes → ONE remote-back press → lands on CURRENT episode info');
  console.log('  ✓ Up Next overlay shows the upcoming episode\'s backdrop (not series poster)');
  console.log('  ✓ Auto-play loading uses the same backdrop the player will use → no flicker');
  console.log('\nIf any of these still look wrong, tell me which one and I\'ll iterate.');
}
