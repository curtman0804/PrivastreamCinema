/* eslint-disable */
// apply_patches_v165_search_keyboard_dismiss.js
//
// Free the user from the search keyboard.  On Firestick / Android TV
// the SearchBar's TextInput uses `blurOnSubmit={false}` AND never
// calls Keyboard.dismiss(), so pressing Search on the virtual
// keyboard does NOT close the IME.  While the IME is up it captures
// all D-pad input, so the user can't reach the result posters that
// appeared underneath.
//
// Fix (single file: src/components/SearchBar.tsx):
//   1) `blurOnSubmit={true}` so React Native blurs the input on
//      submit and the platform IME closes automatically.
//   2) Explicit `Keyboard.dismiss()` in handleSubmit for full belt-and-
//      braces coverage on both Android and Fire OS.
//   3) Import Keyboard from react-native.
//
// Idempotent.  CRLF-safe.
//
//   curl -L --fail -o apply_patches_v165.js "https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v165_search_keyboard_dismiss.js?v=1" && node apply_patches_v165.js
//
const fs = require('fs');
const path = require('path');

function find(rel) {
  const candidates = [
    path.join(process.cwd(), rel),
    path.join(process.cwd(), 'frontend', rel),
    path.join(process.cwd(), '..', 'frontend', rel),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

const sbPath = find(path.join('src', 'components', 'SearchBar.tsx'));
if (!sbPath) { console.error('[v165] FATAL: src/components/SearchBar.tsx not found'); process.exit(1); }

let src = fs.readFileSync(sbPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const bakPath = sbPath + '.bak_v165';
if (!fs.existsSync(bakPath)) fs.writeFileSync(bakPath, src, 'utf8');

const reports = [];
function applyOnce(label, marker, oldStr, newStr) {
  if (marker && src.indexOf(marker) !== -1) { reports.push({ label, status: 'SKIP_IDEMPOTENT' }); return; }
  const old2 = oldStr.replace(/\r?\n/g, NL);
  const new2 = newStr.replace(/\r?\n/g, NL);
  const occurrences = src.split(old2).length - 1;
  if (occurrences === 0) { reports.push({ label, status: 'NOT_FOUND' }); return; }
  if (occurrences > 1)  { reports.push({ label, status: 'AMBIGUOUS', count: occurrences }); return; }
  const before = src.length;
  src = src.replace(old2, new2);
  reports.push({ label, status: 'OK', delta: src.length - before });
}

// 1) Import Keyboard.
applyOnce(
  '1_import_keyboard',
  'V165_IMPORT_KEYBOARD',
  `import {
  View,
  TextInput,
  StyleSheet,
  Pressable,
  Platform,
} from 'react-native';`,
  `import {
  View,
  TextInput,
  StyleSheet,
  Pressable,
  Platform,
  Keyboard, /* V165_IMPORT_KEYBOARD */
} from 'react-native';`,
);

// 2) Dismiss the keyboard inside handleSubmit so D-pad reaches the
//    posters once the search runs.
applyOnce(
  '2_dismiss_on_submit',
  'V165_DISMISS_ON_SUBMIT',
  `  const handleSubmit = () => {
    if (query.trim()) onSearch(query.trim());
  };`,
  `  const handleSubmit = () => {
    if (query.trim()) onSearch(query.trim());
    /* V165_DISMISS_ON_SUBMIT — close the IME and blur the input so
       the D-pad reaches the result posters below. */
    try { Keyboard.dismiss(); } catch (_) {}
    try { inputRef.current?.blur && (inputRef.current as any).blur(); } catch (_) {}
  };`,
);

// 3) Flip blurOnSubmit so React Native itself closes the IME on Search.
applyOnce(
  '3_blur_on_submit_true',
  'V165_BLUR_ON_SUBMIT',
  `          blurOnSubmit={false}`,
  `          blurOnSubmit={true} /* V165_BLUR_ON_SUBMIT — was false, kept the IME glued open on TV */`,
);

if (src.length !== originalLen) {
  fs.writeFileSync(sbPath, src, 'utf8');
  console.log(`[v165] Wrote ${sbPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v165] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
