/* eslint-disable */
// diagnose_navigation.js — READ-ONLY. Dumps your navigation setup so I can
// write a precise back-navigation fix instead of guessing.
//
// Run from project root:   node diagnose_navigation.js

const fs = require('fs');
const path = require('path');

const FILES = [
  ['frontend/app/_layout.tsx',          'Root layout (navigation stack root)'],
  ['frontend/app/(tabs)/_layout.tsx',   'Tabs layout'],
  ['frontend/app/index.tsx',            'Initial route'],
  ['frontend/app/player.tsx',           'Player screen (first 60 lines + back-handler section)'],
  ['frontend/app/(tabs)/discover.tsx',  'Discover screen (first 50 lines)'],
  ['frontend/app/(tabs)/search.tsx',    'Search screen (first 50 lines)'],
  ['frontend/app/details/[type]/[id].tsx', 'Details screen — back/router refs only'],
];

console.log('\n========================================');
console.log('  NAVIGATION DIAGNOSTIC');
console.log('========================================\n');

for (const [f, label] of FILES) {
  console.log('───── ' + label + ' (' + f + ') ─────');
  if (!fs.existsSync(f)) {
    console.log('  ✗ FILE NOT FOUND');
    console.log('');
    continue;
  }
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split(/\r?\n/);

  // For each file, print the FIRST imports + any line containing navigation keywords
  const interesting = /BackHandler|router\.|navigation\.|useRouter|useNavigation|useFocusEffect|useNavigationContainerRef|CommonActions|StackActions|Stack\.Screen|Tabs\.Screen|<Stack|<Tabs|usePathname|exitApp|preventDefault|beforeRemove|hardwareBackPress/;

  // Print first 18 lines (imports + setup)
  console.log('  --- top of file (lines 1..18) ---');
  for (let i = 0; i < Math.min(18, lines.length); i++) {
    console.log('  ' + String(i+1).padStart(4) + ': ' + lines[i]);
  }

  // Print every other line containing nav-relevant keywords
  console.log('  --- navigation-related lines ---');
  let printed = 0;
  for (let i = 18; i < lines.length; i++) {
    if (interesting.test(lines[i])) {
      console.log('  ' + String(i+1).padStart(4) + ': ' + lines[i]);
      printed++;
      if (printed > 40) { console.log('  (... truncated ...)'); break; }
    }
  }
  console.log('');
}

console.log('========================================');
console.log('  Send this entire output back so I can write a precise V29.');
console.log('========================================');
