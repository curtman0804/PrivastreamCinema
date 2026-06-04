/*
 * apply_patches_v176h2_episode_focus_merge.js
 *
 * V176H2 — Tiny surgical fix for the only remaining episode-menu bug:
 *
 *   EpisodeCard.tsx today has TWO onFocus and TWO onBlur props on the
 *   same Pressable.  React only keeps the LAST one, so:
 *     • The v173 _v173RegLP() registration on line 824 is silently
 *       dropped by the v135 focus-state onFocus on line 827.
 *     • Even if it WEREN'T dropped, the registration only fires when
 *       isWatched && onMarkUnwatched — meaning unwatched episodes
 *       never register a long-press handler, so even on touch the
 *       "Mark as Watched" path is unreachable via TV remote.
 *
 *   Fix: collapse to ONE onFocus + ONE onBlur that does both jobs,
 *   and always register _v176cOpenEpMenu (which already toggles
 *   mark/unmark internally based on watched state).
 *
 *   Idempotent.  CRLF preserved.
 *
 *   Usage (Windows CMD, from project root):
 *       node apply_patches_v176h2_episode_focus_merge.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const ID_PATH = path.join(ROOT, 'app', 'details', '[type]', '[id].tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v176h2] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v176h2] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

const file = ID_PATH;
let src = read(file);

if (src.indexOf('V176H2_EPISODE_FOCUS_MERGE') !== -1) {
  console.log('[v176h2] details/[type]/[id].tsx: already patched, skipping');
  console.log('[v176h2] DONE.  0 change(s).');
  process.exit(0);
}

// Match the EXACT current duplicate-onFocus/onBlur block.
const oldBlock =
  '      /* V173_TV_LONGPRESS_EPISODE — register the mark-unwatched callback\n' +
  '         while this card is focused so the TV \'longSelect\' dispatcher in\n' +
  '         ContentCard.tsx can fire it.  Skips when nothing to unmark. */\n' +
  '      onFocus={() => { try { _v173RegLP(isWatched && typeof onMarkUnwatched === \'function\' ? onMarkUnwatched : null); } catch (_) {} if (autoFocus) { /* preserve any existing autoFocus behaviour */ } }}\n' +
  '      onBlur={() => { try { _v173RegLP(null); } catch (_) {} }}\n' +
  '      /* v135-focus-unlock-blur */\n' +
  '      onFocus={() => {\n' +
  '        setIsFocused(true);\n' +
  '        hasFocusedRef.current = true;\n' +
  '        focusGrabbedOnceRef.current = true;\n' +
  "        console.log('[FOCUS v135] onFocus ep=' + episode.episode + ' (one-shot guard set)');\n" +
  '      }}\n' +
  '      onBlur={() => {\n' +
  '        setIsFocused(false);\n' +
  '        if (hasFocusedRef.current) {\n' +
  '          userMovedRef.current = true;\n' +
  "          console.log('[FOCUS v135] onBlur ep=' + episode.episode + ' (userMoved=true)');\n" +
  '        }\n' +
  '      }}';

if (src.indexOf(oldBlock) === -1) {
  console.error('[v176h2] FATAL: id.tsx — could not locate the duplicate onFocus/onBlur block.');
  console.error('  This patch expects the v176c-applied EpisodeCard layout.');
  process.exit(2);
}

const newBlock =
  '      /* V176H2_EPISODE_FOCUS_MERGE — ONE merged onFocus that does BOTH\n' +
  '         the v135 focus-state bookkeeping AND the v173 long-press\n' +
  '         registration.  The previous build had TWO onFocus props on the\n' +
  '         same Pressable, so React dropped the v173 registration and\n' +
  '         TV remote OK long-press never reached this card.  Now unified.\n' +
  '         Also always registers (no isWatched guard) so unwatched episodes\n' +
  '         can be marked watched. */\n' +
  '      onFocus={() => {\n' +
  '        setIsFocused(true);\n' +
  '        hasFocusedRef.current = true;\n' +
  '        focusGrabbedOnceRef.current = true;\n' +
  "        console.log('[FOCUS v135] onFocus ep=' + episode.episode + ' (one-shot guard set)');\n" +
  '        try { _v173RegLP(_v176cOpenEpMenu); } catch (_) {}\n' +
  '      }}\n' +
  '      onBlur={() => {\n' +
  '        setIsFocused(false);\n' +
  '        if (hasFocusedRef.current) {\n' +
  '          userMovedRef.current = true;\n' +
  "          console.log('[FOCUS v135] onBlur ep=' + episode.episode + ' (userMoved=true)');\n" +
  '        }\n' +
  '        try { _v173RegLP(null); } catch (_) {}\n' +
  '      }}';

src = src.replace(oldBlock, newBlock);

write(file, src);
console.log('[v176h2] details/[type]/[id].tsx: 1 change applied');
console.log('');
console.log('[v176h2] DONE.  Pure JS change — Metro reload or rebuild + sideload.');
console.log('');
console.log('Verify on Firestick / Google TV:');
console.log('  Series detail → focus any episode poster → press OK and HOLD');
console.log('  → menu pops with "Mark as Watched" (or "Mark as Unwatched"');
console.log('     if the gold check is already on it).');
