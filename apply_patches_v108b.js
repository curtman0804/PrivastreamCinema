// apply_patches_v108b.js — Vertical D-pad row-snap navigation (CRLF-safe).
// Same logic as v108 but normalizes CRLF -> LF for matching, then restores
// CRLF when writing. Works regardless of git autocrlf settings.
const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', '(tabs)', 'discover.tsx');

function fail(msg) { console.error(`[v108b] FATAL: ${msg}`); process.exit(1); }
function ok(msg)   { console.log(`[v108b] ok: ${msg}`); }

if (!fs.existsSync(TARGET)) fail(`${TARGET} not found. cd into the frontend folder first.`);

const origBuffer = fs.readFileSync(TARGET, 'utf8');
const hadCRLF = origBuffer.includes('\r\n');
let src = origBuffer.replace(/\r\n/g, '\n'); // normalize for matching
const norm = src;

if (src.includes('V108_ROW_SNAP')) {
  console.log('[v108b] = already applied');
  process.exit(0);
}

const SR_OLD =
`      return (
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
`      // V108_ROW_SNAP: wrap ServiceRow with onLayout for row Y measurement
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
  // try with the 14-space leading variant just in case
  const SR_OLD2 = SR_OLD.replace('      return (', '            return (');
  if (src.includes(SR_OLD2)) {
    src = src.replace(SR_OLD2, SR_NEW.replace('      // V108_ROW_SNAP', '            // V108_ROW_SNAP').replace('      return (', '            return ('));
    ok('ServiceRow wrapped (14-space variant)');
  } else {
    fail('ServiceRow anchor not found even after CRLF normalization.');
  }
} else {
  src = src.replace(SR_OLD, SR_NEW);
  ok('ServiceRow rows wrapped with onLayout + row-snap onItemFocus');
}

// CW row
const CW_OLD =
`            if (item.kind === 'cw') {
              return (
                <View key={item.key} style={styles.section}>`;

const CW_NEW =
`            if (item.kind === 'cw') {
              // V108_ROW_SNAP: record CW row Y for back-scroll
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
  console.log('[v108b] note: CW row anchor not found (non-fatal)');
}

if (src === norm) fail('No changes applied');

// Restore original line endings
const out = hadCRLF ? src.replace(/\n/g, '\r\n') : src;

const bak = TARGET + '.bak.v108b.' + Date.now();
fs.writeFileSync(bak, origBuffer, 'utf8');
fs.writeFileSync(TARGET, out, 'utf8');
console.log(`[v108b] backup: ${bak}`);
console.log(`[v108b] OK wrote ${TARGET}`);
console.log('');
console.log('Next: restart Metro with --clear, then rebuild & sideload.');
