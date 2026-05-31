/* eslint-disable */
// apply_patches_v157_wrong_title_guard.js
//
// FRONTEND TITLE/YEAR GUARD — stop wrong content from playing.
//
// Problem (the actual one):
//   Clicking GOTG Vol. 2 picks GOTG Vol. 3.  Clicking Family Feud picks
//   Caesar 911.  The backend's `/api/streams/movie/{id}` aggregator
//   leaks streams from other titles via title-based torrent searches
//   (ApiBay, YTS).  The Stremio TPB Plus addon ALSO returns
//   cross-contaminated results for some IMDb ids.  By the time the
//   frontend has the stream list, it doesn't matter whether the
//   backend ran a filter — many of these streams are simply for the
//   wrong movie, and the frontend's quality+seeder sort picks one of
//   them.
//
// Fix:
//   Add a *client-side* title/year guard that rejects any stream whose
//   filename clearly disagrees with the requested content's title +
//   year + sequel marker.  Runs inside sortStreamsByLanguage() so
//   EVERY sort-based pick (Play button, autoplay, prewarm, fallback
//   torrents, upgrade-merge) automatically filters first.
//
// Logic (applied for MOVIES only; series have their own episode filter):
//   1) YEAR CHECK: if requested year is e.g. 2017, reject streams that
//      contain a 4-digit year and none of them is within ±1 of 2017.
//   2) SEQUEL MARKER CHECK: if requested title has "Vol N" / "Part N" /
//      "Chapter N" (or trailing standalone number "Rocky 4"), reject
//      streams whose markers disagree.
//   3) BASE TITLE → SEQUEL REJECT: if requested title has NO sequel
//      marker, reject streams that DO mention one (e.g., clicking
//      "Joker" rejects "Joker 2 Folie a Deux").
//
// Conservative: if a stream has no year AND no sequel marker, KEEP it.
// Conservative: only runs for movies, never for series.
//
// Idempotent.  CRLF-safe.
//
//   curl -s -o apply_patches_v157.js "https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v157_wrong_title_guard.js?v=1" && node apply_patches_v157.js
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
  console.error('[v157] FATAL: app/details/[type]/[id].tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(idPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = idPath + '.bak_v157';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v157] Backup: ${backupPath}`);
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

// ============================================================
// STEP 1: Inject the helper block right before sortStreamsByLanguage.
// ============================================================
applyOnce(
  'p1_inject_helpers',
  'V157_WRONG_TITLE_GUARD',
  `function sortStreamsByLanguage(streams: Stream[]): Stream[] {`,
  `// V157_WRONG_TITLE_GUARD — module-level mutable meta holder.  The
// details screen writes its current content here every render (before
// any useMemo runs), and sortStreamsByLanguage reads it as its first
// step.  This keeps the sort function's signature unchanged across
// the ~5 existing callsites.
let _v157_currentMeta: { title: string; year: string; isMovie: boolean } = {
  title: '', year: '', isMovie: false,
};

function _v157_romanToInt(s: string): number | null {
  const t = s.toUpperCase().trim();
  const vals: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  if (!t) return null;
  for (let i = 0; i < t.length; i++) { if (!(t[i] in vals)) return null; }
  let tot = 0, prev = 0;
  for (let i = t.length - 1; i >= 0; i--) {
    const v = vals[t[i]];
    tot += v < prev ? -v : v;
    prev = v;
  }
  return (tot >= 1 && tot <= 20) ? tot : null;
}

function _v157_extractSequelMarkers(text: string): Set<number> {
  const out = new Set<number>();
  if (!text) return out;
  const re = /\\b(?:vol(?:ume)?\\.?|part|chapter|episode|book)\\s*(\\d{1,2}|[IVXLC]{1,5})\\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tok = m[1];
    let n: number | null = null;
    if (/^\\d+$/.test(tok)) n = parseInt(tok, 10);
    else n = _v157_romanToInt(tok);
    if (n !== null && n >= 1 && n <= 20) out.add(n);
  }
  // Trailing standalone number: "Rocky 4", "John Wick 2"
  const tm = text.trim().match(/(?:^|[^A-Za-z0-9])(\\d{1,2})\\s*$/);
  if (tm) {
    const n = parseInt(tm[1], 10);
    if (n >= 2 && n <= 20) out.add(n);
  }
  return out;
}

function _v157_isWrongTitleStream(stream: any, meta: { title: string; year: string; isMovie: boolean }): boolean {
  if (!meta.isMovie || !meta.title) return false;
  const txt = ((stream && (stream.title || '')) + ' ' + (stream && (stream.name || ''))).trim();
  if (!txt) return false;

  // 1) YEAR CHECK
  const reqYearN = parseInt((meta.year || '').slice(0, 4), 10);
  if (!isNaN(reqYearN) && reqYearN >= 1900 && reqYearN <= 2099) {
    const yMatches = txt.match(/\\b(19\\d{2}|20\\d{2})\\b/g);
    if (yMatches && yMatches.length > 0) {
      const years = yMatches.map(y => parseInt(y, 10));
      let anyOk = false;
      for (const y of years) { if (Math.abs(y - reqYearN) <= 1) { anyOk = true; break; } }
      if (!anyOk) return true; // reject — year mismatch
    }
  }

  // 2/3) SEQUEL MARKER CHECK
  const reqSeq = _v157_extractSequelMarkers(meta.title);
  const strSeq = _v157_extractSequelMarkers(txt);
  if (reqSeq.size > 0) {
    // Requested has a marker.  If stream has marker(s) and none overlap, reject.
    if (strSeq.size > 0) {
      let overlap = false;
      for (const n of strSeq) { if (reqSeq.has(n)) { overlap = true; break; } }
      if (!overlap) return true;
    }
  } else {
    // Requested has NO marker.  If stream has one, reject.
    if (strSeq.size > 0) return true;
  }
  return false;
}

function sortStreamsByLanguage(streams: Stream[]): Stream[] {`,
);

// ============================================================
// STEP 2: Apply the filter at the very top of sortStreamsByLanguage.
// Anchor: the FIRST line inside the function (the PATCH_V16A comment).
// ============================================================
applyOnce(
  'p2_filter_inside_sort',
  'V157_FILTER_APPLIED',
  `function sortStreamsByLanguage(streams: Stream[]): Stream[] {
  // PATCH_V16A_COMMENTARY_SINK — local commentary detector. Independent of V12/V9.`,
  `function sortStreamsByLanguage(streams: Stream[]): Stream[] {
  // V157_FILTER_APPLIED — reject streams from other movies (wrong year /
  // wrong sequel volume) before any sort runs.  Conservative: only
  // applies for movies, never for series.  Reads _v157_currentMeta
  // which is set by the details component on every render.
  if (_v157_currentMeta.isMovie && _v157_currentMeta.title) {
    const _v157_before = streams.length;
    const _v157_kept: Stream[] = [];
    let _v157_rej = 0;
    for (const _s of streams) {
      if (_v157_isWrongTitleStream(_s as any, _v157_currentMeta)) { _v157_rej++; continue; }
      _v157_kept.push(_s);
    }
    if (_v157_rej > 0) {
      console.log('[v157] wrong-title filter for', JSON.stringify(_v157_currentMeta.title), 'year=', _v157_currentMeta.year, 'kept', _v157_kept.length + '/' + _v157_before, '(rejected', _v157_rej + ')');
    }
    streams = _v157_kept;
  }
  // PATCH_V16A_COMMENTARY_SINK — local commentary detector. Independent of V12/V9.`,
);

// ============================================================
// STEP 3: Move sortedStreams useMemo to AFTER the `content` declaration
// (where `content` actually exists), and add the meta-holder setter
// right before it.  Two replacements:
//   3a) Remove the original sortedStreams line at ~660 (above content).
//   3b) Add the meta-setter + sortedStreams just after content useState.
// ============================================================
applyOnce(
  'p3a_remove_old_sorted',
  'V157_SORTED_MOVED',
  `  const streams = useContentStore(s => s.streams);
  const isLoadingStreams = useContentStore(s => s.isLoadingStreams);
  const fetchStreams = useContentStore(s => s.fetchStreams);
  // PATCH_V19A_SORTED_MEMO — memoize the sorted streams list.
  const sortedStreams = useMemo(() => sortStreamsByLanguage(streams), [streams]);`,
  `  const streams = useContentStore(s => s.streams);
  const isLoadingStreams = useContentStore(s => s.isLoadingStreams);
  const fetchStreams = useContentStore(s => s.fetchStreams);
  // PATCH_V19A_SORTED_MEMO — memoize the sorted streams list.
  // V157_SORTED_MOVED — sortedStreams useMemo relocated to AFTER content
  // declaration so the meta filter has the current content's title+year
  // in scope.`,
);

applyOnce(
  'p3b_inject_sorted_after_content',
  'V157_META_INJECTED_HERE',
  `  const [content, setContent] = useState<ContentItem | null>(initialContent);`,
  `  const [content, setContent] = useState<ContentItem | null>(initialContent);
  // V157_META_INJECTED_HERE — synchronously update the module-level meta
  // holder BEFORE the sort useMemo runs.  This guarantees the title/year
  // guard in sortStreamsByLanguage sees the current content's name+year
  // on every render.
  try {
    _v157_currentMeta = {
      title: ((content && content.name) ? String(content.name) : (paramName ? String(paramName) : '')),
      year: ((content && (content as any).year) ? String((content as any).year) : ''),
      isMovie: (type === 'movie'),
    };
  } catch (_v157_e) { _v157_currentMeta = { title: '', year: '', isMovie: false }; }
  const sortedStreams = useMemo(
    () => sortStreamsByLanguage(streams),
    [streams, _v157_currentMeta.title, _v157_currentMeta.year, _v157_currentMeta.isMovie]
  );`,
);

if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT')) {
  console.log('[v157] Already applied — no changes written.');
} else {
  fs.writeFileSync(idPath, src, 'utf8');
  console.log(`[v157] Wrote ${idPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v157] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
