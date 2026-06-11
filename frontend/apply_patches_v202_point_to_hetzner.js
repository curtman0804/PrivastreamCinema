/*
 * apply_patches_v202_point_to_hetzner.js
 *
 * THE BUG, FINALLY: src/api/client.ts hardcodes
 *     const BACKEND_URL = 'http://71.9.152.146:8001';
 * — the OLD home server. The Firestick app never talked to the Hetzner
 * backend, so every server-side cache fix was invisible. The old server
 * still runs the ancient 5-minute in-memory discover cache, which is why
 * posters only appeared after force-stop + clear-data + re-login.
 *
 * Fix: point the app at the production Hetzner backend over HTTPS:
 *     https://api.privastreamsolutions.com
 * (verified live: /nginx-health -> 200 "nginx-ok")
 *
 * Idempotent (V202_HETZNER_URL marker). CRLF-safe. Backs up client.ts.
 *
 * Usage (Windows CMD):
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   node apply_patches_v202_point_to_hetzner.js
 *   npx expo run:android --device
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const clientFile = [
  path.join(ROOT, 'src', 'api', 'client.ts'),
  path.join(ROOT, 'src', 'api', 'client.js'),
].find(f => fs.existsSync(f));
if (!clientFile) { console.error('[v202] FATAL: src/api/client.ts not found'); process.exit(1); }

const raw = fs.readFileSync(clientFile, 'utf8');
const eol = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
let text = eol === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;

if (text.indexOf('V202_HETZNER_URL') !== -1) {
  console.log('[v202] already applied — BACKEND_URL points to Hetzner.');
  process.exit(0);
}

const oldLine = "const BACKEND_URL = 'http://71.9.152.146:8001';";
if (text.indexOf(oldLine) === -1) {
  // Catch any other hardcoded value just in case
  const re = /const BACKEND_URL = '[^']+';/;
  if (!re.test(text)) { console.error('[v202] FATAL: BACKEND_URL line not found in client.ts'); process.exit(2); }
  text = text.replace(re, "const BACKEND_URL = 'https://api.privastreamsolutions.com'; // V202_HETZNER_URL — production Hetzner backend");
} else {
  text = text.replace(oldLine, "const BACKEND_URL = 'https://api.privastreamsolutions.com'; // V202_HETZNER_URL — production Hetzner backend");
}

const bak = clientFile + '.v202.bak';
if (!fs.existsSync(bak)) fs.writeFileSync(bak, raw, 'utf8');
fs.writeFileSync(clientFile, eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text, 'utf8');
console.log('[v202] client.ts: BACKEND_URL -> https://api.privastreamsolutions.com');
console.log('');
console.log('[v202] Done. Next:');
console.log('  npx expo run:android --device');
console.log('');
console.log('Then log in and test install/uninstall — posters should appear/vanish in seconds.');
