/* eslint-disable */
// apply_patches_v39.js — Defer details mount IO + kill discover LazyMount stagger
// Run from project root:   node apply_patches_v39.js
//
// THREE TARGETED CHANGES, TWO FILES:
//
// 1. details/[type]/[id].tsx L644 — defer loadContent()
//    BEFORE:   loadContent();
//    AFTER:    setTimeout(() => { try { loadContent(); } catch (_) {} }, 0);
//
// 2. details/[type]/[id].tsx L647 — defer fetchLibrary()
//    BEFORE:   fetchLibrary();
//    AFTER:    setTimeout(() => { try { fetchLibrary(); } catch (_) {} }, 0);
//
// 3. (tabs)/discover.tsx L362 — drop the LazyMount stagger
//    BEFORE:   <LazyMount key={serviceName} delay={(rowIdx++) * 60} ...
//    AFTER:    <LazyMount key={serviceName} delay={0}              ...
//
// Why these three:
//   - loadContent + fetchLibrary fire synchronously on details mount, fighting
//     the screen-slide animation. Same setTimeout(0) pattern as V37.
//   - The LazyMount stagger re-fires every time Discover re-attaches from blur
//     (because freezeOnBlur: true detaches it). Row 10 was waiting 600ms to
//     mount AGAIN after every back-from-details. FlatList virtualization
//     already handles non-visible row deferral, so the stagger is redundant
//     and actively harmful when navigating back to Discover.
//
// All idempotent (marker checks), CRLF preserved.

const fs = require('fs');
const path = require('path');

const DETAILS  = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');
const DISCOVER = path.join('frontend', 'app', '(tabs)', 'discover.tsx');

let totalPass = 0, totalFail = 0;

function patchFile(filePath, label, fn) {
  console.log('\n========================================');
  console.log('  ' + label);
  console.log('  ' + filePath);
  console.log('========================================');

  if (!fs.existsSync(filePath)) { console.log('  [FAIL] not found'); totalFail++; return; }

  let src = fs.readFileSync(filePath, 'utf8');
  const orig = src;
  const bak = filePath + '.bak.v39.' + Date.now();
  fs.copyFileSync(filePath, bak);
  console.log('  [info] backup → ' + bak);

  const hadCRLF = src.indexOf('\r\n') >= 0;
  if (hadCRLF) src = src.replace(/\r\n/g, '\n');
  console.log('  [info] eol: ' + (hadCRLF ? 'CRLF' : 'LF'));

  let pass = 0, fail = 0;
  const ok   = (m) => { pass++; console.log('  [OK]   ' + m); };
  const bad  = (m) => { fail++; console.log('  [FAIL] ' + m); };
  const info = (m) => console.log('  [info] ' + m);

  src = fn({ src, ok, bad, info }) || src;

  if (src !== orig && fail === 0) {
    fs.writeFileSync(filePath, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');
    ok('saved');
    totalPass += pass;
  } else if (fail > 0) {
    info('failed — file NOT saved (' + bak + ' has original)');
    totalFail += fail;
  } else {
    info('no changes needed (already at V39 state)');
    totalPass += pass;
  }
}

// ---------------------------------------------------------------------
// details/[type]/[id].tsx — defer loadContent + fetchLibrary
// ---------------------------------------------------------------------
patchFile(DETAILS, 'details — defer mount IO', ({ src, ok, bad, info }) => {
  const MARKER = 'PATCH_V39_DEFER_MOUNT_IO';
  if (src.includes(MARKER)) { ok('details V39 already applied'); return src; }

  // Each call should match exactly once (whole-line, indented).
  // Anchor 1: loadContent();
  const a1Re = /^(\s*)loadContent\(\);\s*$/m;
  const m1 = src.match(a1Re);
  if (!m1) { bad('could not find `loadContent();` anchor'); return src; }
  const occ1 = src.split(m1[0]).length - 1;
  if (occ1 > 1) { bad('loadContent(); matches ' + occ1 + ' times — refusing'); return src; }

  const replace1 =
    m1[1] + '// ' + MARKER + ' — defer meta fetch off the mount path\n' +
    m1[1] + 'setTimeout(() => { try { loadContent(); } catch (_) {} }, 0);';
  src = src.replace(m1[0], replace1);
  ok('deferred loadContent()');

  // Anchor 2: fetchLibrary();
  const a2Re = /^(\s*)fetchLibrary\(\);\s*$/m;
  const m2 = src.match(a2Re);
  if (!m2) { bad('could not find `fetchLibrary();` anchor'); return src; }
  // Note: fetchLibrary appears at line 647 inside the same useEffect. We only
  // patch the FIRST occurrence (mount-time). If it also appears in onRefresh
  // or elsewhere, those are user-triggered and should stay synchronous.
  const occ2 = src.split(m2[0]).length - 1;
  if (occ2 > 1) {
    info('fetchLibrary(); has ' + occ2 + ' occurrences — patching just the first (mount-time)');
  }

  const replace2 =
    m2[1] + '// ' + MARKER + ' — defer library fetch off the mount path\n' +
    m2[1] + 'setTimeout(() => { try { fetchLibrary(); } catch (_) {} }, 0);';
  // Replace only the first occurrence
  src = src.replace(m2[0], replace2);
  ok('deferred fetchLibrary() (mount-time call)');

  return src;
});

// ---------------------------------------------------------------------
// (tabs)/discover.tsx — kill LazyMount stagger
// ---------------------------------------------------------------------
patchFile(DISCOVER, 'discover — drop LazyMount stagger', ({ src, ok, bad, info }) => {
  const MARKER = 'PATCH_V39_NO_STAGGER';
  if (src.includes(MARKER)) { ok('discover V39 already applied'); return src; }

  // Anchor: `delay={(rowIdx++) * 60}` in the LazyMount JSX
  const anchor = "delay={(rowIdx++) * 60}";
  const occ = src.split(anchor).length - 1;
  if (occ === 0) { bad('could not find `delay={(rowIdx++) * 60}` anchor'); return src; }
  if (occ > 1)  { bad('anchor matches ' + occ + ' times'); return src; }

  // Replace with delay={0} and tag with marker comment for later audits.
  src = src.replace(anchor, "delay={0} /* " + MARKER + " — no stagger; FlatList handles deferral */");
  ok('LazyMount stagger removed');

  return src;
});

// =====================================================================
console.log('\n========================================');
console.log('  TOTAL: ' + totalPass + ' passed   ' + totalFail + ' failed');
console.log('========================================');

if (totalFail > 0) {
  console.log('\nSome sections failed. Originals safe in .bak.v39.* files.');
  process.exit(1);
} else {
  console.log('\nV39 done. Rebuild and test on Firestick:');
  console.log('  ✓ Poster → details: appears INSTANTLY (no frozen beat)');
  console.log('  ✓ Back → Discover: returns instantly (no row-by-row re-stagger)');
  console.log('  ✓ D-pad on Discover after back: smooth from frame 1');
  console.log('  ✓ Streams still load progressively in the details page');
  console.log('\nCommit when verified:');
  console.log('  git add -A');
  console.log('  git commit -m "perf: V39 — defer details mount IO + kill LazyMount stagger"');
}
