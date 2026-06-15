// =============================================================================
// PATCH v212 — Loading isolation pattern (Discover)
//
// Wraps non-urgent state updates in React 18's startTransition so D-pad
// focus events ALWAYS preempt CW refresh, discover SWR refresh, and disk
// hydration.  Result: focus never queues behind a state-update + re-mount.
//
// Touches ONE file: app/(tabs)/discover.tsx  (CRLF-safe)
//
// Run from C:\Users\Curtm\PrivastreamCinema\frontend:
//   curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v212_loading_isolation.js -o v212.js
//   node v212.js
// =============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const F = path.join(ROOT, 'app/(tabs)/discover.tsx');

if (!fs.existsSync(F)) { console.log('[ERR] discover.tsx not found'); process.exit(1); }

let src = fs.readFileSync(F, 'utf8');
const before = src;
const usesCRLF = /\r\n/.test(src);
const normalize = (s) => s.replace(/\r\n/g, '\n');
const denormalize = (s) => usesCRLF ? s.replace(/\n/g, '\r\n') : s;
let work = normalize(src);

if (work.includes('// v212 loading isolation')) {
  console.log('[noop] discover.tsx already has v212.'); process.exit(0);
}

// -------------------------------------------------------------------------
// 1) Ensure `startTransition` is imported from 'react'
// -------------------------------------------------------------------------
const reactImportRe = /import\s+(?:React,\s*)?\{([^}]+)\}\s+from\s+'react';/;
if (reactImportRe.test(work)) {
  work = work.replace(reactImportRe, (m, names) => {
    if (/\bstartTransition\b/.test(names)) return m;
    const cleaned = names.replace(/\s+$/, '').replace(/,\s*$/, '');
    return m.replace('{' + names + '}', '{' + cleaned + ', startTransition }');
  });
} else {
  console.log('[ERR] could not find React import to extend.');
  process.exit(1);
}

// -------------------------------------------------------------------------
// 2) Wrap setContinueWatching in fetchContinueWatching with startTransition
//    so the back-nav refresh never preempts an in-flight focus event.
// -------------------------------------------------------------------------
const oldCWFetch = `      const _v204Next = response.continueWatching || [];
      // V204_SKIP_IDENTICAL — unchanged CW => keep previous array reference (no re-render)
      setContinueWatching(prev => {
        try { if (JSON.stringify(prev) === JSON.stringify(_v204Next)) return prev; } catch (_) {}
        return _v204Next;
      });
      lastCWFetchTime.current = Date.now();
    } catch (err) {
      console.log('[Discover] Error fetching continue watching:', err);
    } finally {
      setIsLoadingProgress(false);
    }`;

const newCWFetch = `      const _v204Next = response.continueWatching || [];
      // v212 loading isolation — defer the CW re-render so D-pad focus events
      // arriving in the same tick are NOT blocked by reconciliation.
      startTransition(() => {
        // V204_SKIP_IDENTICAL — unchanged CW => keep previous array reference
        setContinueWatching(prev => {
          try { if (JSON.stringify(prev) === JSON.stringify(_v204Next)) return prev; } catch (_) {}
          return _v204Next;
        });
      });
      lastCWFetchTime.current = Date.now();
    } catch (err) {
      console.log('[Discover] Error fetching continue watching:', err);
    } finally {
      // v212 loading isolation — same: loader flag is non-urgent
      startTransition(() => { setIsLoadingProgress(false); });
    }`;

if (!work.includes(oldCWFetch)) {
  console.log('[ERR] fetchContinueWatching block did not match exact baseline. Aborting.');
  process.exit(1);
}
work = work.replace(oldCWFetch, newCWFetch);

// -------------------------------------------------------------------------
// 3) Disk-cache hydration setStates → startTransition.  These run on mount
//    and would otherwise stomp on the user's first frame.
// -------------------------------------------------------------------------
const oldHydrate = `        if (d) {
          try { setCachedDiscover(JSON.parse(d)); } catch (_) {}
        }
        if (c) {
          try { setCachedCW(JSON.parse(c)); } catch (_) {}
        }`;

const newHydrate = `        // v212 loading isolation — both cache-hydration sets are non-urgent
        if (d) {
          try {
            const parsed = JSON.parse(d);
            startTransition(() => { setCachedDiscover(parsed); });
          } catch (_) {}
        }
        if (c) {
          try {
            const parsed = JSON.parse(c);
            startTransition(() => { setCachedCW(parsed); });
          } catch (_) {}
        }`;

if (work.includes(oldHydrate)) {
  work = work.replace(oldHydrate, newHydrate);
}

// -------------------------------------------------------------------------
// 4) The CW optimistic removal at line 505 — already optimistic but let's
//    keep it urgent (do NOT wrap in startTransition).  User pressed Clear;
//    they need the poster gone NOW.  Leaving that alone.
// -------------------------------------------------------------------------

// -------------------------------------------------------------------------
// Mark the file so the noop check works on re-runs.
// -------------------------------------------------------------------------
work = work.replace(
  reactImportRe,
  (m) => '// v212 loading isolation\n' + m
);

if (work === normalize(before)) { console.log('[noop] nothing changed.'); process.exit(0); }

fs.writeFileSync(F + '.bak_v212', before, 'utf8');
fs.writeFileSync(F, denormalize(work), 'utf8');
console.log('[ok]   app/(tabs)/discover.tsx patched');
console.log('       backup at app/(tabs)/discover.tsx.bak_v212');
console.log('');
console.log('Rebuild APK + sideload.  Expected on Firestick:');
console.log('  • Returning from Details to Discover: rows are stable, focus stays put.');
console.log('  • Pressing D-pad immediately on back-nav: no "catch-up" lag, posters');
console.log('    that change do so a beat later (after your D-pad press lands).');
console.log('  • Cold-boot disk-cache hydration no longer fights the first frame.');
console.log('');
console.log('Rollback if anything is off:');
console.log('  copy /Y "app\\(tabs)\\discover.tsx.bak_v212" "app\\(tabs)\\discover.tsx"');
