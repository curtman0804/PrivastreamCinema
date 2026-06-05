/*
 * apply_patches_v176p_remove_x_button.js
 *
 * V176P — Remove the close-button (X) overlay from Library cards and
 *         Continue Watching items.  The long-press popover menu now
 *         handles both "Remove from Library" and "Clear Progress", so
 *         the redundant X is just visual noise.
 *
 *   Changes (both files):
 *     1) Remove the X-row <View>...</View> block above the poster.
 *     2) Drop `marginTop: -xRowHeight` from the poster Pressable style
 *        (no more X row to overlap).
 *     3) Drop `nextFocusUp={xButtonTag}` from the poster Pressable
 *        (target no longer exists).
 *
 *   Dead variables (xButtonRef, xButtonTag, xFocused, setXFocused,
 *   xButtonSize, xRowHeight, handleXFocus) are left in place — they
 *   are simply unused now.  Removing them surgically would risk
 *   breaking subtle dependencies (e.g. references in style objects).
 *   They compile fine as unused locals.
 *
 *   Idempotent.  CRLF preserved.  Pure JS — Metro reload OR rebuild.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DISC_PATH = path.join(ROOT, 'app', '(tabs)', 'discover.tsx');
const LIB_PATH  = path.join(ROOT, 'app', '(tabs)', 'library.tsx');

const _eol = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v176p] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eol[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eol[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eol[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v176p] wrote ${path.relative(ROOT, p) || p} (${_eol[p].toUpperCase()})`);
}

let total = 0;

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 1 — app/(tabs)/discover.tsx  (ContinueWatchingItem)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = DISC_PATH;
  let src = read(file);

  if (src.indexOf('V176P_X_REMOVED') !== -1) {
    console.log('[v176p] discover.tsx: already patched, skipping');
  } else {
    let changes = 0;

    // 1) Remove the X button row JSX block.
    const xBlock =
      '      {/* X button row - in normal flow ABOVE poster, right-aligned, overlaps via negative margin */}\n' +
      '      <View style={[styles.xButtonRow, { paddingTop: 8 }]}>\n' +
      '        <Pressable\n' +
      '          ref={xButtonRef}\n' +
      '          onPress={onRemove}\n' +
      '          onFocus={handleXFocus}\n' +
      '          onBlur={() => setXFocused(false)}\n' +
      '          accessible={true}\n' +
      '          accessibilityRole="button"\n' +
      '          accessibilityLabel={`Remove ${item.title} from Continue Watching`}\n' +
      '          android_ripple={null}\n' +
      '          nextFocusDown={posterTag}\n' +
      '          style={[\n' +
      '            styles.removeButtonOverlay,\n' +
      '            { width: xButtonSize, height: xButtonSize, borderRadius: xButtonSize / 2 },\n' +
      '            xFocused && styles.removeButtonOverlayFocused,\n' +
      '          ]}\n' +
      '        >\n' +
      '          <Ionicons\n' +
      '            name="close"\n' +
      '            size={isTV ? 16 : 12}\n' +
      '            color={xFocused ? \'#fff\' : \'rgba(255,255,255,0.9)\'}\n' +
      '          />\n' +
      '        </Pressable>\n' +
      '      </View>\n\n';
    if (src.indexOf(xBlock) !== -1) {
      src = src.replace(xBlock, '      {/* V176P_X_REMOVED — X overlay removed; use long-press menu. */}\n');
      changes++;
      console.log('[v176p] discover.tsx: removed X button row');
    } else {
      console.log('[v176p] WARN: discover.tsx X-block anchor not found.');
    }

    // 2) Drop `marginTop: -xRowHeight` from the poster Pressable style.
    const oldMargin =
      '        style={[\n' +
      '          styles.continueImageWrapper,\n' +
      '          { marginTop: -xRowHeight },\n' +
      '          isFocused && styles.continueImageWrapperFocused,\n' +
      '        ]}';
    const newMargin =
      '        style={[\n' +
      '          styles.continueImageWrapper,\n' +
      '          /* V176P_X_REMOVED — no more X row to overlap. */\n' +
      '          isFocused && styles.continueImageWrapperFocused,\n' +
      '        ]}';
    if (src.indexOf(oldMargin) !== -1) {
      src = src.replace(oldMargin, newMargin);
      changes++;
      console.log('[v176p] discover.tsx: dropped negative marginTop');
    } else {
      console.log('[v176p] WARN: discover.tsx margin anchor not found.');
    }

    // 3) Drop `nextFocusUp={xButtonTag}` from the poster Pressable.
    const oldFocusUp =
      '        android_ripple={null}\n' +
      '        nextFocusUp={xButtonTag}\n' +
      '        style={[\n' +
      '          styles.continueImageWrapper,';
    const newFocusUp =
      '        android_ripple={null}\n' +
      '        /* V176P_X_REMOVED — nextFocusUp target gone. */\n' +
      '        style={[\n' +
      '          styles.continueImageWrapper,';
    if (src.indexOf(oldFocusUp) !== -1) {
      src = src.replace(oldFocusUp, newFocusUp);
      changes++;
      console.log('[v176p] discover.tsx: dropped nextFocusUp={xButtonTag}');
    } else {
      console.log('[v176p] WARN: discover.tsx nextFocusUp anchor not found.');
    }

    if (changes > 0) {
      write(file, src);
      console.log(`[v176p] discover.tsx: ${changes} change(s) applied`);
      total += changes;
    } else {
      console.log('[v176p] discover.tsx: nothing to change');
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 2 — app/(tabs)/library.tsx  (LibraryCard)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = LIB_PATH;
  let src = read(file);

  if (src.indexOf('V176P_X_REMOVED') !== -1) {
    console.log('[v176p] library.tsx: already patched, skipping');
  } else {
    let changes = 0;

    // 1) Remove the X button row JSX block.
    const xBlock =
      '      {/* X button row - in normal flow ABOVE poster, right-aligned, overlaps via negative margin */}\n' +
      '      <View style={[styles.xButtonRow, { paddingTop: 8 }]}>\n' +
      '        <Pressable\n' +
      '          ref={xButtonRef}\n' +
      '          onPress={onRemove}\n' +
      '          onFocus={handleXFocus}\n' +
      '          onBlur={() => setXFocused(false)}\n' +
      '          accessible={true}\n' +
      '          accessibilityRole="button"\n' +
      '          accessibilityLabel={`Remove ${item.name || item.title} from Library`}\n' +
      '          android_ripple={null}\n' +
      '          nextFocusDown={posterTag}\n' +
      '          style={[\n' +
      '            styles.removeButtonOverlay,\n' +
      '            { width: xButtonSize, height: xButtonSize, borderRadius: xButtonSize / 2 },\n' +
      '            xFocused && styles.removeButtonOverlayFocused,\n' +
      '          ]}\n' +
      '        >\n' +
      '          <Ionicons\n' +
      '            name="close"\n' +
      '            size={isTV ? 16 : 12}\n' +
      '            color={xFocused ? \'#fff\' : \'rgba(255,255,255,0.9)\'}\n' +
      '          />\n' +
      '        </Pressable>\n' +
      '      </View>\n\n';
    if (src.indexOf(xBlock) !== -1) {
      src = src.replace(xBlock, '      {/* V176P_X_REMOVED — X overlay removed; use long-press menu. */}\n');
      changes++;
      console.log('[v176p] library.tsx: removed X button row');
    } else {
      console.log('[v176p] WARN: library.tsx X-block anchor not found.');
    }

    // 2) Drop `marginTop: -xRowHeight` from the poster Pressable style.
    const oldMargin =
      '        style={[\n' +
      '          styles.posterContainer,\n' +
      '          { height: cardHeight, marginTop: -xRowHeight },\n' +
      '          isFocused && styles.posterFocused,\n' +
      '        ]}';
    const newMargin =
      '        style={[\n' +
      '          styles.posterContainer,\n' +
      '          /* V176P_X_REMOVED — no more X row to overlap. */\n' +
      '          { height: cardHeight },\n' +
      '          isFocused && styles.posterFocused,\n' +
      '        ]}';
    if (src.indexOf(oldMargin) !== -1) {
      src = src.replace(oldMargin, newMargin);
      changes++;
      console.log('[v176p] library.tsx: dropped negative marginTop');
    } else {
      console.log('[v176p] WARN: library.tsx margin anchor not found.');
    }

    // 3) Drop `nextFocusUp={xButtonTag}` from the poster Pressable.
    const oldFocusUp =
      '        android_ripple={null}\n' +
      '        nextFocusUp={xButtonTag}\n' +
      '        style={[\n' +
      '          styles.posterContainer,';
    const newFocusUp =
      '        android_ripple={null}\n' +
      '        /* V176P_X_REMOVED — nextFocusUp target gone. */\n' +
      '        style={[\n' +
      '          styles.posterContainer,';
    if (src.indexOf(oldFocusUp) !== -1) {
      src = src.replace(oldFocusUp, newFocusUp);
      changes++;
      console.log('[v176p] library.tsx: dropped nextFocusUp={xButtonTag}');
    } else {
      console.log('[v176p] WARN: library.tsx nextFocusUp anchor not found.');
    }

    if (changes > 0) {
      write(file, src);
      console.log(`[v176p] library.tsx: ${changes} change(s) applied`);
      total += changes;
    } else {
      console.log('[v176p] library.tsx: nothing to change');
    }
  }
}

console.log('');
console.log(`[v176p] DONE.  ${total} total change(s).  Pure JS — Metro reload OK.`);
