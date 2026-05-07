"""
Privastream Frontend Patch Tool
================================

Run this from `C:\\Users\\Curtm\\PrivastreamCinema` (or wherever your repo is).
It will:
  1. Download the latest player.tsx from the preview URL.
  2. Apply ALL the in-flight patches to details/[type]/[id].tsx.
  3. Verify everything.

Usage on Windows CMD:
    cd C:\\Users\\Curtm\\PrivastreamCinema
    curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches.py -o apply_patches.py
    python apply_patches.py

Safe to run multiple times — every patch is idempotent.
"""

import os
import re
import shutil
import sys
import urllib.request

REPO_ROOT = os.getcwd()
FRONTEND = os.path.join(REPO_ROOT, "frontend")
DETAILS = os.path.join(FRONTEND, "app", "details", "[type]", "[id].tsx")
PLAYER = os.path.join(FRONTEND, "app", "player.tsx")
BASE = "https://git-update-staging.preview.emergentagent.com/api/raw/"


def fail(msg):
    print(f"\nERROR: {msg}")
    print("Make sure you are in the repo root (where 'frontend/' lives).")
    sys.exit(1)


def main():
    if not os.path.isdir(FRONTEND):
        fail(f"Could not find {FRONTEND}")
    if not os.path.isfile(DETAILS):
        fail(f"Could not find {DETAILS}")
    if not os.path.isfile(PLAYER):
        fail(f"Could not find {PLAYER}")

    # ============== 1. Pull latest player.tsx ==============
    print("[1] Downloading latest player.tsx ...")
    shutil.copy(PLAYER, PLAYER + ".bak")
    with urllib.request.urlopen(BASE + "player.tsx") as r:
        data = r.read()
    with open(PLAYER, "wb") as f:
        f.write(data)
    print(f"    OK ({len(data):,} bytes). Backup: player.tsx.bak\n")

    # ============== 2. Patch details file ==============
    print("[2] Patching details/[type]/[id].tsx ...")
    shutil.copy(DETAILS, DETAILS + ".bak")
    with open(DETAILS, "r", encoding="utf-8") as f:
        content = f.read()

    # 2a: Ensure BackHandler import (and dedupe any duplicates).
    n_imports = content.count("import { BackHandler } from 'react-native';")
    if n_imports == 0:
        content = "import { BackHandler } from 'react-native';\n" + content
        print("    [2a] BackHandler import added")
    elif n_imports > 1:
        # Remove duplicates, keep only first
        first_seen = False
        new_lines = []
        for line in content.splitlines(keepends=True):
            if line.strip() == "import { BackHandler } from 'react-native';":
                if first_seen:
                    continue
                first_seen = True
            new_lines.append(line)
        content = "".join(new_lines)
        print(f"    [2a] Deduped {n_imports - 1} extra BackHandler import(s)")
    else:
        print("    [2a] BackHandler import OK")

    # 2b: Add selectedSeason / selectedEpisode to the LHS destructure.
    if "paramSelectedSeason" not in content:
        token = "autoPlay: autoPlayParam,"
        if token in content:
            content = content.replace(
                token,
                token
                + "\n    selectedSeason: paramSelectedSeason,"
                + "\n    selectedEpisode: paramSelectedEpisode,",
                1,
            )
            print("    [2b] LHS destructure: selectedSeason / selectedEpisode added")
        else:
            print("    [2b] WARN: could not find autoPlay destructure to anchor")
    else:
        print("    [2b] paramSelectedSeason already present")

    # 2c: Type definitions for the new params.
    if "selectedSeason?: string;" not in content:
        m = re.search(
            r"(useLocalSearchParams<\{[\s\S]*?)(\n\s*\}\s*>\s*\(\s*\)\s*;)",
            content,
        )
        if m:
            addition = "\n    selectedSeason?: string;\n    selectedEpisode?: string;"
            content = content[: m.end(1)] + addition + content[m.end(1):]
            print("    [2c] Type defs added")
        else:
            print("    [2c] WARN: could not find type close")
    else:
        print("    [2c] Type defs already present")

    # 2d: Always-pass currentEpisodeMeta + nextEpisodeBackdrop.
    old_v1 = (
        "    const nextEpisodeData = nextEpisode ? {\n"
        "      nextEpisodeId: `${baseId}:${nextEpisode.season}:${nextEpisode.episode}`,\n"
        "      nextEpisodeTitle: `S${nextEpisode.season}E${nextEpisode.episode} - ${nextEpisode.name || 'Next Episode'}`,\n"
        "      seriesId: baseId || id,\n"
        "      season: String(episodeSeason),\n"
        "      episode: String(episodeNumber),\n"
        "    } : {};"
    )
    old_v2 = (
        "    const nextEpisodeData = nextEpisode ? {\n"
        "      nextEpisodeId: `${baseId}:${nextEpisode.season}:${nextEpisode.episode}`,\n"
        "      nextEpisodeTitle: `S${nextEpisode.season}E${nextEpisode.episode} - ${nextEpisode.name || 'Next Episode'}`,\n"
        "    } : {};"
    )
    new_block = (
        "    const currentEpisodeMeta = type === 'series' ? {\n"
        "      seriesId: baseId || id,\n"
        "      season: String(episodeSeason),\n"
        "      episode: String(episodeNumber),\n"
        "      episodeName: currentEpisode?.name || '',\n"
        "    } : {};\n"
        "\n"
        "    const nextEpisodeData = nextEpisode ? {\n"
        "      nextEpisodeId: `${baseId}:${nextEpisode.season}:${nextEpisode.episode}`,\n"
        "      nextEpisodeTitle: `S${nextEpisode.season}E${nextEpisode.episode} - ${nextEpisode.name || 'Next Episode'}`,\n"
        "      nextEpisodeBackdrop: nextEpisode.thumbnail || content?.background || '',\n"
        "    } : {};"
    )
    if "currentEpisodeMeta" not in content:
        if old_v1 in content:
            content = content.replace(old_v1, new_block)
            print("    [2d] currentEpisodeMeta + nextEpisodeBackdrop added (v1)")
        elif old_v2 in content:
            content = content.replace(old_v2, new_block)
            print("    [2d] currentEpisodeMeta + nextEpisodeBackdrop added (v2)")
        else:
            print("    [2d] WARN: could not find nextEpisodeData block")
    else:
        # Maybe currentEpisodeMeta exists but nextEpisodeBackdrop doesn't yet
        if "nextEpisodeBackdrop" not in content and old_v2 in content:
            content = content.replace(old_v2, new_block)
            print("    [2d+] nextEpisodeBackdrop added to existing nextEpisodeData")
        else:
            print("    [2d] currentEpisodeMeta already present")

    # 2e: Spread `...currentEpisodeMeta` before each `...nextEpisodeData`.
    if "...currentEpisodeMeta," not in content:
        spread_old = "          ...nextEpisodeData,"
        spread_new = "          ...currentEpisodeMeta,\n          ...nextEpisodeData,"
        n2e = content.count(spread_old)
        content = content.replace(spread_old, spread_new)
        print(f"    [2e] inserted ...currentEpisodeMeta in {n2e} push blocks")
    else:
        print("    [2e] currentEpisodeMeta spread already present")

    # 2f: Episode thumbnail backdrop fallback.
    bd_old = "backdrop: content?.background || '',"
    bd_new = "backdrop: (type === 'series' && currentEpisode?.thumbnail) || content?.background || '',"
    if bd_new not in content:
        n2f = content.count(bd_old)
        content = content.replace(bd_old, bd_new)
        if n2f > 0:
            print(f"    [2f] backdrop -> currentEpisode.thumbnail in {n2f} places")
        else:
            print("    [2f] no backdrop lines to update")
    else:
        print("    [2f] episode-thumbnail backdrop already wired")

    # 2g: Replace router.back() in the back button.
    btn_old = "onPress={() => router.back()}"
    btn_new = "onPress={handleBack}"
    if btn_new not in content and btn_old in content:
        content = content.replace(btn_old, btn_new, 1)
        print("    [2g] back button -> handleBack")
    else:
        print("    [2g] back button already wired to handleBack")

    # 2h: Inject the BackHandler interception block (idempotent).
    if "goToSeriesRootWithFocus" not in content:
        inject = (
            "\n"
            "  // === ANDROID-TV BACK BUTTON FIX =========================================\n"
            "  // Hardware back from any episode-details page teleports straight to the\n"
            "  // SERIES ROOT page (with selectedSeason / selectedEpisode set) regardless\n"
            "  // of how polluted the navigation stack got from auto-binge-watching.\n"
            "  const goToSeriesRootWithFocus = useCallback(() => {\n"
            "    const idStr = (id as string) || '';\n"
            "    if (!idStr.includes(':')) return false;\n"
            "    const parts = idStr.split(':');\n"
            "    const baseIdLocal = parts[0] || idStr;\n"
            "    const s = parts[1] || '';\n"
            "    const e = parts[2] || '';\n"
            "    try {\n"
            "      if (typeof (router as any).dismissAll === 'function') (router as any).dismissAll();\n"
            "    } catch (_) {}\n"
            "    setTimeout(() => {\n"
            "      router.push({\n"
            "        pathname: `/details/${type}/${baseIdLocal}`,\n"
            "        params: { selectedSeason: s, selectedEpisode: e },\n"
            "      });\n"
            "    }, 30);\n"
            "    return true;\n"
            "  }, [id, type, router]);\n"
            "\n"
            "  const handleBack = useCallback(() => {\n"
            "    if (!goToSeriesRootWithFocus()) router.back();\n"
            "  }, [goToSeriesRootWithFocus, router]);\n"
            "\n"
            "  useEffect(() => {\n"
            "    const sub = BackHandler.addEventListener('hardwareBackPress', () => goToSeriesRootWithFocus());\n"
            "    return () => sub.remove();\n"
            "  }, [goToSeriesRootWithFocus]);\n"
            "  // ========================================================================\n"
            "\n"
        )
        m = re.search(
            r"selectedEpisode\?:\s*string;[\s\S]*?\}\s*>\s*\(\s*\)\s*;",
            content,
        )
        if m:
            idx = m.end()
            content = content[:idx] + "\n" + inject + content[idx:]
            print("    [2h] BackHandler interception inserted")
        else:
            # Fallback: insert after the first `}>();` we can find that closes
            # useLocalSearchParams.
            m2 = re.search(r"\}\s*>\s*\(\s*\)\s*;", content)
            if m2:
                idx = m2.end()
                content = content[:idx] + "\n" + inject + content[idx:]
                print("    [2h] BackHandler interception inserted (fallback)")
            else:
                print("    [2h] FAIL — could not find anchor for BackHandler block")
    else:
        print("    [2h] BackHandler block already present")

    # 2i: Season-init effect honors paramSelectedSeason.
    eff_old = (
        "  useEffect(() => {\n"
        "    if (seasons.length > 0 && !seasons.includes(selectedSeason)) {\n"
        "      setSelectedSeason(seasons[0]);\n"
        "    }\n"
        "  }, [seasons]);"
    )
    eff_new = (
        "  useEffect(() => {\n"
        "    if (seasons.length === 0) return;\n"
        "    const fromParam = paramSelectedSeason ? parseInt(paramSelectedSeason as string, 10) : NaN;\n"
        "    if (!isNaN(fromParam) && seasons.includes(fromParam)) {\n"
        "      if (selectedSeason !== fromParam) setSelectedSeason(fromParam);\n"
        "      return;\n"
        "    }\n"
        "    if (!seasons.includes(selectedSeason)) {\n"
        "      setSelectedSeason(seasons[0]);\n"
        "    }\n"
        "  }, [seasons, paramSelectedSeason]);"
    )
    if eff_old in content:
        content = content.replace(eff_old, eff_new)
        print("    [2i] season-init effect now honors paramSelectedSeason")
    elif "fromParam" in content:
        print("    [2i] season-init already updated")
    else:
        print("    [2i] WARN: pattern not found")

    with open(DETAILS, "w", encoding="utf-8") as f:
        f.write(content)
    print("[2] Saved.\n")

    # ============== 3. Verify ==============
    print("[3] Verification:")
    checks = [
        ("BackHandler import",            "import { BackHandler }",        1),
        ("handleBack defined",            "const handleBack",              1),
        ("BackHandler.addEventListener",  "BackHandler.addEventListener",  1),
        ("goToSeriesRootWithFocus",       "goToSeriesRootWithFocus",       3),
        ("paramSelectedSeason",           "paramSelectedSeason",           3),
        ("currentEpisodeMeta",            "currentEpisodeMeta",            5),
        ("nextEpisodeBackdrop",           "nextEpisodeBackdrop",           1),
        ("episode-thumbnail backdrop",    "currentEpisode?.thumbnail",     4),
        ("handleBack used",               "onPress={handleBack}",          1),
        ("season-init param fallback",    "fromParam",                     1),
    ]
    all_ok = True
    for name, needle, need in checks:
        n = content.count(needle)
        ok = n >= need
        if not ok:
            all_ok = False
        marker = "[OK]  " if ok else "[FAIL]"
        print(f"    {marker} {name:35s} count={n} need>={need}")

    print()
    if all_ok:
        print("==> All patches applied. Now rebuild your APK and test on Firestick.")
    else:
        print("==> Some patches failed. Paste the full output and I will send a corrective patch.")


if __name__ == "__main__":
    main()
