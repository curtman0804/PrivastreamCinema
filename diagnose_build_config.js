/* eslint-disable */
// diagnose_build_config.js — Check JS engine, architecture, and build flags.
// These config-level settings dominate over any JS-level patch on Android TV.
//
// Run from repo root:
//   node diagnose_build_config.js
//
// Writes build_config_dump.txt.

const fs = require('fs');
const path = require('path');

const out = [];
function w(s) { out.push(s); }

function dump(F, full = false) {
  w('================================================================');
  w('=== FILE: ' + F);
  w('================================================================');
  if (!fs.existsSync(F)) { w('  (NOT FOUND)'); w(''); return null; }
  const raw = fs.readFileSync(F, 'utf8');
  const text = raw.replace(/\r\n/g, '\n');
  if (full) {
    const lines = text.split('\n');
    lines.forEach((l, i) => w(String(i + 1).padStart(4, ' ') + ' | ' + l));
  } else {
    w(text);
  }
  w('');
  return text;
}

// 1. app.json — controls jsEngine, newArchEnabled
const appJsonText = dump(path.join('frontend', 'app.json'), true);

// 2. package.json — check for Hermes / RN version
const pkgJsonText = dump(path.join('frontend', 'package.json'), true);

// 3. android/gradle.properties — has hermesEnabled and newArchEnabled
dump(path.join('frontend', 'android', 'gradle.properties'), true);

// 4. android/app/build.gradle — check enableHermes + hermesCommand
const buildGradlePath = path.join('frontend', 'android', 'app', 'build.gradle');
if (fs.existsSync(buildGradlePath)) {
  const raw = fs.readFileSync(buildGradlePath, 'utf8');
  const text = raw.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  w('================================================================');
  w('=== FILE: ' + buildGradlePath + ' (HERMES + ARCHITECTURE LINES ONLY)');
  w('================================================================');
  lines.forEach((l, i) => {
    if (/hermes|enableHermes|newArchEnabled|enableProguard|jsEngine/i.test(l)) {
      w('  L' + (i + 1) + ': ' + l);
    }
  });
  w('');
}

// 5. eas.json (if exists)
dump(path.join('frontend', 'eas.json'), true);

// === SUMMARY ===
w('================================================================');
w('=== AUTO-DIAGNOSIS ===');
w('================================================================');

let hermesEnabled = null;
let newArchEnabled = null;
let rnVersion = null;
let expoVersion = null;

if (appJsonText) {
  try {
    const app = JSON.parse(appJsonText);
    hermesEnabled = app.expo?.jsEngine === 'hermes';
    if (app.expo?.jsEngine === undefined) hermesEnabled = 'DEFAULT (likely hermes on modern Expo)';
    newArchEnabled = !!app.expo?.newArchEnabled;
    w('app.json → expo.jsEngine = ' + (app.expo?.jsEngine || 'NOT SET'));
    w('app.json → expo.newArchEnabled = ' + (app.expo?.newArchEnabled ?? 'NOT SET'));
    w('app.json → expo.android = ' + JSON.stringify(app.expo?.android || {}).slice(0, 200));
  } catch (e) { w('  (could not parse app.json: ' + e.message + ')'); }
}

if (pkgJsonText) {
  try {
    const pkg = JSON.parse(pkgJsonText);
    rnVersion = pkg.dependencies?.['react-native'];
    expoVersion = pkg.dependencies?.['expo'];
    w('package.json → react-native = ' + rnVersion);
    w('package.json → expo = ' + expoVersion);
    w('package.json → react-native-screens = ' + (pkg.dependencies?.['react-native-screens'] || 'NOT INSTALLED'));
  } catch (e) { w('  (could not parse package.json: ' + e.message + ')'); }
}

w('');
w('HERMES status:        ' + hermesEnabled);
w('NEW ARCHITECTURE:     ' + newArchEnabled);
w('');
w('If HERMES is false/unset and RN >= 0.70 → enabling Hermes gives 2-3x perf.');
w('If newArchEnabled is false → bridge is the bottleneck on Android TV.');

fs.writeFileSync('build_config_dump.txt', out.join('\n'), 'utf8');
console.log('Dump written: build_config_dump.txt');
console.log('Share it back so we know your JS engine + arch + RN version.');
