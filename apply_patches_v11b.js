/* eslint-disable */
// apply_patches_v11b.js
// Run from project root:   node apply_patches_v11b.js
//
// V11 left two issues that broke the JS bundle / left perf untuned:
//   (a) EpisodeCard's memo() call was never closed: line 399 is `}` instead
//       of `});`. The bundle fails because `memo(function EpisodeCardImpl(){...}`
//       has no matching close parenthesis.
//   (b) The Stream + Episode FlatLists weren't virtualized — V11's text match
//       didn't account for slight indentation differences in the user's file.
//
// V11b fixes both surgically.

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
const bak = DETAILS + '.bak.v11b.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

console.log('\n=== Patching ' + DETAILS + ' ===');

// ----------------------------------------------------------------
// 1. Close the EpisodeCard memo() call.
//    The JSX returns inside EpisodeCardImpl close with:
//      </Pressable>
//    );
//  }                  ← this line needs to be  });
//
//  export default function DetailsScreen() {
// ----------------------------------------------------------------
{
  const MARKER = 'PATCH_V11B_FIX_EPISODECARD_CLOSE';
  if (src.includes(MARKER)) {
    ok('EpisodeCard close already fixed');
  } else {
    // Match the unique sequence: `</Pressable>\n  );\n}\n\nexport default function DetailsScreen`
    // and rewrite the lone `}` to `});` since this is closing memo(function …).
    const oldClose = "    </Pressable>\n  );\n}\n\nexport default function DetailsScreen()";
    const newClose = "    </Pressable>\n  );\n}); // " + MARKER + "\n\nexport default function DetailsScreen()";
    if (src.includes(oldClose)) {
      src = src.replace(oldClose, newClose);
      ok('EpisodeCard memo() now closed with `});`');
    } else {
      bad('could not find EpisodeCard close anchor; expected </Pressable>); } before DetailsScreen');
    }
  }
}

// ----------------------------------------------------------------
// 2. Virtualize the EPISODE FlatList — match flexibly on the renderItem
//    signature, regardless of leading whitespace.
// ----------------------------------------------------------------
{
  const MARKER = 'PATCH_V11B_VIRT_EPISODES';
  if (src.includes(MARKER)) {
    ok('episode FlatList already virtualized');
  } else {
    // Find the JSX block by anchoring on the exact data prop.
    const re = /(<FlatList\s*\n(\s*)data=\{episodesForSeason\}\n[\s\S]*?contentContainerStyle=\{styles\.episodesList\}\n)(\s*)\/>/m;
    const m = src.match(re);
    if (!m) {
      bad('could not locate episode FlatList block');
    } else {
      const innerIndent = m[2]; // e.g. "                "
      const closeIndent = m[3];
      const props = [
        innerIndent + "removeClippedSubviews={true}",
        innerIndent + "windowSize={5}",
        innerIndent + "initialNumToRender={4}",
        innerIndent + "maxToRenderPerBatch={4}",
        innerIndent + "updateCellsBatchingPeriod={50}",
      ].join('\n');
      const replacement =
        "{/* " + MARKER + " */}\n" +
        innerIndent.replace(/^/, m[2].slice(0, m[2].length - 2)) /* one level out */ +
        m[1] + props + "\n" + closeIndent + "/>";
      // Simpler: just inject the props before the closing /> instead of rebuilding.
      const block = m[0];
      const newBlock = block.replace(
        /\n(\s*)\/>$/m,
        "\n" + props + "\n$1/>"
      ).replace(
        /^<FlatList/,
        "{/* " + MARKER + " */}\n" + m[2].slice(0, Math.max(0, m[2].length - 2)) + "<FlatList"
      );
      src = src.replace(block, newBlock);
      ok('episode FlatList virtualized (props injected)');
    }
  }
}

// ----------------------------------------------------------------
// 3. Virtualize the STREAM FlatList — match flexibly on data={sortedStreams}.
// ----------------------------------------------------------------
{
  const MARKER = 'PATCH_V11B_VIRT_STREAMS';
  if (src.includes(MARKER)) {
    ok('stream FlatList already virtualized');
  } else {
    const re = /(<FlatList\s*\n(\s*)data=\{sortedStreams\}\n[\s\S]*?contentContainerStyle=\{styles\.streamsList\}\n)(\s*)\/>/m;
    const m = src.match(re);
    if (!m) {
      bad('could not locate stream FlatList block');
    } else {
      const innerIndent = m[2];
      const block = m[0];
      const props = [
        innerIndent + "removeClippedSubviews={true}",
        innerIndent + "windowSize={5}",
        innerIndent + "initialNumToRender={4}",
        innerIndent + "maxToRenderPerBatch={4}",
        innerIndent + "updateCellsBatchingPeriod={50}",
      ].join('\n');
      const newBlock = block.replace(
        /\n(\s*)\/>$/m,
        "\n" + props + "\n$1/>"
      ).replace(
        /^<FlatList/,
        "{/* " + MARKER + " */}\n" + m[2].slice(0, Math.max(0, m[2].length - 2)) + "<FlatList"
      );
      src = src.replace(block, newBlock);
      ok('stream FlatList virtualized (props injected)');
    }
  }
}

// Save
if (src !== orig) {
  fs.writeFileSync(DETAILS, src, 'utf8');
  ok('saved ' + DETAILS);
} else {
  info('no changes — already patched or anchors not found');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nSome patches failed. Originals are safe in .bak files.');
  process.exit(1);
} else {
  console.log('\nV11b done. Now rebuild — bundle should succeed and details should feel snappier.');
}
