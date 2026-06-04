/*
 * apply_patches_v176d_library_add_payload.js
 *
 * V176D — Fix the "Add to Library" no-op bug.
 *
 *   Root cause: v176ShowLongPressMenu in ContentCard.tsx posts
 *   { content_id, content_type, name, poster } to /api/library,
 *   but server.py's LibraryItem expects { id, type, name, poster }
 *   (with optional imdb_id).  The mismatched field names cause a
 *   422 that the menu swallows, so the user sees nothing happen.
 *
 *   Idempotent.  CRLF preserved.
 *
 *   Usage (Windows CMD, from project root):
 *       node apply_patches_v176d_library_add_payload.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CC_PATH = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v176d] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v176d] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

const file = CC_PATH;
let src = read(file);

if (src.indexOf('V176D_LIBRARY_PAYLOAD') !== -1) {
  console.log('[v176d] ContentCard.tsx: already patched, skipping');
  console.log('[v176d] DONE.  0 change(s).');
  process.exit(0);
}

let changes = 0;

// The exact block written by v176 inside v176ShowLongPressMenu's Add branch.
const oldAddBlock =
  '      onPress: async () => {\n' +
  '        try {\n' +
  '          await (api as any).library.add({\n' +
  '            content_id: contentId,\n' +
  '            content_type: contentType,\n' +
  '            name: title,\n' +
  "            poster: (item as any).poster || '',\n" +
  '          });\n' +
  '        } catch (_) {}\n' +
  "        try { onAfterChange && onAfterChange('added'); } catch (_) {}\n" +
  '      },';

if (src.indexOf(oldAddBlock) === -1) {
  console.error('[v176d] FATAL: ContentCard.tsx — could not locate library.add payload block from v176.');
  process.exit(2);
}

const newAddBlock =
  '      onPress: async () => {\n' +
  '        /* V176D_LIBRARY_PAYLOAD — server LibraryItem schema is\n' +
  '           { id, type, name, poster, imdb_id? } NOT { content_id, content_type, ... }.\n' +
  '           The old payload silently 422-ed and the menu closed with no effect. */\n' +
  '        try {\n' +
  '          await (api as any).library.add({\n' +
  '            id: contentId,\n' +
  "            imdb_id: contentId && String(contentId).startsWith('tt') ? contentId : undefined,\n" +
  '            name: title,\n' +
  '            type: contentType,\n' +
  "            poster: (item as any).poster || '',\n" +
  '          });\n' +
  "          console.log('[V176D] library.add OK:', contentId);\n" +
  '        } catch (e) {\n' +
  "          console.log('[V176D] library.add FAILED:', e);\n" +
  '        }\n' +
  "        try { onAfterChange && onAfterChange('added'); } catch (_) {}\n" +
  '      },';

src = src.replace(oldAddBlock, newAddBlock);
changes++;

write(file, src);
console.log(`[v176d] ContentCard.tsx: ${changes} change(s) applied`);
console.log('[v176d] DONE.  Rebuild your Expo app and sideload to test Add to Library.');
