/*
 * apply_patches_v176o_close_broadcast.js
 *
 * V176O — Broadcast close so multiple V176kPopover instances dismiss in sync.
 *
 * Repro: long-press an episode card while Discover is still mounted in the
 * background — TWO Modals are listening to 'v176k:open', so two open at
 * once.  Selecting an action calls a LOCAL setOpen(false), only the topmost
 * closes, and back must be pressed once per remaining Modal.
 *
 * V176kPopover already has a 'v176k:close' listener (calls setOpen(false))
 * but nothing ever emits it.  This patch emits 'v176k:close' inside:
 *   1) runAction          (when an action button is selected)
 *   2) dismiss            (backdrop tap and Android back via onRequestClose)
 *
 * Net effect: action select / backdrop tap / system back all close every
 * mounted instance in one frame.
 *
 *   Idempotent.  CRLF preserved.  Pure JS — Metro reload OR rebuild.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CC_PATH = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');

let _eol = 'lf';
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v176o] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eol = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eol === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eol === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v176o] wrote ${path.relative(ROOT, p) || p} (${_eol.toUpperCase()})`);
}

let src = read(CC_PATH);

if (src.indexOf('V176O_CLOSE_BROADCAST') !== -1) {
  console.log('[v176o] ContentCard.tsx: already patched, skipping');
  process.exit(0);
}

let changes = 0;

// ─── 1) dismiss → broadcast close to every mounted host ──────────────────
const oldDismiss = '  const dismiss = useCallback(() => setOpen(false), []);';
const newDismiss =
  '  /* V176O_CLOSE_BROADCAST — emit instead of local-only setOpen.\n' +
  '     Every mounted V176kPopover listens for v176k:close, so this dismisses\n' +
  '     ALL instances (handles the case where Discover ContentCard\'s singleton\n' +
  '     host AND a details-screen-mounted V176kPopover are both open). */\n' +
  '  const dismiss = useCallback(() => {\n' +
  "    try { DeviceEventEmitter.emit('v176k:close'); } catch (_) {}\n" +
  '    setOpen(false);\n' +
  '  }, []);';
if (src.indexOf(oldDismiss) !== -1) {
  src = src.replace(oldDismiss, newDismiss);
  changes++;
  console.log('[v176o] dismiss now broadcasts v176k:close');
} else {
  console.log('[v176o] WARN: dismiss anchor not found.');
}

// ─── 2) runAction → broadcast close before firing the action ─────────────
const oldRunAction =
  '  const runAction = useCallback((a: V176kAction) => {\n' +
  '    setOpen(false);\n' +
  '    // Delay slightly so the close animation can start before the action\n' +
  '    // triggers anything heavy (e.g. fetchLibrary).\n' +
  "    setTimeout(() => { try { a.onPress(); } catch (e) { console.log('[V176K] action error:', e); } }, 50);\n" +
  '  }, []);';
const newRunAction =
  '  const runAction = useCallback((a: V176kAction) => {\n' +
  '    /* V176O_CLOSE_BROADCAST — broadcast so every mounted popover instance\n' +
  '       (not just the topmost) closes on action select.  Without this, the\n' +
  '       user had to press back once per stacked Modal. */\n' +
  "    try { DeviceEventEmitter.emit('v176k:close'); } catch (_) {}\n" +
  '    setOpen(false);\n' +
  '    // Delay slightly so the close animation can start before the action\n' +
  '    // triggers anything heavy (e.g. fetchLibrary).\n' +
  "    setTimeout(() => { try { a.onPress(); } catch (e) { console.log('[V176K] action error:', e); } }, 50);\n" +
  '  }, []);';
if (src.indexOf(oldRunAction) !== -1) {
  src = src.replace(oldRunAction, newRunAction);
  changes++;
  console.log('[v176o] runAction now broadcasts v176k:close');
} else {
  console.log('[v176o] WARN: runAction anchor not found.');
}

if (changes > 0) {
  src = src.replace(
    '/* V176N_HOST_SINGLETON marker */',
    '/* V176N_HOST_SINGLETON marker */\n  /* V176O_CLOSE_BROADCAST marker */'
  );
  write(CC_PATH, src);
  console.log(`[v176o] DONE.  ${changes} change(s) applied.`);
} else {
  console.log('[v176o] nothing changed.');
}
