// diag_v124r_autoplay.js
// Dumps the autoplay-related code in app/player.tsx so we can write a
// real fix that loads the next episode inline instead of navigating to
// the details page and back. Read-only - no edits.

const fs = require('fs');
const path = require('path');

const PLAYER = path.join('app', 'player.tsx');
if (!fs.existsSync(PLAYER)) { console.error('cannot find ' + PLAYER); process.exit(1); }
const src = fs.readFileSync(PLAYER, 'utf8');
const lines = src.split('\n');

function dump(label, regex, ctxBefore, ctxAfter) {
  console.log('\n========== ' + label + ' ==========');
  const seen = new Set();
  lines.forEach((line, i) => {
    if (!regex.test(line)) return;
    const a = Math.max(0, i - ctxBefore);
    const b = Math.min(lines.length, i + ctxAfter);
    const key = `${a}-${b}`;
    if (seen.has(key)) return;
    seen.add(key);
    console.log('--- ' + label + ' hit at line ' + (i + 1) + ' ---');
    for (let j = a; j < b; j++) console.log(String(j + 1).padStart(4) + ': ' + lines[j]);
    console.log('');
  });
}

dump('autoplay nav targets',     /router\.(push|replace).*details\/series/i, 6, 18);
dump('nextEpisode references',   /nextEpisode/i, 4, 10);
dump('autoplay var usage',       /\bautoPlay\b|autoplay/i, 3, 8);
dump('play button onPress',      /onPress=\{.*[Pp]lay/i, 3, 12);
dump('video source / streamUrl', /streamUrl|videoSource|setSource|loadAsync|playFromUrl/i, 3, 10);

console.log('\n========== Markers / patch state ==========');
['v121', 'v122', 'v123', 'v124b', 'v124d', 'v124e', 'v124f', 'v124g', 'v124p', 'v124q'].forEach(m => {
  console.log('  ' + m + ': ' + src.includes(m));
});
console.log('[diag_v124r] done.');
