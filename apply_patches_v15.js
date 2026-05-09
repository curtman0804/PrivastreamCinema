/* eslint-disable */
// apply_patches_v15.js
// Run from project root:   node apply_patches_v15.js
//
// Two surgical fixes:
//
// 1. discover.tsx — Stagger service-row mounting via a LazyMount wrapper.
//    Cold-start currently mounts EVERY service row at once → 5-10
//    horizontal FlatLists + dozens of poster fetches all firing in the
//    same JS frame. The first row mounts immediately; subsequent rows
//    fade in at 60ms intervals (deferred via InteractionManager so they
//    only mount once the navigation animation finishes).
//
// 2. details/[type]/[id].tsx — Insert the COMM badge before the lang
//    badge on each StreamCard. Uses line-based scanning so it works
//    regardless of CRLF / LF line endings.

const fs = require('fs');
const path = require('path');

const DISCOVER = path.join('frontend', 'app', '(tabs)', 'discover.tsx');
const DETAILS  = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

function readLines(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  return { lines: raw.split(/\r?\n/), eol };
}
function writeLines(p, lines, eol) {
  fs.writeFileSync(p, lines.join(eol), 'utf8');
}
function backup(p) {
  const bak = p + '.bak.v15.' + Date.now();
  fs.copyFileSync(p, bak);
  info('backup → ' + bak);
}

// ====================================================================
// 1. discover.tsx — LazyMount wrapper for service rows
// ====================================================================
console.log('\n=== Patching ' + DISCOVER + ' ===');
{
  const MARKER_COMP = 'PATCH_V15_LAZYMOUNT_COMPONENT';
  const MARKER_USE  = 'PATCH_V15_LAZYMOUNT_USAGE';

  if (!fs.existsSync(DISCOVER)) {
    bad('discover.tsx not found');
  } else {
    const { lines, eol } = readLines(DISCOVER);
    const orig = lines.join(eol);

    if (orig.includes(MARKER_COMP) && orig.includes(MARKER_USE)) {
      ok('LazyMount already installed in discover.tsx');
    } else {
      backup(DISCOVER);

      // 1a. Insert the LazyMount component BEFORE `export default function DiscoverScreen`
      if (!orig.includes(MARKER_COMP)) {
        const screenIdx = lines.findIndex(l => /export default function DiscoverScreen/.test(l));
        if (screenIdx < 0) {
          bad('could not find DiscoverScreen function declaration');
        } else {
          const componentSource = [
            '// ' + MARKER_COMP,
            '// Defers child mounting by `delay` ms, then waits for the next idle window',
            '// (InteractionManager) before actually rendering. Used to stagger the discover',
            '// service rows so the JS thread is not pegged with N FlatLists on cold start.',
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
          ok('inserted LazyMount component above DiscoverScreen');
        }
      } else {
        ok('LazyMount component already present');
      }

      // 1b. Replace `<React.Fragment key={serviceName}>` with LazyMount opener
      if (!orig.includes(MARKER_USE)) {
        const openIdx = lines.findIndex(l => /<React\.Fragment\s+key=\{serviceName\}>/.test(l));
        if (openIdx < 0) {
          bad('could not find <React.Fragment key={serviceName}> opener');
        } else {
          // Determine indentation
          const indent = (lines[openIdx].match(/^(\s*)/) || ['', ''])[1];
          // Replace the line
          lines[openIdx] = indent + '{/* ' + MARKER_USE + ' */}';
          // Insert opener (uses post-increment rowIdx already declared in the IIFE)
          lines.splice(openIdx + 1, 0,
            indent + '<LazyMount key={serviceName} delay={(rowIdx++) * 60} placeholder={<View style={{ height: 240 }} />}>'
          );

          // Find the matching closing `</React.Fragment>` after this point.
          // It should be the FIRST one we find at a depth that returns to the original.
          // For our use case (each iteration returns one Fragment), the next
          // </React.Fragment> after the opener is the matching close.
          const closeIdx = lines.findIndex((l, i) => i > openIdx + 1 && /<\/React\.Fragment>/.test(l));
          if (closeIdx < 0) {
            bad('could not find matching </React.Fragment> close');
          } else {
            const closeIndent = (lines[closeIdx].match(/^(\s*)/) || ['', ''])[1];
            lines[closeIdx] = closeIndent + '</LazyMount>';
            ok('service-row Fragment swapped for LazyMount with 60ms stagger');
          }
        }
      } else {
        ok('LazyMount usage already in place');
      }

      writeLines(DISCOVER, lines, eol);
      ok('saved ' + DISCOVER);
    }
  }
}

// ====================================================================
// 2. details/[type]/[id].tsx — Commentary badge before lang badge
// ====================================================================
console.log('\n=== Patching ' + DETAILS + ' ===');
{
  const MARKER = 'PATCH_V15_COMMENTARY_BADGE';

  if (!fs.existsSync(DETAILS)) {
    bad('details file not found');
  } else {
    const { lines, eol } = readLines(DETAILS);
    const orig = lines.join(eol);

    if (orig.includes(MARKER)) {
      ok('Commentary badge already inserted');
    } else {
      backup(DETAILS);

      // Find the line with `<View style={[\n  styles.langBadge,` pattern
      // Specifically: line containing `styles.streamBadgeRow}>` followed shortly by `<View style={[`
      const rowIdx = lines.findIndex(l => /streamBadgeRow}>/.test(l));
      if (rowIdx < 0) {
        bad('could not find <View style={styles.streamBadgeRow}> opener');
      } else {
        // Find the next `<View style={[` AFTER streamBadgeRow opener
        let langOpenIdx = -1;
        for (let i = rowIdx + 1; i < Math.min(lines.length, rowIdx + 6); i++) {
          if (/<View style=\{\[/.test(lines[i])) { langOpenIdx = i; break; }
        }
        if (langOpenIdx < 0) {
          bad('could not find <View style={[ ... }> after streamBadgeRow');
        } else {
          const indent = (lines[langOpenIdx].match(/^(\s*)/) || ['', ''])[1];
          const badge = [
            indent + '{/* ' + MARKER + ' */}',
            indent + '{isCommentary && (',
            indent + '  <View style={styles.commentaryBadge}>',
            indent + '    <Ionicons name="chatbubble" size={11} color="#FF8C00" />',
            indent + '    <Text style={styles.commentaryBadgeText}>COMM</Text>',
            indent + '  </View>',
            indent + ')}',
          ];
          lines.splice(langOpenIdx, 0, ...badge);
          ok('Commentary badge JSX inserted before lang badge');
          writeLines(DETAILS, lines, eol);
          ok('saved ' + DETAILS);
        }
      }
    }
  }
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');
if (fail > 0) {
  console.log('\nSome patches failed. Originals are safe in .bak files.');
  process.exit(1);
} else {
  console.log('\nV15 done. Rebuild and test:');
  console.log('  ✓ Discover cold-start should paint Continue Watching + first service row instantly');
  console.log('  ✓ Subsequent service rows fade in over the next ~500ms');
  console.log('  ✓ Stream cards now show an orange COMM badge on commentary tracks');
}
