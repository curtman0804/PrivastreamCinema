/* eslint-disable */
// diagnose_autoplay.js — READ-ONLY. Find the auto-pick + nav-to-player logic.
//
// Goal: locate the exact code paths so V31 can:
//   - Improve auto-pick (prefer Premiumize cached HTTPS, then quality)
//   - Fall back to top raw torrent if no cached after ~2 s
//   - Pass a direct HTTPS URL so player.tsx can skip torrent setup
//
// Run from project root:  node diagnose_autoplay.js > diag_v31.txt
// Then paste diag_v31.txt back.

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');
const PLAYER  = path.join('frontend', 'app', 'player.tsx');
const STORE   = path.join('frontend', 'src', 'store', 'contentStore.ts');

function header(t) {
  console.log('\n' + '='.repeat(70));
  console.log('  ' + t);
  console.log('='.repeat(70));
}

function readFileSafe(p) {
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function printMatches(label, src, regex, before, after) {
  const lines = src.split(/\r?\n/);
  const found = [];
  for (let i = 0; i < lines.length; i++) if (regex.test(lines[i])) found.push(i);
  console.log('\n  -- ' + label + ' (' + found.length + ' match' + (found.length === 1 ? '' : 'es') + ') --');
  if (found.length === 0) { console.log('    (none)'); return; }
  // cap output to avoid huge dumps
  const MAX = 12;
  const shown = found.slice(0, MAX);
  for (const i of shown) {
    const a = Math.max(0, i - before);
    const b = Math.min(lines.length - 1, i + after);
    console.log('    [L' + (i + 1) + ']');
    for (let k = a; k <= b; k++) {
      const mark = (k === i) ? ' >> ' : '    ';
      console.log('    L' + (k + 1).toString().padStart(4) + mark + lines[k]);
    }
    console.log('    ----');
  }
  if (found.length > MAX) console.log('    ... (' + (found.length - MAX) + ' more match(es) suppressed)');
}

console.log('# diagnose_autoplay.js — read-only');
console.log('# generated: ' + new Date().toISOString());

const details = readFileSafe(DETAILS);
const player  = readFileSafe(PLAYER);
const store   = readFileSafe(STORE);

// =====================================================================
header('details/[type]/[id].tsx — Play button + auto-pick + nav-to-player');
if (!details) { console.log('  [MISSING]'); }
else {
  // ANY navigation reference to /player (not just router.push)
  printMatches('any literal mention of /player or "player" pathname', details,
    /['"`]\/?player['"`]|pathname\s*:\s*['"`][^'"`]*player|navigate\s*\(\s*['"`]\/?player|to\s*=\s*['"`]\/?player/, 1, 5);

  // any router.* call (push, replace, navigate, etc.)
  printMatches('any router.<verb>( call', details,
    /\brouter\.(push|replace|navigate|dismiss|back)\s*\(/, 0, 4);

  // Anything that looks like an auto-play trigger
  printMatches('autoplay / playStream / handlePlay / startStream / onPlay / playFirst', details,
    /\b(autoPlay|autoplay|playStream|handlePlay|onPlay|startStream|playFirst|playBest|playTopStream|launchPlayer|openPlayer|navigateToPlayer)\b/, 1, 5);

  // The Play button JSX (TouchableOpacity / Pressable with "Play")
  printMatches('Play button JSX (Pressable/TouchableOpacity ... "Play")', details,
    /(Pressable|TouchableOpacity|Button)[\s\S]?.*onPress|>\s*Play\s*</, 0, 2);

  // onPress handlers — short list to spot the play one
  printMatches('onPress= handlers', details, /\bonPress\s*=\s*[{(]/, 0, 3);

  // Where streams get sorted / filtered / ranked
  printMatches('stream sort / rank / filter', details,
    /\.(sort|filter|find|reduce)\s*\(\s*\(?[a-zA-Z_$][a-zA-Z0-9_$]*\s*[,)=]/, 0, 5);

  // Anything that mentions premiumize / debrid / cached / direct
  printMatches('debrid / premiumize / cached / direct HTTPS hints', details,
    /(premiumize|debrid|cached|direct|isCached|isDirect|hasDebrid|debridCached)/i, 0, 2);

  // Stream URL extraction (where the actual url is read)
  printMatches('stream.url / stream.streamUrl / stream.behaviorHints', details,
    /stream(\?)?\.(url|streamUrl|behaviorHints|infoHash|magnet)/, 0, 1);
}

// =====================================================================
header('player.tsx — does it always init the torrent stack, or only for magnets?');
if (!player) { console.log('  [MISSING]'); }
else {
  // Anything that decides between HTTPS direct vs torrent
  printMatches('http(s) URL detection / startsWith("http")', player,
    /startsWith\s*\(\s*['"`]https?|isHttps|isDirect|isMagnet|startsWith\s*\(\s*['"`]magnet/, 0, 3);

  // Torrent server / addTorrent / magnet handling
  printMatches('torrent server init / addTorrent / streamFromTorrent', player,
    /(torrentServer|addTorrent|startTorrent|streamFromTorrent|TorrentClient|torrentUrl|fallbackTorrents)/, 0, 2);

  // First few lines of the body — show how streamUrl gets set
  printMatches('initial setStreamUrl / from param', player,
    /setStreamUrl\s*\(/, 0, 2);

  // Where directUrl param is used
  printMatches('directUrl param usage', player,
    /\bdirectUrl\b/, 0, 1);
}

// =====================================================================
header('contentStore.ts — Stream type shape (what fields can we filter on?)');
if (!store) { console.log('  [MISSING]'); }
else {
  // Show the Stream interface / type
  printMatches('Stream interface / type', store,
    /(interface\s+Stream\b|type\s+Stream\s*=)/, 0, 25);

  // sortStreams or similar
  printMatches('sortStreams / rankStreams in store', store,
    /(sortStream|rankStream|pickBest|filterCached|isCached)/, 0, 3);
}

// =====================================================================
header('SUMMARY for V31');
console.log('  After you paste this back, V31 will:');
console.log('   1. Add a helper `pickBestStream(streams)` that prefers:');
console.log('         a) Premiumize cached HTTPS (direct)');
console.log('         b) within that, 1080p > 720p > 4K > other (Firestick-safe)');
console.log('         c) tie-break by smallest reasonable file size (faster to start)');
console.log('         d) if NO cached after 2 s, fall back to highest-seed raw torrent');
console.log('   2. Have the Play button call pickBestStream() with that 2 s window');
console.log('      instead of grabbing whatever\'s at index 0.');
console.log('   3. Pass a `directUrl` param to player when the pick is HTTPS,');
console.log('      so player.tsx can skip torrent setup entirely.');
console.log('\n# done.');
