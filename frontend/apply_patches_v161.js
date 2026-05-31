/* eslint-disable */
// apply_patches_v161_series_title_guard.js
//
// Extend the v157 wrong-content guard to SERIES.  v157 explicitly only
// runs for movies (`isMovie: type === 'movie'`).  Series get nothing —
// which is why clicking "How It's Made" can play "How the States Got
// Their Shapes" (or any other series whose name shares a few words).
//
// Strategy for series (movies untouched):
//   1) Tokenize the requested series title into significant words
//      (lowercase, alphanum-only, drop length<3 and common stopwords).
//   2) For each stream, take the title text BEFORE the first SxxExx
//      pattern (so we compare on the show name, not the episode/year/
//      resolution suffix).  Tokenize the same way.
//   3) REJECT the stream if ANY significant word from the meta title
//      is missing from the stream's series-name tokens.
//
//   Examples:
//     meta "How It's Made"   → required = ["how","made"]
//       "How.the.States.Got.Their.Shapes.S01E05" → has "how" but not "made" → REJECT
//       "How.Its.Made.S01E05.1080p"              → has both → KEEP
//     meta "Rick and Morty"  → required = ["rick","morty"]
//       "ThePirateBay • Rick and Morty S08E10"   → has both → KEEP
//       "Rick.and.Steve.S01E01"                  → missing "morty" → REJECT
//
// Idempotent.  CRLF-safe.
//
//   curl -L --fail -o apply_patches_v161.js "https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v161_series_title_guard.js?v=1" && node apply_patches_v161.js
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
  console.error('[v161] FATAL: app/details/[type]/[id].tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(idPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = idPath + '.bak_v161';
if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, src, 'utf8');

const reports = [];
function applyOnce(label, marker, oldStr, newStr) {
  if (marker && src.indexOf(marker) !== -1) {
    reports.push({ label, status: 'SKIP_IDEMPOTENT' });
    return;
  }
  const old2 = oldStr.replace(/\r?\n/g, NL);
  const new2 = newStr.replace(/\r?\n/g, NL);
  const occurrences = src.split(old2).length - 1;
  if (occurrences === 0) { reports.push({ label, status: 'NOT_FOUND' }); return; }
  if (occurrences > 1)  { reports.push({ label, status: 'AMBIGUOUS', count: occurrences }); return; }
  const before = src.length;
  src = src.replace(old2, new2);
  reports.push({ label, status: 'OK', delta: src.length - before });
}

// ============================================================
// STEP 1: Widen the _v157_currentMeta type and add the series-title
// helper.  Inject right after the _v157_isWrongTitleStream function.
// ============================================================
applyOnce(
  'p1_widen_meta_and_series_helper',
  'V161_SERIES_TITLE_GUARD',
  `let _v157_currentMeta: { title: string; year: string; isMovie: boolean } = {
  title: '', year: '', isMovie: false,
};`,
  `let _v157_currentMeta: { title: string; year: string; isMovie: boolean; isSeries: boolean; seriesWords: string[] } = {
  title: '', year: '', isMovie: false, isSeries: false, seriesWords: [],
};

// V161_SERIES_TITLE_GUARD — for series, build the set of required title
// words (length >= 3, non-stopword) and reject streams whose pre-SxxExx
// part is missing any of them.  Catches the "How It's Made" → "How the
// States Got Their Shapes" case.
const _V161_STOPWORDS = new Set(['the','and','for','from','your','that','this','with','into']);
function _v161_seriesTitleWords(title: string): string[] {
  if (!title) return [];
  // strip trailing year suffix like " (2001)"
  const stripped = title.replace(/\\s*\\(\\d{4}\\)\\s*$/, '');
  const tokens = stripped.toLowerCase().split(/[^a-z0-9]+/);
  return tokens.filter((w: string) => w.length >= 3 && !_V161_STOPWORDS.has(w));
}
function _v161_isWrongSeriesStream(stream: any, meta: { isSeries: boolean; seriesWords: string[] }): boolean {
  if (!meta.isSeries || !meta.seriesWords || meta.seriesWords.length === 0) return false;
  const raw = ((stream && (stream.title || '')) + ' ' + (stream && (stream.name || ''))).trim();
  if (!raw) return false;
  // Take the part BEFORE the first SxxExx so addon prefixes are kept
  // but episode/quality suffix is excluded.
  const m = raw.match(/^([\\s\\S]*?)\\bS\\d{1,2}E\\d{1,3}\\b/i);
  const head = m ? m[1] : raw;
  const headTokens = new Set(head.toLowerCase().split(/[^a-z0-9]+/).filter((w: string) => w.length >= 1));
  // Require ALL meta significant words to appear in the head tokens.
  for (const w of meta.seriesWords) {
    if (!headTokens.has(w)) return true; // reject
  }
  return false;
}`,
);

// ============================================================
// STEP 2: Apply the series filter inside sortStreamsByLanguage right
// after the existing movie filter block.
// ============================================================
applyOnce(
  'p2_filter_inside_sort',
  'V161_SERIES_FILTER_APPLIED',
  `    if (_v157_rej > 0) {
      console.log('[v157] wrong-title filter for', JSON.stringify(_v157_currentMeta.title), 'year=', _v157_currentMeta.year, 'kept', _v157_kept.length + '/' + _v157_before, '(rejected', _v157_rej + ')');
    }
    streams = _v157_kept;
  }`,
  `    if (_v157_rej > 0) {
      console.log('[v157] wrong-title filter for', JSON.stringify(_v157_currentMeta.title), 'year=', _v157_currentMeta.year, 'kept', _v157_kept.length + '/' + _v157_before, '(rejected', _v157_rej + ')');
    }
    streams = _v157_kept;
  }
  // V161_SERIES_FILTER_APPLIED — same idea as v157, but for series.
  // Reject streams whose pre-SxxExx prefix is missing any of the
  // required series-title words.
  if (_v157_currentMeta.isSeries && _v157_currentMeta.seriesWords && _v157_currentMeta.seriesWords.length > 0) {
    const _v161_before = streams.length;
    const _v161_kept: Stream[] = [];
    let _v161_rej = 0;
    for (const _s of streams) {
      if (_v161_isWrongSeriesStream(_s as any, _v157_currentMeta)) { _v161_rej++; continue; }
      _v161_kept.push(_s);
    }
    if (_v161_rej > 0) {
      console.log('[v161] series-title filter for', JSON.stringify(_v157_currentMeta.title), 'words=', JSON.stringify(_v157_currentMeta.seriesWords), 'kept', _v161_kept.length + '/' + _v161_before, '(rejected', _v161_rej + ')');
    }
    streams = _v161_kept;
  }`,
);

// ============================================================
// STEP 3: In the meta-setter inside the component, also populate
// isSeries + seriesWords.
// ============================================================
applyOnce(
  'p3_set_meta_series_fields',
  'V161_META_SERIES_FIELDS',
  `    _v157_currentMeta = {
      title: ((content && content.name) ? String(content.name) : (paramName ? String(paramName) : '')),
      year: ((content && (content as any).year) ? String((content as any).year) : ''),
      isMovie: (type === 'movie'),
    };
  } catch (_v157_e) { _v157_currentMeta = { title: '', year: '', isMovie: false }; }`,
  `    /* V161_META_SERIES_FIELDS */
    const _v161_title = ((content && content.name) ? String(content.name) : (paramName ? String(paramName) : ''));
    const _v161_isSeries = (type === 'series');
    _v157_currentMeta = {
      title: _v161_title,
      year: ((content && (content as any).year) ? String((content as any).year) : ''),
      isMovie: (type === 'movie'),
      isSeries: _v161_isSeries,
      seriesWords: _v161_isSeries ? _v161_seriesTitleWords(_v161_title) : [],
    };
  } catch (_v157_e) { _v157_currentMeta = { title: '', year: '', isMovie: false, isSeries: false, seriesWords: [] }; }`,
);

if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT')) {
  console.log('[v161] Already applied — no changes written.');
} else {
  fs.writeFileSync(idPath, src, 'utf8');
  console.log(`[v161] Wrote ${idPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v161] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
