// apply_patches_v108.js — Vertical D-pad row-snap navigation for Discover screen.
//
// Wires up the EXISTING handleSectionFocus / sectionPositions infrastructure
// that was already in discover.tsx but never connected to ServiceRow rows.
//
// Run from your project root (where app/ lives):
//   node apply_patches_v108.js
//
// What changes:
//   1. Each row in the .map() is wrapped in <View onLayout={...}> so its
//      Y offset is recorded into sectionPositions.current[item.key].
//   2. ServiceRow's onItemFocus prop is replaced with a closure that calls
//      BOTH the existing prefetch handler AND handleSectionFocus(item.key).
//   3. The Continue Watching row also gets an onLayout so back-scroll to it
//      works the same way.
//
// Idempotent: if v108 markers are detected, the script exits without changes.
//
// CRITICAL: does NOT touch FlatList rendering, render windows, or focus engine.
// Pure additive wiring. Reverts cleanly via the .bak file created here.

const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', '(tabs)', 'discover.tsx');

function fail(msg) { console.error(`[v108] FATAL: ${msg}`); process.exit(1); }
function ok(msg)   { console.log(`[v108] ok: ${msg}`); }

if (!fs.existsSync(TARGET)) fail(`${TARGET} not found. Run this from your project root.`);

let src = fs.readFileSync(TARGET, 'utf8');
const orig = src;

if (src.includes('V108_ROW_SNAP')) {
  console.log('[v108] = already applied'); process.exit(0);
}

// ----- 1. Wrap ServiceRow render in onLayout View -----
// Find:   return (
//           <ServiceRow ... />
//         );
// inside the .map(). Replace with a wrapping View that records Y.

const SR_OLD =
`            return (
              <ServiceRow
                key={item.key}
                title={item.title}
                serviceName={item.serviceName}
                contentType={item.contentType}
                items={item.items}
                onItemPress={handleItemPress}
                onItemFocus={
                  item.contentType !== 'channels'
                    ? handleItemFocus
                    : undefined
                }
                rowIndex={item.rowIdx}
              />
            );`;

const SR_NEW =
`            // V108_ROW_SNAP: wrap each ServiceRow so we can measure its Y
            // position and snap the parent ScrollView to it on D-pad focus.
            return (
              <View
                key={item.key}
                onLayout={(e) => {
                  sectionPositions.current[item.key] = e.nativeEvent.layout.y;
                }}
              >
                <ServiceRow
                  title={item.title}
                  serviceName={item.serviceName}
                  contentType={item.contentType}
                  items={item.items}
                  onItemPress={handleItemPress}
                  onItemFocus={
                    item.contentType !== 'channels'
                      ? (ci) => {
                          handleSectionFocus(item.key);
                          handleItemFocus(ci);
                        }
                      : (ci) => {
                          handleSectionFocus(item.key);
                        }
                  }
                  rowIndex={item.rowIdx}
                />
              </View>
            );`;

if (!src.includes(SR_OLD)) {
  fail('ServiceRow anchor not found. Was the file modified after v107?');
}
src = src.replace(SR_OLD, SR_NEW);
ok('ServiceRow rows wrapped with onLayout + row-snap onItemFocus');

// ----- 2. Wrap the Continue Watching <View style={styles.section}> with onLayout -----
const CW_OLD =
`            if (item.kind === 'cw') {
              return (
                <View key={item.key} style={styles.section}>`;

const CW_NEW =
`            if (item.kind === 'cw') {
              // V108_ROW_SNAP: record CW row Y for vertical nav back-scroll
              return (
                <View
                  key={item.key}
                  style={styles.section}
                  onLayout={(e) => {
                    sectionPositions.current[item.key] = e.nativeEvent.layout.y;
                  }}
                >`;

if (src.includes(CW_OLD)) {
  src = src.replace(CW_OLD, CW_NEW);
  ok('Continue Watching row wrapped with onLayout');
} else {
  console.log('[v108] note: CW row anchor not found (skipping — non-fatal)');
}

// ----- Write + backup -----
if (src === orig) fail('No changes applied — bailing.');

const bak = TARGET + '.bak.v108.' + Date.now();
fs.writeFileSync(bak, orig, 'utf8');
fs.writeFileSync(TARGET, src, 'utf8');
console.log(`[v108] backup: ${bak}`);
console.log(`[v108] OK wrote ${TARGET}`);
console.log('');
console.log('Next: stop Metro (Ctrl+C in your bundler terminal), then `yarn start --clear`');
console.log('Then rebuild & sideload the app. D-pad up/down should now snap rows.');
