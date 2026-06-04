/*
 * apply_patches_v172b_checkmark_gold.js
 *
 * V172B — Make ContentCard's watched checkmark visually identical to
 *         EpisodeCard's (gold, not green).
 *
 * EpisodeCard reference (id.tsx ~line 770):
 *     <View style={styles.watchedBadge}>
 *       <Ionicons name="checkmark" size={14} color="#B8A05C" />
 *     </View>
 *   styles.watchedBadge: 24x24 round dark circle, centered.
 *
 * ContentCard before v172b:
 *     <Ionicons name="checkmark-circle" size={18} color="#4CAF50" />  // green
 *     watchedBadge container: borderRadius 10 + padding 1.
 *
 * This patch updates the icon (name/size/color) AND the container
 * styling to match EpisodeCard exactly so the checkmark looks identical
 * everywhere.
 *
 * Idempotent.  Re-runs are a no-op once V172B_GOLD_CHECKMARK marker is
 * present.
 *
 *   Usage (Windows CMD, from project root):
 *       node apply_patches_v172b_checkmark_gold.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CC_PATH = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v172b] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v172b] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

const file = CC_PATH;
let src = read(file);

if (src.indexOf('V172B_GOLD_CHECKMARK') !== -1) {
  console.log('[v172b] ContentCard.tsx: already patched (V172B marker present), skipping');
  process.exit(0);
}

let changes = 0;

// ─────────────────────────────────────────────────────────────────────────────
//  1) Swap the icon to match EpisodeCard: name=checkmark, size=14, gold.
// ─────────────────────────────────────────────────────────────────────────────
const oldIcon =
  '          <View style={styles.watchedBadge}>\n' +
  '            <Ionicons\n' +
  '              name="checkmark-circle"\n' +
  '              size={18}\n' +
  '              color="#4CAF50"\n' +
  '            />\n' +
  '          </View>';
const newIcon =
  '          <View style={styles.watchedBadge}>\n' +
  '            {/* V172B_GOLD_CHECKMARK — match EpisodeCard\'s gold checkmark exactly */}\n' +
  '            <Ionicons\n' +
  '              name="checkmark"\n' +
  '              size={14}\n' +
  '              color="#B8A05C"\n' +
  '            />\n' +
  '          </View>';
if (src.indexOf(oldIcon) === -1) {
  console.error('[v172b] FATAL: ContentCard.tsx — could not locate the green checkmark-circle Ionicons.');
  process.exit(2);
}
src = src.replace(oldIcon, newIcon);
changes++;

// ─────────────────────────────────────────────────────────────────────────────
//  2) Update styles.watchedBadge container to match EpisodeCard (24x24 round
//     dark circle, centered).
// ─────────────────────────────────────────────────────────────────────────────
const oldStyle =
  '  watchedBadge: {\n' +
  '    position: \'absolute\',\n' +
  '    top: 6,\n' +
  '    left: 6,\n' +
  '    backgroundColor: \'rgba(0,0,0,0.6)\',\n' +
  '    borderRadius: 10,\n' +
  '    padding: 1,\n' +
  '  },';
const newStyle =
  '  /* V172B_GOLD_CHECKMARK — mirror EpisodeCard\'s 24x24 round badge */\n' +
  '  watchedBadge: {\n' +
  '    position: \'absolute\',\n' +
  '    top: 4,\n' +
  '    left: 4,\n' +
  '    backgroundColor: \'rgba(0, 0, 0, 0.7)\',\n' +
  '    borderRadius: 12,\n' +
  '    width: 24,\n' +
  '    height: 24,\n' +
  '    alignItems: \'center\',\n' +
  '    justifyContent: \'center\',\n' +
  '    zIndex: 10,\n' +
  '  },';
if (src.indexOf(oldStyle) === -1) {
  console.error('[v172b] FATAL: ContentCard.tsx — could not locate watchedBadge style.');
  process.exit(3);
}
src = src.replace(oldStyle, newStyle);
changes++;

write(file, src);
console.log(`[v172b] ContentCard.tsx: ${changes} change(s) applied`);
console.log('[v172b] DONE.  Rebuild your Expo app and sideload to test.');
