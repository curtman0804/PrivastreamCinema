/* eslint-disable */
// apply_patches_v19a2.js — V19-A retry: parseStreamInfo cache via line-scan
// Run from project root:   node apply_patches_v19a2.js
//
// V19-A failed on the user's file because the multi-line comment+function
// anchor "// Parse stream info helper..." + "function parseStreamInfo..."
// didn't match — likely the comment line differs slightly. The other 5
// edits in V19-A succeeded but were rolled back because of the failures.
//
// V19-A2 redoes ALL 6 edits using single-line anchors and brace-tracking
// for the parseStreamInfo cache, so it works regardless of comment format.

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(DETAILS)) { bad('details file not found'); process.exit(1); }

let src = fs.readFileSync(DETAILS, 'utf8');
const orig = src;
const bak = DETAILS + '.bak.v19a2.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

// Normalize CRLF → LF for matching, restore on save.
const _origHadCRLF = src.indexOf('\r\n') >= 0;
if (_origHadCRLF) { src = src.replace(/\r\n/g, '\n'); info('normalized CRLF → LF for matching (will restore on save)'); }

console.log('\n=== Patching ' + DETAILS + ' ===');

// =====================================================================
// PART 1: parseStreamInfo WeakMap cache (line-scan version)
// =====================================================================
{
  const MARKER = 'PATCH_V19A_PARSE_CACHE';
  if (src.includes(MARKER)) {
    ok('parseStreamInfo cache already in place');
  } else {
    const lines = src.split('\n');

    // 1a. Find the parseStreamInfo function declaration line
    const fnIdx = lines.findIndex(l => /^function\s+parseStreamInfo\s*\(\s*stream\s*:\s*Stream\s*\)\s*\{/.test(l.trim()) || /function\s+parseStreamInfo\s*\(stream:\s*Stream\)\s*\{/.test(l));
    if (fnIdx < 0) {
      bad('could not find parseStreamInfo function declaration line');
    } else {
      // 1b. Find the matching close brace by tracking depth
      let depth = 0, fnEnd = -1, sawOpen = false;
      for (let i = fnIdx; i < lines.length; i++) {
        for (const ch of lines[i]) {
          if (ch === '{') { depth++; sawOpen = true; }
          else if (ch === '}') { depth--; if (sawOpen && depth === 0) { fnEnd = i; break; } }
        }
        if (fnEnd >= 0) break;
      }
      if (fnEnd < 0) {
        bad('could not find parseStreamInfo close brace');
      } else {
        // 1c. Find the LAST `return ...;` in the function body (the actual return)
        let returnIdx = -1;
        for (let i = fnEnd - 1; i > fnIdx; i--) {
          if (/^\s*return\s+/.test(lines[i])) { returnIdx = i; break; }
        }
        if (returnIdx < 0) {
          bad('could not find return statement inside parseStreamInfo');
        } else {
          // 1d. Capture the full return statement (may span multiple lines via { ... })
          // For our purposes, the return is a single line ending with `};`.
          // Read until we see a `;` at the end.
          let returnEnd = returnIdx;
          while (returnEnd < fnEnd && !/;\s*$/.test(lines[returnEnd])) returnEnd++;
          const fullReturn = lines.slice(returnIdx, returnEnd + 1).join('\n');

          // Extract the object body from the return statement.
          // e.g. "  return { quality, source, ... };"  →  "{ quality, source, ... }"
          const m = fullReturn.match(/return\s+(\{[\s\S]*\});\s*$/);
          if (!m) {
            bad('could not parse return-object body in parseStreamInfo');
          } else {
            const objBody = m[1];
            // 1e. Insert cache decl + cache-hit check + cache-set + return
            // First: insert WeakMap declaration BEFORE the function line
            const cacheDecl = [
              '// ' + MARKER + ' — module-level WeakMap cache for parseStreamInfo. The same',
              '// stream object is parsed only once. Massive win during progressive stream',
              '// loading where sort/render touches the same streams 5-10x.',
              'const _parseStreamInfoCache = new WeakMap<Stream, any>();',
              '',
            ];
            // Capture indent of the function line (usually 0)
            // Then insert the cache hit check as the FIRST line inside the function
            const fnIndent = (lines[fnIdx].match(/^(\s*)/) || ['', ''])[1];
            const innerIndent = fnIndent + '  ';
            const cacheCheck = [
              innerIndent + '{',
              innerIndent + '  const _v19Cached = _parseStreamInfoCache.get(stream);',
              innerIndent + '  if (_v19Cached) return _v19Cached;',
              innerIndent + '}',
            ];
            // Replace the return statement with cached version
            const newReturn = [
              innerIndent + 'const _v19Result = ' + objBody + ';',
              innerIndent + '_parseStreamInfoCache.set(stream, _v19Result);',
              innerIndent + 'return _v19Result;',
            ];

            // Apply changes in REVERSE order (so indices stay valid):
            //   1. replace returnIdx..returnEnd with newReturn
            //   2. insert cacheCheck right after fnIdx
            //   3. insert cacheDecl right BEFORE fnIdx
            lines.splice(returnIdx, returnEnd - returnIdx + 1, ...newReturn);
            lines.splice(fnIdx + 1, 0, ...cacheCheck);
            lines.splice(fnIdx, 0, ...cacheDecl);

            src = lines.join('\n');
            ok('inserted parseStreamInfo WeakMap cache (decl + check + cache-set)');
          }
        }
      }
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
    const newFlatListData = "                  data={sortedStreams}";
    if (src.includes(oldFlatListData)) {
      src = src.replace(oldFlatListData, newFlatListData);
      ok('FlatList now uses memoized sortedStreams');
    } else {
      info('FlatList data prop already changed or differs — skipping');
    }

    const oldPlayBtn = "                    onPress={() => {\n                      const sorted = sortStreamsByLanguage(streams);\n                      if (sorted[0]) handleStreamSelect(sorted[0]);\n                    }}";
    const newPlayBtn = "                    onPress={() => {\n                      if (sortedStreams[0]) handleStreamSelect(sortedStreams[0]);\n                    }}";
    if (src.includes(oldPlayBtn)) {
      src = src.replace(oldPlayBtn, newPlayBtn);
      ok('Play button now uses memoized sortedStreams');
    } else {
      info('Play button onPress already changed or differs — skipping');
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
    // Try the multi-line anchor first; fall back to single-line if needed.
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
      // Find StreamCard close: `</Pressable>\n  );\n}\n` followed by something
      // Most reliable: the `}` at the end of StreamCard precedes the next
      // `// Episode` or `function EpisodeCard`. Find a unique closing pattern.
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
        bad('could not find StreamCard close + next-component anchor — REVERTING wrapper');
        // Revert the rename to keep file valid
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
} else {
  console.log('\nV19-A2 done. Rebuild — V19 perf trio complete.');
}
