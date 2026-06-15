// =============================================================================
// HOTFIX v207b — Add missing `useRef` import to addons.tsx that v207 forgot.
//
// Run from C:\Users\Curtm\PrivastreamCinema\frontend:
//   curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v207b_hotfix_useref.js -o v207b.js
//   node v207b.js
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'app/(tabs)/addons.tsx');

if (!fs.existsSync(FILE)) {
  console.log('[ERR] app/(tabs)/addons.tsx not found at ' + FILE);
  process.exit(1);
}

let s = fs.readFileSync(FILE, 'utf8');

// 1) Ensure `useRef` is in the named imports from 'react'
const reactImportRe = /import React,\s*\{([^}]*)\}\s*from\s*['"]react['"];/;
const reactNamedOnlyRe = /import\s*\{([^}]*)\}\s*from\s*['"]react['"];/;

let changed = false;
if (reactImportRe.test(s)) {
  s = s.replace(reactImportRe, (m, names) => {
    if (/\buseRef\b/.test(names)) return m;
    changed = true;
    return `import React, {${names.replace(/\s*,?\s*$/,'')}, useRef } from 'react';`;
  });
} else if (reactNamedOnlyRe.test(s)) {
  // No default-import yet — add both React default and useRef
  s = s.replace(reactNamedOnlyRe, (m, names) => {
    if (/\buseRef\b/.test(names)) return `import React, {${names}} from 'react';`;
    changed = true;
    return `import React, {${names.replace(/\s*,?\s*$/,'')}, useRef } from 'react';`;
  });
} else {
  // No React import at all (unlikely) — prepend
  s = `import React, { useRef } from 'react';\n` + s;
  changed = true;
}

if (changed) {
  fs.writeFileSync(FILE + '.bak_v207b', fs.readFileSync(FILE), 'utf8');
  fs.writeFileSync(FILE, s, 'utf8');
  console.log('[ok] addons.tsx — useRef import added');
} else {
  console.log('[noop] useRef already imported');
}

console.log('--- v207b hotfix complete ---');
console.log('Press r in Expo CLI to reload, then re-open Addons.');
