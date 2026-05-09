/* eslint-disable */
// apply_patches_v19a3.js — V19-A retry #2: make parseStreamInfo cache
// best-effort so the other 5 perf wins always land, AND dump the actual
// parseStreamInfo function body so we can target it precisely in V20.
//
// V19-A2 failed on parseStreamInfo cache because the return-object regex
// didn't match — your return statement has a slightly different form than
// I assumed. The script then refused to save ALL changes. V19-A3 saves the
// 5 working changes (useMemo, FlatList, Play button, React.memo wrap)
// regardless of whether the cache injection works.
//
// Run from project root:   node apply_patches_v19a3.js

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const soft = (m) => { console.log('  [SKIP] ' + m + ' (best-effort)'); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(DETAILS)) { bad('details file not found'); process.exit(1); }

let src = fs.readFileSync(DETAILS, 'utf8');
const orig = src;
const bak = DETAILS + '.bak.v19a3.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

const _origHadCRLF = src.indexOf('\r\n') >= 0;
if (_origHadCRLF) { src = src.replace(/\r\n/g, '\n'); info('normalized CRLF → LF for matching (will restore on save)'); }

console.log('\n=== Patching ' + DETAILS + ' ===');

// =====================================================================
// PART 0: Dump parseStreamInfo body so we can see what it actually looks like
// =====================================================================
{
  const lines = src.split('\n');
  const fnIdx = lines.findIndex(l => /function\s+parseStreamInfo\s*\(\s*stream\s*:\s*Stream\s*\)/.test(l));
  if (fnIdx >= 0) {
    let depth = 0, fnEnd = -1, sawOpen = false;
    for (let i = fnIdx; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') { depth++; sawOpen = true; }
        else if (ch === '}') { depth--; if (sawOpen && depth === 0) { fnEnd = i; break; } }
      }
      if (fnEnd >= 0) break;
    }
    console.log('\n  ───── parseStreamInfo body (lines ' + (fnIdx+1) + '..' + (fnEnd+1) + ') ─────');
    if (fnEnd > fnIdx) {
      // Print only the LAST 20 lines of the function (the return area is what matters)
      const startPrint = Math.max(fnIdx, fnEnd - 20);
      if (startPrint > fnIdx) console.log('  (... ' + (startPrint - fnIdx) + ' lines omitted ...)');
      for (let i = startPrint; i <= fnEnd; i++) {
        console.log('  ' + String(i+1).padStart(4) + ': ' + lines[i]);
      }
    }
    console.log('  ─────────────────────────────────────────────\n');
  }
}

// =====================================================================
// PART 1: parseStreamInfo WeakMap cache — BEST EFFORT (won't block save)
// =====================================================================
let parseCacheApplied = false;
{
  const MARKER = 'PATCH_V19A_PARSE_CACHE';
  if (src.includes(MARKER)) {
    ok('parseStreamInfo cache already in place');
    parseCacheApplied = true;
  } else {
    try {
      const lines = src.split('\n');
      const fnIdx = lines.findIndex(l => /function\s+parseStreamInfo\s*\(\s*stream\s*:\s*Stream\s*\)/.test(l));
      if (fnIdx < 0) throw new Error('no parseStreamInfo declaration');

      let depth = 0, fnEnd = -1, sawOpen = false;
      for (let i = fnIdx; i < lines.length; i++) {
        for (const ch of lines[i]) {
          if (ch === '{') { depth++; sawOpen = true; }
          else if (ch === '}') { depth--; if (sawOpen && depth === 0) { fnEnd = i; break; } }
        }
        if (fnEnd >= 0) break;
      }
      if (fnEnd < 0) throw new Error('no close brace');

      // Find LAST `return ...;` statement (line-based)
      let returnIdx = -1;
      for (let i = fnEnd - 1; i > fnIdx; i--) {
        if (/^\s*return\s+/.test(lines[i])) { returnIdx = i; break; }
      }
      if (returnIdx < 0) throw new Error('no return statement');

      // Capture full return statement (may span multiple lines)
      let returnEnd = returnIdx;
      while (returnEnd < fnEnd && !/;\s*$/.test(lines[returnEnd])) returnEnd++;
      const fullReturn = lines.slice(returnIdx, returnEnd + 1).join('\n');

      // Try to extract whatever's between `return ` and `;` — could be { ... },
      // an identifier (e.g. `_result`), or any expression.
      const m = fullReturn.match(/return\s+([\s\S]+?);\s*$/);
      if (!m) throw new Error('return regex failed against: ' + JSON.stringify(fullReturn.slice(0, 80)));

      const exprBody = m[1].trim();
      const fnIndent = (lines[fnIdx].match(/^(\s*)/) || ['', ''])[1];
      const innerIndent = fnIndent + '  ';

      // Cache decl BEFORE function (top-level)
      const cacheDecl = [
        '// ' + MARKER + ' — module-level WeakMap cache for parseStreamInfo.',
        'const _parseStreamInfoCache = new WeakMap<Stream, any>();',
        '',
      ];
      // Cache hit at function entry
      const cacheCheck = [
        innerIndent + '{',
        innerIndent + '  const _v19Cached = _parseStreamInfoCache.get(stream);',
        innerIndent + '  if (_v19Cached) return _v19Cached;',
        innerIndent + '}',
      ];
      // Wrapped return
      const newReturn = [
        innerIndent + 'const _v19Result = ' + exprBody + ';',
        innerIndent + '_parseStreamInfoCache.set(stream, _v19Result);',
        innerIndent + 'return _v19Result;',
      ];

      // Apply in reverse-index order
      lines.splice(returnIdx, returnEnd - returnIdx + 1, ...newReturn);
      lines.splice(fnIdx + 1, 0, ...cacheCheck);
      lines.splice(fnIdx, 0, ...cacheDecl);
      src = lines.join('\n');
      ok('inserted parseStreamInfo WeakMap cache (decl + check + cache-set)');
      parseCacheApplied = true;
    } catch (e) {
      soft('parseStreamInfo cache injection skipped: ' + e.message);
      info('the other 5 perf wins will still apply. Send me the body dump above and I will ship a targeted V20 cache patch.');
    }
  }
}

// =====================================================================
// PART 2: useMemo the sorted streams + replace 2 inline call sites
// =====================================================================
{
  const MARKER = 'PATCH_V19A_SORTED_MEMO';
  if (src.includes(MARKER)) {
    ok('sortedStreams useMemo already in place');
  } else {
    const hookAnchor = "  const fetchStreams = useContentStore(s => s.fetchStreams);";
    if (!src.includes(hookAnchor)) {
      bad('could not find fetchStreams hook anchor for useMemo insertion');
    } else {
      const insertion = [
        "  const fetchStreams = useContentStore(s => s.fetchStreams);",
        "  // " + MARKER + " — memoize the sorted streams list.",
        "  const sortedStreams = useMemo(() => sortStreamsByLanguage(streams), [streams]);",
      ].join('\n');
      src = src.replace(hookAnchor, insertion);
      ok('added sortedStreams useMemo after fetchStreams hook');
    }

    const oldFlatListData = "                  data={sortStreamsByLanguage(streams)}";
    if (src.includes(oldFlatListData)) {
      src = src.replace(oldFlatListData, "                  data={sortedStreams}");
      ok('FlatList now uses memoized sortedStreams');
    } else {
      info('FlatList data prop already changed — skipping');
    }

    const oldPlayBtn = "                    onPress={() => {\n                      const sorted = sortStreamsByLanguage(streams);\n                      if (sorted[0]) handleStreamSelect(sorted[0]);\n                    }}";
    if (src.includes(oldPlayBtn)) {
      src = src.replace(oldPlayBtn, "                    onPress={() => {\n                      if (sortedStreams[0]) handleStreamSelect(sortedStreams[0]);\n                    }}");
      ok('Play button now uses memoized sortedStreams');
    } else {
      info('Play button onPress already changed — skipping');
    }
  }
}

// =====================================================================
// PART 3: Wrap StreamCard with React.memo
// =====================================================================
{
  const MARKER = 'PATCH_V19A_STREAMCARD_MEMO';
  if (src.includes(MARKER)) {
    ok('StreamCard already wrapped in React.memo');
  } else {
    const oldDecl1 = "// Stream Card Component - 3-row vertical layout\nfunction StreamCard({";
    const oldDecl2 = "function StreamCard({";

    let anchorMatched = null;
    if (src.includes(oldDecl1)) {
      const newDecl = "// Stream Card Component - 3-row vertical layout (" + MARKER + " React.memo)\nconst StreamCard = React.memo(function StreamCardInner({";
      src = src.replace(oldDecl1, newDecl);
      anchorMatched = newDecl;
      ok('StreamCard wrapped (multi-line anchor)');
    } else if (src.includes(oldDecl2)) {
      const newDecl = "// " + MARKER + " React.memo wrapper\nconst StreamCard = React.memo(function StreamCardInner({";
      src = src.replace(oldDecl2, newDecl);
      anchorMatched = newDecl;
      ok('StreamCard wrapped (single-line anchor)');
    } else {
      bad('could not find StreamCard function declaration to wrap');
    }

    if (anchorMatched) {
      const closeAnchors = [
        "    </Pressable>\n  );\n}\n\n// Episode Card Component",
        "    </Pressable>\n  );\n}\n\n// Episode",
        "    </Pressable>\n  );\n}\n\nfunction EpisodeCard",
      ];
      let closed = false;
      for (const ca of closeAnchors) {
        if (src.includes(ca)) {
          src = src.replace(ca, ca.replace(/\n\}\n/, '\n});\n'));
          ok('StreamCard close brace updated to React.memo closer');
          closed = true;
          break;
        }
      }
      if (!closed) {
        bad('could not find StreamCard close anchor — REVERTING wrapper to keep file valid');
        if (anchorMatched.includes('Stream Card Component')) {
          src = src.replace(anchorMatched, oldDecl1);
        } else {
          src = src.replace(anchorMatched, oldDecl2);
        }
      }
    }
  }
}

// Save (restoring CRLF if original was CRLF)
if (src !== orig && fail === 0) {
  const finalOut = _origHadCRLF ? src.replace(/\n/g, '\r\n') : src;
  fs.writeFileSync(DETAILS, finalOut, 'utf8');
  ok('saved ' + DETAILS);
} else if (fail > 0) {
  info('failures detected — file NOT saved (original preserved in ' + bak + ')');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Original is safe in ' + bak);
  process.exit(1);
} else if (!parseCacheApplied) {
  console.log('\nV19-A3 done — 5 of 6 wins applied. parseStreamInfo cache skipped.');
  console.log('SEND ME the parseStreamInfo body dump from above, and I will ship V20 to add it.');
} else {
  console.log('\nV19-A3 done. Full V19 perf trio complete.');
}
