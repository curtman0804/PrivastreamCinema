// v237b — Fixed v237 discover patch: imports go at TOP of file, helpers
// stay near top of module scope.  See All screen still gets created.
// Cache-buster (A+B) from v237 stays applied — only re-runs Discover (C).
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const discoverF = path.join(ROOT, 'app/(tabs)/discover.tsx');
if (!fs.existsSync(discoverF)) {
  console.log('[ERR] discover.tsx not found');
  process.exit(1);
}

let raw = fs.readFileSync(discoverF, 'utf8');
if (raw.includes('// v237 see all')) {
  console.log('[noop] v237b already applied');
  process.exit(0);
}

const usesCRLF = /\r\n/.test(raw);
let work = raw.replace(/\r\n/g, '\n');

// Step 1: inject `useWindowDimensions` into an existing react-native import,
// or add a new import at the very top.
const rnImportMatch = work.match(/import\s*\{([^}]+)\}\s*from\s*['"]react-native['"];/);
if (rnImportMatch) {
  if (!rnImportMatch[1].includes('useWindowDimensions')) {
    const newImports = rnImportMatch[1].trim().replace(/,?\s*$/, ', useWindowDimensions');
    work = work.replace(rnImportMatch[0], `import { ${newImports} } from 'react-native';`);
    console.log('[ok]   added useWindowDimensions to existing react-native import');
  }
} else {
  // Add brand new import after the first import line
  work = work.replace(/^(import [^\n]+\n)/, "$1import { useWindowDimensions } from 'react-native';\n");
  console.log('[ok]   added new useWindowDimensions import line');
}

// Step 2: Add helpers right after the imports block.  Find last `import ...;` line.
const importLines = work.match(/^import [^\n]+;\n/gm) || [];
if (importLines.length > 0) {
  const lastImport = importLines[importLines.length - 1];
  const lastImportIdx = work.lastIndexOf(lastImport) + lastImport.length;
  const helper = `
// v237 see all — dynamic poster count per row by screen size + orientation
function _v237_useColumns() {
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;
  const isLandscape = width > height;
  if (isTablet) return isLandscape ? 7 : 4;
  return isLandscape ? 5 : 3;
}
function _v237_useRowCap() {
  const cols = _v237_useColumns();
  return cols * 4;
}

`;
  work = work.slice(0, lastImportIdx) + helper + work.slice(lastImportIdx);
  console.log('[ok]   helpers inserted after imports');
}

// Step 3: cap items array passed to ServiceRow + add See All sentinel
work = work.replace(
  /(<ServiceRow[^>]*\bitems=\{)([^}]+)(\})/g,
  '$1(($2) || []).slice(0, _v237_useRowCap()).concat([{ id: "__v237_seeall__", _seeAll: true }])$3',
);

fs.writeFileSync(discoverF + '.bak_v237b', raw, 'utf8');
fs.writeFileSync(discoverF, usesCRLF ? work.replace(/\n/g, '\r\n') : work, 'utf8');
console.log('[ok]   discover.tsx patched (backup at .bak_v237b)');
console.log('Now rebuild APK + sideload.');
