/* eslint-disable */
// apply_patches_v57.js — Fix two things in one shot:
//
//   1) Restore full addon list: V55's phase-1 fetch of /api/discover?limit=5
//      was cutting off the Streaming Catalogs addon (which produces Netflix,
//      Disney+, Prime, HBO, Hulu, Paramount+, Apple TV+, Peacock, Discovery+).
//      Solution: always fetch the FULL list. V54's frontend already staggers
//      the render so cold-start stays fast — no backend pagination needed.
//
//   2) Add getItemType to FlashList (regex-based, handles any indent). Without
//      this, FlashList recycles Continue-Watching cells as Service-Row cells
//      and you see Netflix Series with USA TV posters.

const fs = require('fs');
const path = require('path');

let ok_count = 0, fail_count = 0;
const ok = (m) => { ok_count++; console.log('  [OK]   ' + m); };
const fail = (m) => { fail_count++; console.log('  [FAIL] ' + m); };

// ─────────────────────────────────────────────────────────────────
// 1) discover.tsx — add getItemType to outer FlashList
// ─────────────────────────────────────────────────────────────────
const F1 = path.join('frontend', 'app', '(tabs)', 'discover.tsx');
if (!fs.existsSync(F1)) {
  fail('discover.tsx not found');
} else {
  let raw = fs.readFileSync(F1, 'utf8');
  const hadCRLF = raw.indexOf('\r\n') >= 0;
  let src = raw.replace(/\r\n/g, '\n');

  if (src.includes('PATCH_V57_GETITEMTYPE')) {
    ok('discover.tsx already has getItemType (V57)');
  } else {
    // Use regex: match keyExtractor line + capture leading whitespace
    const re = /(\n)([ \t]+)(keyExtractor=\{\(it:\s*any\)\s*=>\s*it\.key\})/;
    const m = src.match(re);
    if (!m) {
      fail('keyExtractor anchor not found in discover.tsx');
    } else {
      const indent = m[2];
      const inserted = m[0] + '\n' + indent + 'getItemType={(it: any) => it.kind} // PATCH_V57_GETITEMTYPE';
      src = src.replace(re, inserted);
      const bak = F1 + '.bak.v57.' + Date.now();
      fs.copyFileSync(F1, bak);
      console.log('  [info] backup → ' + bak);
      fs.writeFileSync(F1, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');
      ok('added getItemType to outer FlashList');
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// 2) contentStore.ts — drop the ?limit=5 first-call, always fetch full
// ─────────────────────────────────────────────────────────────────
const F2 = path.join('frontend', 'src', 'store', 'contentStore.ts');
if (!fs.existsSync(F2)) {
  fail('contentStore.ts not found');
} else {
  let raw = fs.readFileSync(F2, 'utf8');
  const hadCRLF = raw.indexOf('\r\n') >= 0;
  let src = raw.replace(/\r\n/g, '\n');

  if (src.includes('PATCH_V57_FULL_FETCH')) {
    ok('contentStore.ts already restored to full fetch (V57)');
  } else if (!src.includes('PATCH_V55_TWO_PHASE')) {
    ok('contentStore.ts has no V55 pagination — nothing to revert');
  } else {
    // Replace the inner phase-1 try block to NOT use ?limit=5.
    const oldChunk = `      // Phase 1 — fast first paint (5 services).
      // We fetch via api.content.getDiscover with query params appended by
      // calling client.get directly when the API allows; otherwise fall back
      // to the legacy single-call.
      let firstPage: any = null;
      try {
        // Use the underlying axios client if present
        const apiAny: any = api as any;
        if (apiAny.client && apiAny.client.get) {
          const resp = await apiAny.client.get('/discover?limit=5');
          firstPage = resp.data;
        } else {
          firstPage = await apiAny.content.getDiscover();
        }
      } catch (err) {
        // Backend might not have V55 backend yet → fall back to legacy.
        console.log('[ContentStore] Phase 1 failed, falling back:', err);
        firstPage = await (api.content as any).getDiscover();
      }`;

    const newChunk = `      // PATCH_V57_FULL_FETCH — always fetch full discover (no backend pagination).
      // V54 frontend already staggers render so cold start stays fast,
      // and we need ALL addons (Streaming Catalogs especially) for proper
      // row population.
      let firstPage: any = null;
      try {
        firstPage = await (api.content as any).getDiscover();
      } catch (err) {
        console.log('[ContentStore] discover fetch failed:', err);
        throw err;
      }`;

    if (!src.includes(oldChunk)) {
      // Could not find exact V55 chunk — use a broader regex.
      const re = /\/\/ Phase 1 — fast first paint[\s\S]*?firstPage = await \(api\.content as any\)\.getDiscover\(\);\s*\}/;
      if (!re.test(src)) {
        fail('V55 phase-1 chunk not found in contentStore.ts');
      } else {
        src = src.replace(re,
          `// PATCH_V57_FULL_FETCH — always fetch full discover\n      let _v57tmp: any = null; try { _v57tmp = await (api.content as any).getDiscover(); } catch (e) { console.log('[ContentStore] discover fetch failed:', e); throw e; } firstPage = _v57tmp;\n      // end V57`);
        ok('replaced V55 phase-1 with V57 full fetch (regex)');
      }
    } else {
      src = src.replace(oldChunk, newChunk);
      ok('replaced V55 phase-1 with V57 full fetch');
    }

    // Also remove the phase-2 background block (no longer needed).
    const phase2Re = /\n\s*\/\/ Phase 2[\s\S]*?\}\)\(\);\s*\}\s*/;
    if (phase2Re.test(src)) {
      src = src.replace(phase2Re, '\n');
      ok('removed obsolete phase-2 background fetch');
    }

    const bak = F2 + '.bak.v57.' + Date.now();
    fs.copyFileSync(F2, bak);
    console.log('  [info] backup → ' + bak);
    fs.writeFileSync(F2, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');
  }
}

console.log('\n========================================');
console.log('  ' + ok_count + ' passed   ' + fail_count + ' failed');
console.log('========================================');

if (fail_count > 0) {
  console.log('\nSome anchors failed. Paste the output and we adjust.');
  process.exit(1);
}

console.log('\nV57 done. Rebuild → sideload → force-stop → relaunch.');
console.log('Expected:');
console.log('  ✓ All your service rows populate (Netflix → Discovery+).');
console.log('  ✓ Posters match their row titles (no more jumbling).');
console.log('  ✓ Cold start still fast (V54 staggered render is in charge).');
console.log('');
console.log('Verify:');
console.log('  findstr /S /C:"PATCH_V57" frontend\\\\app\\\\(tabs)\\\\discover.tsx frontend\\\\src\\\\store\\\\contentStore.ts');
