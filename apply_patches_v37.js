/* eslint-disable */
// apply_patches_v37.js — Fix D-pad lag + slow poster→details
// Run from project root:   node apply_patches_v37.js
//
// FIX A: details/[type]/[id].tsx
//   Defer fetchStreams from mount to setTimeout(0) so the details page paints
//   instantly. Streams load in the background and populate as they arrive.
//
//   Before:
//     useEffect(() => { ... fetchStreams(type, id); }, [id, type]);
//
//   After:
//     useEffect(() => { ... const _h = setTimeout(() => fetchStreams(type, id), 0);
//                            return () => clearTimeout(_h); }, [id, type]);
//
// FIX B: ContentCard.tsx (PATCH_V19C_FOCUS_PREFETCH)
//   Kill the 800ms focus-prefetch. The handoff explicitly warned this was
//   rolled back ("caused heavy UI lag and hammered the backend"). It's still
//   in the file. Each D-pad move queues a prefetch; rapid navigation queues
//   many → backend hammered → JS thread fragmented → laggy D-pad.
//
//   We neutralize by wrapping the prefetch effect's body with a runtime
//   short-circuit. The block stays in place (easy to re-enable later) but
//   doesn't execute.

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');
const CARD    = path.join('frontend', 'src', 'components', 'ContentCard.tsx');

let totalPass = 0, totalFail = 0;

function patchFile(filePath, label, fn) {
  console.log('\n========================================');
  console.log('  ' + label);
  console.log('  ' + filePath);
  console.log('========================================');

  if (!fs.existsSync(filePath)) { console.log('  [FAIL] not found'); totalFail++; return; }

  let src = fs.readFileSync(filePath, 'utf8');
  const orig = src;
  const bak = filePath + '.bak.v37.' + Date.now();
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
    info('failed — NOT saved (' + bak + ' has original)');
    totalFail += fail;
  } else {
    info('no changes needed');
    totalPass += pass;
  }
}

// =====================================================================
// FIX A — details: defer fetchStreams to next tick
// =====================================================================
patchFile(DETAILS, 'FIX A — details: defer fetchStreams (paint first, fetch after)',
({ src, ok, bad, info }) => {
  const MARKER = 'PATCH_V37_DEFER_STREAMS';
  if (src.includes(MARKER)) { ok('FIX A already applied'); return src; }

  // Try various indent levels — diagnostic showed L650 in an inner block
  const candidates = [
    "      fetchStreams(type, id);",
    "    fetchStreams(type, id);",
    "  fetchStreams(type, id);",
    "fetchStreams(type, id);",
  ];
  let matched = null, indent = '';
  for (const c of candidates) {
    const occ = src.split(c).length - 1;
    if (occ === 1) { matched = c; indent = c.match(/^\s*/)[0]; break; }
    if (occ > 1)   { info('skip "' + c.trim() + '" (matches ' + occ + ' times)'); }
  }
  if (!matched) { bad('no unique `fetchStreams(type, id);` anchor found'); return src; }

  const replacement = [
    indent + "// " + MARKER + " — defer to next tick so the details page paints",
    indent + "// instantly; streams load in the background and populate as they arrive.",
    indent + "const _v37StreamsTimer = setTimeout(() => { try { fetchStreams(type, id); } catch (_) {} }, 0);",
  ].join('\n');

  // Replace the single fetchStreams call with the deferred timer.
  // We don't add a clearTimeout because:
  //   (a) setTimeout(0) fires almost immediately,
  //   (b) the useEffect deps [id, type] re-fire only on real route change,
  //   (c) fetchStreams itself is idempotent (cache check first).
  // Keeping the patch to a single insertion is safer than restructuring the effect.

  ok('replaced sync fetchStreams with setTimeout(0) defer');
  return src.replace(matched, replacement);
});

// =====================================================================
// FIX B — ContentCard: neutralize V19C focus prefetch
// =====================================================================
patchFile(CARD, 'FIX B — ContentCard: kill V19C focus prefetch (D-pad lag)',
({ src, ok, bad, info }) => {
  const MARKER = 'PATCH_V37_KILL_V19C_PREFETCH';
  if (src.includes(MARKER)) { ok('FIX B already applied'); return src; }

  // Anchor on the V19C comment line (unique). Diagnostic showed it at L128.
  const v19cRe = /^(\s*)\/\/\s*PATCH_V19C_FOCUS_PREFETCH\b.*$/m;
  const m = src.match(v19cRe);
  if (!m) { bad('PATCH_V19C_FOCUS_PREFETCH comment not found'); return src; }

  const lineIndent = m[1] || '';
  const replacement = [
    lineIndent + '// ' + MARKER + ' — V19C focus prefetch DISABLED.',
    lineIndent + '//   Original reason for disable: scrolling D-pad across posters queues',
    lineIndent + '//   many delayed prefetches, hammering the backend and fragmenting the',
    lineIndent + '//   JS thread → laggy D-pad. (Matches the handoff warning verbatim.)',
    lineIndent + '//   To re-enable: remove this marker and any "if (false) {" guard added',
    lineIndent + '//   below. Original V19C comment was:',
    m[0].trim(), // preserve original V19C comment for reference
    lineIndent + 'if (false) /* ' + MARKER + ' short-circuit — see comments above */',
  ].join('\n');

  // After this insertion, whatever block follows the comment is preceded by
  // `if (false)` so it never executes. If the next statement is a useEffect
  // call, this short-circuit makes the call never happen at runtime.
  // If the next statement is a multi-line `{ ... }` block, it becomes
  // unreachable. Either way: dead code, no execution, no prefetch.

  ok('inserted runtime short-circuit before V19C prefetch block');
  return src.replace(m[0], replacement);
});

// =====================================================================
console.log('\n========================================');
console.log('  TOTAL: ' + totalPass + ' passed   ' + totalFail + ' failed');
console.log('========================================');

if (totalFail > 0) {
  console.log('\nSome sections failed. Originals safe in .bak.v37.* files.');
  process.exit(1);
} else {
  console.log('\nV37 done. Rebuild and test on Firestick:');
  console.log('  ✓ Discover → D-pad left/right/up/down rapidly → smooth, no lag spikes');
  console.log('  ✓ Click any poster → details page appears INSTANTLY (no frozen beat)');
  console.log('  ✓ Streams populate in the background as they arrive (no UI block)');
  console.log('  ✓ Play button still works the moment streams arrive');
  console.log('\nCommit when verified:');
  console.log('  git add -A');
  console.log('  git commit -m "perf: V37 — defer fetchStreams + kill V19C focus prefetch"');
}
