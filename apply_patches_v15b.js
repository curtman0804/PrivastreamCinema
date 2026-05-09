/* eslint-disable */
// apply_patches_v15b.js
// Run from project root:   node apply_patches_v15b.js
//
// LAZY-MOUNT DISCOVER SERVICE ROWS — staggers each service row's mount by
// 60ms after the navigation animation finishes (InteractionManager). On
// cold start, the first row paints immediately and subsequent rows fade
// in over the next ~500ms instead of all rendering simultaneously and
// pegging the JS thread.
//
// Fixes the issue from V15 where a JSX comment was placed outside the
// element inside a `return ( ... )` — that's invalid JS. This version
// replaces React.Fragment cleanly with LazyMount, no comments injected.

const fs = require('fs');
const path = require('path');

const DISCOVER = path.join('frontend', 'app', '(tabs)', 'discover.tsx');
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(DISCOVER)) { bad('discover.tsx not found'); process.exit(1); }

const raw = fs.readFileSync(DISCOVER, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(/\r?\n/);
const orig = lines.join(eol);
const bak = DISCOVER + '.bak.v15b.' + Date.now();
fs.copyFileSync(DISCOVER, bak);
info('backup → ' + bak);

console.log('\n=== Patching ' + DISCOVER + ' ===');

const MARKER_COMP = 'PATCH_V15B_LAZYMOUNT_COMPONENT';
const MARKER_USE  = 'PATCH_V15B_LAZYMOUNT_USAGE';

if (orig.includes(MARKER_USE)) {
  ok('LazyMount usage already in place — skipping');
  process.exit(0);
}

// ----------------------------------------------------------------
// 1. Insert LazyMount component before `export default function DiscoverScreen`
// ----------------------------------------------------------------
let modified = false;
if (!orig.includes(MARKER_COMP)) {
  const screenIdx = lines.findIndex(l => /export default function DiscoverScreen/.test(l));
  if (screenIdx < 0) {
    bad('could not find DiscoverScreen function declaration');
  } else {
    const componentSource = [
      '// ' + MARKER_COMP,
      '// Defers child mounting by `delay` ms then waits for the next idle window',
      '// (InteractionManager) before rendering. Used to stagger discover service',
      '// rows so the JS thread is not pegged with N FlatLists on cold start.',
      'function LazyMount({ delay, children, placeholder }: { delay: number; children: React.ReactNode; placeholder?: React.ReactNode }) {',
      '  const [shouldMount, setShouldMount] = useState(delay <= 0);',
      '  useEffect(() => {',
      '    if (delay <= 0) return;',
      '    let cancelled = false;',
      '    const t = setTimeout(() => {',
      '      InteractionManager.runAfterInteractions(() => {',
      '        if (!cancelled) setShouldMount(true);',
      '      });',
      '    }, delay);',
      '    return () => { cancelled = true; clearTimeout(t); };',
      '  }, [delay]);',
      '  if (!shouldMount) return (placeholder ?? null) as any;',
      '  return <>{children}</>;',
      '}',
      '',
    ];
    lines.splice(screenIdx, 0, ...componentSource);
    modified = true;
    ok('inserted LazyMount component above DiscoverScreen');
  }
} else {
  ok('LazyMount component already present');
}

// ----------------------------------------------------------------
// 2. Swap `<React.Fragment key={serviceName}>` with `<LazyMount ...>`
// ----------------------------------------------------------------
{
  const openIdx = lines.findIndex(l => /<React\.Fragment\s+key=\{serviceName\}>/.test(l));
  if (openIdx < 0) {
    bad('could not find <React.Fragment key={serviceName}> opener');
  } else {
    // Preserve the original indent
    const indent = (lines[openIdx].match(/^(\s*)/) || ['', ''])[1];
    // Replace the line with a single LazyMount opener (NO comment outside JSX).
    lines[openIdx] = indent + '<LazyMount key={serviceName} delay={(rowIdx++) * 60} placeholder={<View style={{ height: 240 }} />}> {/* ' + MARKER_USE + ' */}';

    // Find the next `</React.Fragment>` after this opener.
    let closeIdx = -1;
    for (let i = openIdx + 1; i < lines.length; i++) {
      if (/<\/React\.Fragment>/.test(lines[i])) { closeIdx = i; break; }
    }
    if (closeIdx < 0) {
      bad('could not find matching </React.Fragment> close — REVERTING');
      // Restore the line we just modified so we don't leave invalid JSX
      lines[openIdx] = indent + '<React.Fragment key={serviceName}>';
    } else {
      const closeIndent = (lines[closeIdx].match(/^(\s*)/) || ['', ''])[1];
      lines[closeIdx] = closeIndent + '</LazyMount>';
      modified = true;
      ok('service-row Fragment swapped for LazyMount with 60ms stagger (open=' + (openIdx+1) + ', close=' + (closeIdx+1) + ')');
    }
  }
}

if (modified) {
  fs.writeFileSync(DISCOVER, lines.join(eol), 'utf8');
  ok('saved ' + DISCOVER);
} else {
  info('no changes — revert path engaged');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');
if (fail > 0) {
  console.log('\nFailed. Original is safe in .bak file.');
  process.exit(1);
} else {
  console.log('\nV15-B done. Rebuild — discover service rows now mount in 60ms steps.');
  console.log('Cold start should paint Continue Watching + first service row instantly,');
  console.log('with subsequent rows fading in smoothly over ~500ms.');
}
