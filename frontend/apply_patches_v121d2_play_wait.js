// apply_patches_v121d2_play_wait.js
//
// Replaces the Play button onPress so it waits for backend pre-resolved
// streams before firing. Eliminates the first-click "orange screen" race.
//
// Anchors on:
//   onPress={() => {
//     if (sortedStreams[0]) handleStreamSelect(sortedStreams[0]);
//   }
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v121d2_play_wait.js

const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = '/* v121d-play-wait */';

function die(msg) { console.error('[v121d2] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(TARGET)) die('cannot find ' + TARGET + ' - run from frontend root.');

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARKER)) {
  console.log('[v121d2] already applied - nothing to do.');
  process.exit(0);
}

// Match the simpler 1-line body. CRLF/whitespace flexible.
const re = /onPress=\{\(\)\s*=>\s*\{\s*[\r\n]+\s*if\s*\(sortedStreams\[0\]\)\s*handleStreamSelect\(sortedStreams\[0\]\);\s*[\r\n]+\s*\}\}/;

if (!re.test(src)) die('could not find Play button onPress anchor (v121d2 pattern).');

const replacement = `onPress={async () => {
                      /* v121d-play-wait */
                      // Wait for backend-resolved cached stream before
                      // firing. Without this, Torrentio direct returns
                      // uncached streams FAST, frontend shows Play, user
                      // taps it, picks an uncached stream, orange screen.
                      let pool = streams;
                      const hasResolved = (arr: any[]) =>
                        arr.some((s: any) => s && (s.url || s.externalUrl || s.direct_url));
                      if (!hasResolved(pool)) {
                        try {
                          const authToken = await AsyncStorage.getItem('auth_token');
                          const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL
                            || (Constants.expoConfig as any)?.extra?.backendUrl
                            || '';
                          const encodedId = encodeURIComponent(id as string);
                          const resp = await fetch(
                            \`\${backendUrl}/api/streams/\${type}/\${encodedId}\`,
                            { headers: authToken ? { Authorization: \`Bearer \${authToken}\` } : {} }
                          );
                          if (resp.ok) {
                            const data = await resp.json();
                            if (Array.isArray(data?.streams) && data.streams.length > 0) {
                              pool = data.streams;
                            }
                          }
                        } catch (e) {
                          console.log('[v121d] backend fetch failed', e);
                        }
                      }
                      const sorted = sortStreamsByLanguage(pool);
                      if (sorted[0]) handleStreamSelect(sorted[0]);
                    }}`;

src = src.replace(re, replacement);

const bak = TARGET + '.bak.v121d2';
if (!fs.existsSync(bak)) fs.copyFileSync(TARGET, bak);

fs.writeFileSync(TARGET, src, 'utf8');
console.log('[v121d2] patched ' + TARGET);
console.log('[v121d2] backup: ' + bak);
console.log('[v121d2] OK - rebuild and sideload.');
