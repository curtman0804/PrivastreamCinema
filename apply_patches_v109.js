// apply_patches_v109.js — Make row-snap scrolling instant (Stremio-style).
// Changes handleSectionFocus to use animated: false and removes the 50ms
// setTimeout so D-pad hold/press flies through rows with no animation queue.
const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', '(tabs)', 'discover.tsx');
function fail(msg) { console.error(`[v109] FATAL: ${msg}`); process.exit(1); }
function ok(msg)   { console.log(`[v109] ok: ${msg}`); }

if (!fs.existsSync(TARGET)) fail(`${TARGET} not found.`);

const origBuffer = fs.readFileSync(TARGET, 'utf8');
const hadCRLF = origBuffer.includes('\r\n');
let src = origBuffer.replace(/\r\n/g, '\n');
const norm = src;

if (src.includes('V109_INSTANT_SCROLL')) {
  console.log('[v109] = already applied');
  process.exit(0);
}

// Replace the timeout+animated:true block with instant scroll
const OLD = `    const sectionY = sectionPositions.current[sectionKey];
    if (sectionY !== undefined && scrollViewRef.current) {
      // Small delay to override Android TV's auto-scroll (which only shows the card, not the title)
      setTimeout(() => {
        scrollViewRef.current?.scrollTo({ y: Math.max(0, sectionY - 10), animated: true });
      }, 50);
    }`;

const NEW = `    const sectionY = sectionPositions.current[sectionKey];
    if (sectionY !== undefined && scrollViewRef.current) {
      // V109_INSTANT_SCROLL: instant snap (no animation queue) so held D-pad
      // flies through rows like Stremio. Negative offset keeps the title row
      // visible above the focused poster.
      scrollViewRef.current.scrollTo({ y: Math.max(0, sectionY - 10), animated: false });
    }`;

if (!src.includes(OLD)) fail('handleSectionFocus anchor not found.');
src = src.replace(OLD, NEW);
ok('handleSectionFocus now uses instant scroll (no setTimeout, no animation)');

if (src === norm) fail('No changes');
const out = hadCRLF ? src.replace(/\n/g, '\r\n') : src;
const bak = TARGET + '.bak.v109.' + Date.now();
fs.writeFileSync(bak, origBuffer, 'utf8');
fs.writeFileSync(TARGET, out, 'utf8');
console.log(`[v109] backup: ${bak}`);
console.log(`[v109] OK wrote ${TARGET}`);
console.log('Restart Metro with --clear, rebuild, sideload.');
