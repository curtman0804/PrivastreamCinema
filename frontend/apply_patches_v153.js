/* eslint-disable */
// apply_patches_v153_stronger_hdr_detection.js
//
// STRONGER HDR DETECTION — catch the untagged-HDR case.
//
// Symptom: Guardians of the Galaxy 2 played dark even with v150 in
// place.  Reason: the dark copy's filename was something like
// "...2160p.WEB-DL.HEVC-RELEASEGROUP" — no "HDR" / "10bit" / "DV" tag,
// so parseStreamInfo's isHDR detection returned false and v150 didn't
// apply the -800 penalty.  In reality ~95 % of 4K HEVC releases are
// HDR-encoded; only the filename lies.
//
// v153 changes:
//   1. Add HDR variants: HDR10, HDR10+, HDR-10, HLG, BT2020, BT.2020,
//      REC2020, REC.2020, WCG, PQ10, SMPTE2084.
//   2. Add a "presumed-HDR" branch: any 4K HEVC file without an
//      explicit SDR / 8-bit tag is treated as HDR.
//   3. Treat 10-bit content as HDR-equivalent even when at 1080p
//      (10bit HEVC encodes have crushed shadows on SDR displays too).
//
// The v150 -800 penalty already covers the new cases automatically
// because they now flag info.isHDR=true at parse time.
//
// Idempotent.  CRLF-safe.
//
//   curl -s -o apply_patches_v153.js "https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v153_stronger_hdr_detection.js?v=1" && node apply_patches_v153.js
//
const fs = require('fs');
const path = require('path');

function find(rel) {
  const candidates = [
    path.join(process.cwd(), rel),
    path.join(process.cwd(), 'frontend', rel),
    path.join(process.cwd(), '..', 'frontend', rel),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

const idPath = find(path.join('app', 'details', '[type]', '[id].tsx'));
if (!idPath) {
  console.error('[v153] FATAL: app/details/[type]/[id].tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(idPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = idPath + '.bak_v153';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v153] Backup: ${backupPath}`);
}

const reports = [];
function applyOnce(label, marker, oldStr, newStr) {
  if (marker && src.indexOf(marker) !== -1) {
    reports.push({ label, status: 'SKIP_IDEMPOTENT' });
    return true;
  }
  const old2 = oldStr.replace(/\r?\n/g, NL);
  const new2 = newStr.replace(/\r?\n/g, NL);
  const occurrences = src.split(old2).length - 1;
  if (occurrences === 0) { reports.push({ label, status: 'NOT_FOUND' }); return false; }
  if (occurrences > 1)  { reports.push({ label, status: 'AMBIGUOUS', count: occurrences }); return false; }
  const before = src.length;
  src = src.replace(old2, new2);
  reports.push({ label, status: 'OK', delta: src.length - before });
  return true;
}

// Replace the single isHDR line with the expanded detection block.
applyOnce(
  'p1_stronger_hdr_detection',
  'PATCH_V153_HDR_BROAD',
  `  // HDR / Dolby Vision / 10-bit produce wrong colors on SDR Firestick → avoid when possible
  const isHDR = combined.includes('HDR') || combined.includes('DOLBY VISION') || combined.includes('DOLBYVISION') || combined.includes('DV.') || combined.includes(' DV ') || combined.includes('10BIT') || combined.includes('10-BIT') || combined.includes('10 BIT');`,
  `  // PATCH_V153_HDR_BROAD — wide detection: explicit HDR tags, 10-bit signaling,
  // wide-color-gamut metadata names, and a presumption that any UNTAGGED 4K HEVC
  // release is HDR (true for ~95% of 4K HEVC encodes in the wild).
  const _v153HasExplicitSDR = combined.includes('SDR')
    || combined.includes('8BIT') || combined.includes('8-BIT') || combined.includes('8 BIT');
  const _v153HasExplicitHDR = (
    combined.includes('HDR')              // catches HDR, HDR10, HDR10+, HDR-10, HDR PLUS
    || combined.includes('DOLBY VISION') || combined.includes('DOLBYVISION')
    || combined.includes('DV.') || combined.includes(' DV ') || combined.includes('-DV-') || combined.includes('.DV.')
    || combined.includes('10BIT') || combined.includes('10-BIT') || combined.includes('10 BIT') || combined.includes('X265.10')
    || combined.includes('HLG')
    || combined.includes('BT2020') || combined.includes('BT.2020')
    || combined.includes('REC2020') || combined.includes('REC.2020')
    || combined.includes('WCG')
    || combined.includes('PQ10') || combined.includes('SMPTE2084')
  );
  const _v153IsPresumed4KHEVC = (quality === '4K' && isHEVC && !_v153HasExplicitSDR);
  const isHDR = _v153HasExplicitHDR || _v153IsPresumed4KHEVC;`
);

if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT')) {
  console.log('[v153] Already applied — no changes written.');
} else {
  fs.writeFileSync(idPath, src, 'utf8');
  console.log(`[v153] Wrote ${idPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v153] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
