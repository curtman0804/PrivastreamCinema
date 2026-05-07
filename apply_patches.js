/**
 * Privastream Frontend Patch Tool (Node.js — for users without Python)
 * ====================================================================
 *
 * Usage on Windows CMD (from the repo root):
 *   cd C:\Users\Curtm\PrivastreamCinema
 *   curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches.js -o apply_patches.js
 *   node apply_patches.js
 *
 * Idempotent — safe to run multiple times.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO_ROOT = process.cwd();
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const DETAILS = path.join(FRONTEND, 'app', 'details', '[type]', '[id].tsx');
const PLAYER = path.join(FRONTEND, 'app', 'player.tsx');
const BASE = 'https://git-update-staging.preview.emergentagent.com/api/raw/';

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function fail(msg) {
  console.error('\nERROR:', msg);
  console.error("Make sure you are in the repo root (where 'frontend\\' lives).");
  process.exit(1);
}

(async () => {
  if (!fs.existsSync(FRONTEND)) fail(`Could not find ${FRONTEND}`);
  if (!fs.existsSync(DETAILS)) fail(`Could not find ${DETAILS}`);
  if (!fs.existsSync(PLAYER))  fail(`Could not find ${PLAYER}`);

  // ---------- 1. Pull latest player.tsx ----------
  console.log('[1] Downloading latest player.tsx ...');
  fs.copyFileSync(PLAYER, PLAYER + '.bak');
  const buf = await download(BASE + 'player.tsx');
  fs.writeFileSync(PLAYER, buf);
  console.log(`    OK (${buf.length.toLocaleString()} bytes). Backup: player.tsx.bak\n`);

  // ---------- 2. Patch details file ----------
  console.log('[2] Patching details/[type]/[id].tsx ...');
  fs.copyFileSync(DETAILS, DETAILS + '.bak');
  let content = fs.readFileSync(DETAILS, 'utf-8');

  // 2a: Ensure BackHandler import (and dedupe)
  const importLine = "import { BackHandler } from 'react-native';";
  const importMatches = content.split(importLine).length - 1;
  if (importMatches === 0) {
    content = importLine + '\n' + content;
    console.log('    [2a] BackHandler import added');
  } else if (importMatches > 1) {
    let firstSeen = false;
    content = content.split('\n').filter((line) => {
      if (line.trim() === importLine) {
        if (firstSeen) return false;
        firstSeen = true;
      }
      return true;
    }).join('\n');
    console.log(`    [2a] Deduped ${importMatches - 1} extra BackHandler import(s)`);
  } else {
    console.log('    [2a] BackHandler import OK');
  }

  // 2b: Add selectedSeason/Episode to LHS destructure
  if (!content.includes('paramSelectedSeason')) {
    const token = 'autoPlay: autoPlayParam,';
    if (content.includes(token)) {
      content = content.replace(
        token,
        token +
          '\n    selectedSeason: paramSelectedSeason,' +
          '\n    selectedEpisode: paramSelectedEpisode,'
      );
      console.log('    [2b] LHS destructure: selectedSeason / selectedEpisode added');
    } else {
      console.log('    [2b] WARN: could not find autoPlay destructure to anchor');
    }
  } else {
    console.log('    [2b] paramSelectedSeason already present');
  }

  // 2c: Type definitions
  if (!content.includes('selectedSeason?: string;')) {
    const m = content.match(/(useLocalSearchParams<\{[\s\S]*?)(\n\s*\}\s*>\s*\(\s*\)\s*;)/);
    if (m) {
      const addition = '\n    selectedSeason?: string;\n    selectedEpisode?: string;';
      const idx = m.index + m[1].length;
      content = content.slice(0, idx) + addition + content.slice(idx);
      console.log('    [2c] Type defs added');
    } else {
      console.log('    [2c] WARN: could not find type close');
    }
  } else {
    console.log('    [2c] Type defs already present');
  }

  // 2d: currentEpisodeMeta + nextEpisodeBackdrop
  const old_v1 =
    "    const nextEpisodeData = nextEpisode ? {\n" +
    "      nextEpisodeId: `${baseId}:${nextEpisode.season}:${nextEpisode.episode}`,\n" +
    "      nextEpisodeTitle: `S${nextEpisode.season}E${nextEpisode.episode} - ${nextEpisode.name || 'Next Episode'}`,\n" +
    "      seriesId: baseId || id,\n" +
    "      season: String(episodeSeason),\n" +
    "      episode: String(episodeNumber),\n" +
    "    } : {};";
  const old_v2 =
    "    const nextEpisodeData = nextEpisode ? {\n" +
    "      nextEpisodeId: `${baseId}:${nextEpisode.season}:${nextEpisode.episode}`,\n" +
    "      nextEpisodeTitle: `S${nextEpisode.season}E${nextEpisode.episode} - ${nextEpisode.name || 'Next Episode'}`,\n" +
    "    } : {};";
  const new_block =
    "    const currentEpisodeMeta = type === 'series' ? {\n" +
    "      seriesId: baseId || id,\n" +
    "      season: String(episodeSeason),\n" +
    "      episode: String(episodeNumber),\n" +
    "      episodeName: currentEpisode?.name || '',\n" +
    "    } : {};\n" +
    "\n" +
    "    const nextEpisodeData = nextEpisode ? {\n" +
    "      nextEpisodeId: `${baseId}:${nextEpisode.season}:${nextEpisode.episode}`,\n" +
    "      nextEpisodeTitle: `S${nextEpisode.season}E${nextEpisode.episode} - ${nextEpisode.name || 'Next Episode'}`,\n" +
    "      nextEpisodeBackdrop: nextEpisode.thumbnail || content?.background || '',\n" +
    "    } : {};";

  if (!content.includes('currentEpisodeMeta')) {
    if (content.includes(old_v1)) {
      content = content.replace(old_v1, new_block);
      console.log('    [2d] currentEpisodeMeta + nextEpisodeBackdrop added (v1)');
    } else if (content.includes(old_v2)) {
      content = content.replace(old_v2, new_block);
      console.log('    [2d] currentEpisodeMeta + nextEpisodeBackdrop added (v2)');
    } else {
      console.log('    [2d] WARN: could not find nextEpisodeData block');
    }
  } else {
    if (!content.includes('nextEpisodeBackdrop') && content.includes(old_v2)) {
      content = content.replace(old_v2, new_block);
      console.log('    [2d+] nextEpisodeBackdrop added to existing nextEpisodeData');
    } else {
      console.log('    [2d] currentEpisodeMeta already present');
    }
  }

  // 2e: Spread ...currentEpisodeMeta before ...nextEpisodeData
  if (!content.includes('...currentEpisodeMeta,')) {
    const spread_old = '          ...nextEpisodeData,';
    const spread_new = '          ...currentEpisodeMeta,\n          ...nextEpisodeData,';
    const n2e = (content.match(new RegExp(spread_old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    content = content.split(spread_old).join(spread_new);
    console.log(`    [2e] inserted ...currentEpisodeMeta in ${n2e} push blocks`);
  } else {
    console.log('    [2e] currentEpisodeMeta spread already present');
  }

  // 2f: Episode thumbnail backdrop fallback
  const bd_old = "backdrop: content?.background || '',";
  const bd_new = "backdrop: (type === 'series' && currentEpisode?.thumbnail) || content?.background || '',";
  if (!content.includes(bd_new)) {
    const n2f = (content.match(new RegExp(bd_old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    content = content.split(bd_old).join(bd_new);
    if (n2f > 0) console.log(`    [2f] backdrop -> currentEpisode.thumbnail in ${n2f} places`);
    else console.log('    [2f] no backdrop lines to update');
  } else {
    console.log('    [2f] episode-thumbnail backdrop already wired');
  }

  // 2g: Replace router.back() in the back button
  const btn_old = "onPress={() => router.back()}";
  const btn_new = "onPress={handleBack}";
  if (!content.includes(btn_new) && content.includes(btn_old)) {
    content = content.replace(btn_old, btn_new);
    console.log('    [2g] back button -> handleBack');
  } else {
    console.log('    [2g] back button already wired to handleBack');
  }

  // 2h: Inject the BackHandler interception block
  if (!content.includes('goToSeriesRootWithFocus')) {
    const inject =
      "\n" +
      "  // === ANDROID-TV BACK BUTTON FIX =========================================\n" +
      "  // Hardware back from any episode-details page teleports straight to the\n" +
      "  // SERIES ROOT page (with selectedSeason / selectedEpisode set) regardless\n" +
      "  // of how polluted the navigation stack got from auto-binge-watching.\n" +
      "  const goToSeriesRootWithFocus = useCallback(() => {\n" +
      "    const idStr = (id as string) || '';\n" +
      "    if (!idStr.includes(':')) return false;\n" +
      "    const parts = idStr.split(':');\n" +
      "    const baseIdLocal = parts[0] || idStr;\n" +
      "    const s = parts[1] || '';\n" +
      "    const e = parts[2] || '';\n" +
      "    try {\n" +
      "      if (typeof (router as any).dismissAll === 'function') (router as any).dismissAll();\n" +
      "    } catch (_) {}\n" +
      "    setTimeout(() => {\n" +
      "      router.push({\n" +
      "        pathname: `/details/${type}/${baseIdLocal}`,\n" +
      "        params: { selectedSeason: s, selectedEpisode: e },\n" +
      "      });\n" +
      "    }, 30);\n" +
      "    return true;\n" +
      "  }, [id, type, router]);\n" +
      "\n" +
      "  const handleBack = useCallback(() => {\n" +
      "    if (!goToSeriesRootWithFocus()) router.back();\n" +
      "  }, [goToSeriesRootWithFocus, router]);\n" +
      "\n" +
      "  useEffect(() => {\n" +
      "    const sub = BackHandler.addEventListener('hardwareBackPress', () => goToSeriesRootWithFocus());\n" +
      "    return () => sub.remove();\n" +
      "  }, [goToSeriesRootWithFocus]);\n" +
      "  // ========================================================================\n" +
      "\n";

    let m = content.match(/selectedEpisode\?:\s*string;[\s\S]*?\}\s*>\s*\(\s*\)\s*;/);
    if (m) {
      const idx = m.index + m[0].length;
      content = content.slice(0, idx) + '\n' + inject + content.slice(idx);
      console.log('    [2h] BackHandler interception inserted');
    } else {
      const m2 = content.match(/\}\s*>\s*\(\s*\)\s*;/);
      if (m2) {
        const idx = m2.index + m2[0].length;
        content = content.slice(0, idx) + '\n' + inject + content.slice(idx);
        console.log('    [2h] BackHandler interception inserted (fallback anchor)');
      } else {
        console.log('    [2h] FAIL — could not find anchor for BackHandler block');
      }
    }
  } else {
    console.log('    [2h] BackHandler block already present');
  }

  // 2i: Season-init effect honors paramSelectedSeason
  const eff_old =
    "  useEffect(() => {\n" +
    "    if (seasons.length > 0 && !seasons.includes(selectedSeason)) {\n" +
    "      setSelectedSeason(seasons[0]);\n" +
    "    }\n" +
    "  }, [seasons]);";
  const eff_new =
    "  useEffect(() => {\n" +
    "    if (seasons.length === 0) return;\n" +
    "    const fromParam = paramSelectedSeason ? parseInt(paramSelectedSeason as string, 10) : NaN;\n" +
    "    if (!isNaN(fromParam) && seasons.includes(fromParam)) {\n" +
    "      if (selectedSeason !== fromParam) setSelectedSeason(fromParam);\n" +
    "      return;\n" +
    "    }\n" +
    "    if (!seasons.includes(selectedSeason)) {\n" +
    "      setSelectedSeason(seasons[0]);\n" +
    "    }\n" +
    "  }, [seasons, paramSelectedSeason]);";
  if (content.includes(eff_old)) {
    content = content.replace(eff_old, eff_new);
    console.log('    [2i] season-init effect now honors paramSelectedSeason');
  } else if (content.includes('fromParam')) {
    console.log('    [2i] season-init already updated');
  } else {
    console.log('    [2i] WARN: pattern not found');
  }

  fs.writeFileSync(DETAILS, content);
  console.log('[2] Saved.\n');

  // ---------- 3. Verify ----------
  console.log('[3] Verification:');
  const checks = [
    ['BackHandler import',           'import { BackHandler }',        1],
    ['handleBack defined',           'const handleBack',              1],
    ['BackHandler.addEventListener', 'BackHandler.addEventListener',  1],
    ['goToSeriesRootWithFocus',      'goToSeriesRootWithFocus',       3],
    ['paramSelectedSeason',          'paramSelectedSeason',           3],
    ['currentEpisodeMeta',           'currentEpisodeMeta',            5],
    ['nextEpisodeBackdrop',          'nextEpisodeBackdrop',           1],
    ['episode-thumbnail backdrop',   "currentEpisode?.thumbnail",     4],
    ['handleBack used',              'onPress={handleBack}',          1],
    ['season-init param fallback',   'fromParam',                     1],
  ];
  let allOk = true;
  for (const [name, needle, need] of checks) {
    const n = (content.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    const ok = n >= need;
    if (!ok) allOk = false;
    const marker = ok ? '[OK]  ' : '[FAIL]';
    console.log(`    ${marker} ${name.padEnd(35)} count=${n} need>=${need}`);
  }

  console.log();
  if (allOk) {
    console.log('==> All patches applied. Now rebuild your APK and test on Firestick.');
  } else {
    console.log('==> Some patches failed. Paste the full output and I will send a corrective patch.');
  }
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
