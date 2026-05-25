// apply_patches_v121d_play_wait.js
//
// Eliminates the first-click "orange screen" race by making the Play button:
//   1. Check if any stream in the current list has a backend-resolved URL
//      (url / externalUrl / direct_url - these are pre-resolved Premiumize
//      direct HTTPS URLs set by the v121 backend block).
//   2. If NO resolved stream is yet present, do a fresh fetch to
//      /api/streams/{type}/{id} (the backend's curated endpoint), wait
//      for it, then pick the top stream.
//   3. If still nothing resolved (PM is dead / no cache), fall back to the
//      best stream available so the user gets the chance to pick a stream
//      card manually if the auto-pick fails.
//
// This guarantees the Play button NEVER fires before the backend has had a
// chance to identify a working cached stream.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v121d_play_wait.js
//
// Idempotent.

const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = '/* v121d-play-wait */';

function die(msg) { console.error('[v121d] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(TARGET)) die('cannot find ' + TARGET + ' - run from frontend root.');

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARKER)) {
  console.log('[v121d] already applied - nothing to do.');
  process.exit(0);
}

// Anchor: the Play button's onPress that calls sortStreamsByLanguage(streams)
// then handleStreamSelect(sorted[0]). Whitespace flexible for CRLF and
// indentation variation.
const re = /onPress=\{\(\)\s*=>\s*\{\s*[\r\n]+\s*const\s+sorted\s*=\s*sortStreamsByLanguage\(streams\);\s*[\r\n]+\s*if\s*\(sorted\[0\]\)\s*handleStreamSelect\(sorted\[0\]\);\s*[\r\n]+\s*\}\}/;

if (!re.test(src)) die('could not find Play button onPress anchor.');

const replacement = `onPress={async () => {
                      /* v121d-play-wait */
                      // Wait for backend-resolved stream before playing to
                      // avoid the first-click race where Torrentio direct
                      // returns uncached streams before the backend has
                      // pre-resolved a cached one.
                      let cur = streams;
                      const hasResolved = (arr: any[]) => arr.some((s: any) => s && (s.url || s.externalUrl || s.direct_url));
                      if (!hasResolved(cur)) {
                        try {
                          const authToken = await AsyncStorage.getItem('auth_token');
                          const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || Constants.expoConfig?.extra?.backendUrl || '';
                          const encodedId = encodeURIComponent(id as string);
                          const resp = await fetch(\`\${backendUrl}/api/streams/\${type}/\${encodedId}\`, {
                            headers: authToken ? { Authorization: \`Bearer \${authToken}\` } : {},
                          });
                          if (resp.ok) {
                            const data = await resp.json();
                            if (Array.isArray(data?.streams) && data.streams.length > 0) {
                              cur = data.streams;
                            }
                          }
                        } catch (e) {
                          console.log('[v121d] backend fetch failed', e);
                        }
                      }
                      const sorted = sortStreamsByLanguage(cur);
                      if (sorted[0]) handleStreamSelect(sorted[0]);
                    }}`;

src = src.replace(re, replacement);

const bak = TARGET + '.bak.v121d';
if (!fs.existsSync(bak)) fs.copyFileSync(TARGET, bak);

fs.writeFileSync(TARGET, src, 'utf8');
console.log('[v121d] patched ' + TARGET);
console.log('[v121d] backup: ' + bak);
console.log('[v121d] OK - rebuild and sideload.');
