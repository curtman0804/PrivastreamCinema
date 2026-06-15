// diag_v214_details.js — upload just the details screen file
const fs = require('fs');
const path = require('path');
const https = require('https');

const HOST = 'git-update-staging.preview.emergentagent.com';
const LOCAL = path.join(process.cwd(), 'app/details/[type]/[id].tsx');
const REMOTE = 'b14_details_type_id.tsx';

if (!fs.existsSync(LOCAL)) { console.log('[ERR] not found: ' + LOCAL); process.exit(1); }
const content = fs.readFileSync(LOCAL);
const boundary = '----diag214-' + Math.random().toString(36).slice(2);
const head = '--' + boundary + '\r\n' +
  'Content-Disposition: form-data; name="file"; filename="' + REMOTE + '"\r\n' +
  'Content-Type: application/octet-stream\r\n\r\n';
const tail = '\r\n--' + boundary + '--\r\n';
const body = Buffer.concat([Buffer.from(head, 'utf8'), content, Buffer.from(tail, 'utf8')]);

const req = https.request({
  hostname: HOST, port: 443, path: '/api/upload_user_file', method: 'POST',
  headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length },
}, (res) => {
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => {
    console.log(res.statusCode === 200 ? '[ok] uploaded — tell agent "v214 details uploaded"' : '[err] ' + res.statusCode + ' ' + d.slice(0, 200));
  });
});
req.on('error', e => console.log('[err] ' + e.message));
req.write(body); req.end();
