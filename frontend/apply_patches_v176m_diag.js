/*
 * apply_patches_v176m_diag.js
 *
 * V176M_DIAG — diagnostic-only patch to pinpoint why long-press stopped
 * doing anything after v176l shipped.  Touches ONLY ContentCard.tsx.
 *
 *   1) Insert a synchronous Alert.alert('LP fired …') at the top of
 *      handleLongPress.  If you SEE this popup on the TV when you hold
 *      OK on a poster, then:
 *         (a) native -> JS bridge is fine
 *         (b) focus-registration is fine
 *         (c) the dispatcher is calling the right function
 *      ... which means the ONLY remaining failure point is the
 *      <V176kPopover/> host being unmounted on Discover/Library/Search.
 *
 *   2) Insert ONE console.log in the dispatcher path that prints the
 *      state of both registration slots.  Fires only on long-press
 *      (not per-keystroke) so it cannot cause the v176f-era lag.
 *
 *   3) Insert ONE console.log inside handleFocus so we can see in the
 *      log when registration actually happens.
 *
 *   Idempotent.  CRLF preserved.  Pure JS — Metro reload OR rebuild.
 *   Diagnostic only -- v176n will remove these and apply the real fix.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CC_PATH = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');

let _eol = 'lf';
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v176m] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eol = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eol === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eol === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v176m] wrote ${path.relative(ROOT, p) || p} (${_eol.toUpperCase()})`);
}

let totalChanges = 0;
let src = read(CC_PATH);

if (src.indexOf('V176M_DIAG') !== -1) {
  console.log('[v176m] ContentCard.tsx: already patched, skipping');
  process.exit(0);
}

// ─── 1) Alert.alert at top of handleLongPress ────────────────────────────
//     We anchor on the exact opening line that v176k introduced so we
//     don't have to reflow the rest of the function.
const lpAnchor =
  '  const handleLongPress = useCallback(async () => {\n' +
  '    /* V176K_POPOVER — measure poster so the popover anchors from its\n' +
  '       corner instead of the centered fallback. */';
const lpInsert =
  '  const handleLongPress = useCallback(async () => {\n' +
  '    /* V176M_DIAG — synchronous popup so we can SEE that handleLongPress\n' +
  '       actually ran on the device.  If this Alert appears but no Stremio\n' +
  '       popover follows, the dispatch chain is fine and the missing piece\n' +
  '       is the <V176kPopover/> host being unmounted on this screen. */\n' +
  "    try { Alert.alert('LP fired', String((item as any)?.name || (item as any)?.title || 'unknown')); } catch (_) {}\n" +
  '    /* V176K_POPOVER — measure poster so the popover anchors from its\n' +
  '       corner instead of the centered fallback. */';
if (src.indexOf(lpAnchor) !== -1) {
  src = src.replace(lpAnchor, lpInsert);
  totalChanges++;
  console.log('[v176m] inserted Alert.alert at top of handleLongPress');
} else {
  console.log('[v176m] WARN: could not locate handleLongPress anchor; skipped Alert insert.');
}

// ─── 2) Diagnostic console.log inside the dispatcher ─────────────────────
const dispAnchor =
  "    if (evt && evt.eventType === 'longSelect') {\n" +
  '      /* V176I_REF_DISPATCH — prefer the getter; falls back to the\n' +
  '         legacy slot for any callers that still set it directly. */\n' +
  '      let target: (() => void) | null = null;\n' +
  '      try { if (_v176iLatestGetter) target = _v176iLatestGetter(); } catch (_) {}\n' +
  '      if (!target) target = _v173FocusedLP;';
const dispInsert =
  "    if (evt && evt.eventType === 'longSelect') {\n" +
  '      /* V176M_DIAG — single log per long-press (NOT per keypress) so\n' +
  '         we can confirm in logcat that the JS bridge received the event\n' +
  '         and see whether registration was active at fire-time. */\n' +
  "      try { console.log('[V176M] longSelect rx getter=' + !!_v176iLatestGetter + ' legacy=' + !!_v173FocusedLP); } catch (_) {}\n" +
  '      /* V176I_REF_DISPATCH — prefer the getter; falls back to the\n' +
  '         legacy slot for any callers that still set it directly. */\n' +
  '      let target: (() => void) | null = null;\n' +
  '      try { if (_v176iLatestGetter) target = _v176iLatestGetter(); } catch (_) {}\n' +
  '      if (!target) target = _v173FocusedLP;';
if (src.indexOf(dispAnchor) !== -1) {
  src = src.replace(dispAnchor, dispInsert);
  totalChanges++;
  console.log('[v176m] inserted dispatcher diagnostic log');
} else {
  console.log('[v176m] WARN: could not locate dispatcher anchor; skipped dispatcher log insert.');
}

// ─── 3) Diagnostic console.log inside handleFocus registration ───────────
const focusAnchor =
  '    /* V173_TV_LONGPRESS_REGISTRY — register this card\'s long-press\n' +
  "       handler so the global 'longSelect' listener can fire it. */\n" +
  '    /* V176I_REF_DISPATCH — register a getter, not the closure itself. */\n' +
  '    try { v176iRegisterGetter(() => _v176iLpRef.current); } catch (_) {}\n' +
  '    try { v173RegisterLongPress(handleLongPress); } catch (_) {}';
const focusInsert =
  '    /* V173_TV_LONGPRESS_REGISTRY — register this card\'s long-press\n' +
  "       handler so the global 'longSelect' listener can fire it. */\n" +
  '    /* V176I_REF_DISPATCH — register a getter, not the closure itself. */\n' +
  '    try { v176iRegisterGetter(() => _v176iLpRef.current); } catch (_) {}\n' +
  '    try { v173RegisterLongPress(handleLongPress); } catch (_) {}\n' +
  '    /* V176M_DIAG — confirm registration happened on this focus. */\n' +
  "    try { console.log('[V176M] focus reg id=' + String((item as any)?.imdb_id || (item as any)?.id || '?')); } catch (_) {}";
if (src.indexOf(focusAnchor) !== -1) {
  src = src.replace(focusAnchor, focusInsert);
  totalChanges++;
  console.log('[v176m] inserted focus-registration diagnostic log');
} else {
  console.log('[v176m] WARN: could not locate handleFocus anchor; skipped focus log insert.');
}

if (totalChanges > 0) {
  // Tag the file so the idempotency guard at the top catches a re-run.
  src = src.replace(
    '/* V176L_PERF_CLEANUP marker */',
    '/* V176L_PERF_CLEANUP marker */\n  /* V176M_DIAG marker */'
  );
  write(CC_PATH, src);
  console.log(`[v176m] DONE. ${totalChanges} change(s) applied.`);
  console.log('[v176m] Next: cold-start the app, hold OK on a poster, watch for:');
  console.log('         (a) "LP fired" Alert popup on the TV screen');
  console.log('         (b) [V176M] lines in logcat');
} else {
  console.log('[v176m] nothing to change — anchors not found.  Are you on a v176l ContentCard.tsx?');
}
