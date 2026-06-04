/*
 * apply_patches_v176_longpress_unified_menu.js
 *
 * V176 — Stremio-style unified long-press menu on every poster surface.
 *
 *   Fixes:
 *     • ContentCard.tsx — AsyncStorage was used (v172 hydration) but
 *       never imported.  Hydration silently failed, so the gold check
 *       never appeared on Discover/Search/Library posters.  Now imported.
 *
 *   Adds:
 *     • A single shared `v176ShowLongPressMenu({ item, ... })` that
 *       opens a contextual Alert with Stremio-style buttons:
 *         - Clear Progress  (only if item is in Continue Watching)
 *         - Mark as Watched / Mark as Unwatched
 *         - Add to Library / Remove from Library
 *         - Cancel
 *     • v176MarkWatched / v176ClearProgress / v176HasProgress /
 *       v176SubscribeProgress / v176RegisterProgress helpers.
 *     • LibraryCard (app/(tabs)/library.tsx) — gold check + long-press
 *       opens the menu, with inLibrary preset to true.
 *     • ContinueWatchingItem (app/(tabs)/discover.tsx) — gold check +
 *       long-press opens the menu, with hasProgress preset to true.
 *       Also registers CW content_ids into the progress registry so the
 *       same "Clear Progress" choice appears on Discover/Search posters
 *       referencing those items.
 *
 *   Idempotent.  Re-runs are a no-op once V176 marker is present.
 *   CRLF-preserved.
 *
 *   Usage (Windows CMD, from project root):
 *       node apply_patches_v176_longpress_unified_menu.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CC_PATH       = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');
const LIBRARY_PATH  = path.join(ROOT, 'app', '(tabs)', 'library.tsx');
const DISCOVER_PATH = path.join(ROOT, 'app', '(tabs)', 'discover.tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v176] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v176] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

let totalChanges = 0;

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 1 of 3 — src/components/ContentCard.tsx
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = CC_PATH;
  let src = read(file);

  if (src.indexOf('V176_LONGPRESS_MENU') !== -1) {
    console.log('[v176] ContentCard.tsx: already patched, skipping');
  } else {
    let changes = 0;

    // ── 1a) Add missing AsyncStorage import.  v172 forgot it. ───────────────
    if (src.indexOf("from '@react-native-async-storage/async-storage'") === -1) {
      const asyncImportAnchor = "import Constants from 'expo-constants';";
      if (src.indexOf(asyncImportAnchor) === -1) {
        console.error('[v176] FATAL: ContentCard.tsx — could not locate expo-constants import.');
        process.exit(2);
      }
      src = src.replace(
        asyncImportAnchor,
        "import Constants from 'expo-constants';\n" +
        "/* V176_LONGPRESS_MENU — v172 referenced AsyncStorage but forgot to import it,\n" +
        "   so hydration silently failed and gold check never appeared.  Restored here. */\n" +
        "import AsyncStorage from '@react-native-async-storage/async-storage';"
      );
      changes++;
    }

    // ── 1b) Inject v176 helpers right after the v172 UnmarkWatched export. ──
    const v172EndAnchor =
      'export async function v172UnmarkWatched(contentId: string | undefined | null): Promise<void> {\n' +
      '  if (!contentId) return;\n' +
      '  const key = String(contentId);\n' +
      '  _v172WatchedSet.delete(key);\n' +
      '  try {\n' +
      '    const raw = await AsyncStorage.getItem(_V172_KEY);\n' +
      '    const obj = raw ? JSON.parse(raw) : {};\n' +
      '    delete obj[key];\n' +
      '    await AsyncStorage.setItem(_V172_KEY, JSON.stringify(obj));\n' +
      '  } catch (_) { /* best-effort -- in-memory delete still took effect */ }\n' +
      '  _v172Subs.forEach((cb) => { try { cb(); } catch (_) {} });\n' +
      '}';
    if (src.indexOf(v172EndAnchor) === -1) {
      console.error('[v176] FATAL: ContentCard.tsx — could not locate end of v172UnmarkWatched.');
      process.exit(3);
    }
    const v176Block =
      v172EndAnchor + '\n' +
      '\n' +
      '/* ─────────────────────────────────────────────────────────────────────────\n' +
      '   V176_LONGPRESS_MENU — companion helpers to the V172 watched registry.\n' +
      '   Adds Mark-as-Watched (sister to UnmarkWatched), an in-memory progress\n' +
      '   registry (hydrated by discover.tsx from the CW fetch) so the menu can\n' +
      '   conditionally show "Clear Progress", and a unified Alert opener that\n' +
      '   every poster surface (ContentCard, LibraryCard, ContinueWatchingItem)\n' +
      '   delegates to so the menu wording / button set is identical everywhere. */\n' +
      'export async function v176MarkWatched(contentId: string | undefined | null): Promise<void> {\n' +
      '  if (!contentId) return;\n' +
      '  const key = String(contentId);\n' +
      '  _v172WatchedSet.add(key);\n' +
      '  try {\n' +
      '    const raw = await AsyncStorage.getItem(_V172_KEY);\n' +
      '    const obj = raw ? JSON.parse(raw) : {};\n' +
      '    obj[key] = true;\n' +
      '    await AsyncStorage.setItem(_V172_KEY, JSON.stringify(obj));\n' +
      '  } catch (_) { /* best-effort */ }\n' +
      '  _v172Subs.forEach((cb) => { try { cb(); } catch (_) {} });\n' +
      '}\n' +
      '\n' +
      '/* Progress registry — populated by discover.tsx every time CW data lands. */\n' +
      'const _v176ProgressSet = new Set<string>();\n' +
      'const _v176ProgressSubs = new Set<() => void>();\n' +
      'export function v176RegisterProgress(ids: Array<string | undefined | null>): void {\n' +
      '  _v176ProgressSet.clear();\n' +
      '  for (const raw of (ids || [])) {\n' +
      '    if (!raw) continue;\n' +
      '    _v176ProgressSet.add(String(raw));\n' +
      '  }\n' +
      '  _v176ProgressSubs.forEach((cb) => { try { cb(); } catch (_) {} });\n' +
      '}\n' +
      'export function v176HasProgress(contentId: string | undefined | null): boolean {\n' +
      '  if (!contentId) return false;\n' +
      '  return _v176ProgressSet.has(String(contentId));\n' +
      '}\n' +
      'export function v176SubscribeProgress(cb: () => void): () => void {\n' +
      '  _v176ProgressSubs.add(cb);\n' +
      '  return () => { _v176ProgressSubs.delete(cb); };\n' +
      '}\n' +
      'export async function v176ClearProgress(contentId: string | undefined | null): Promise<void> {\n' +
      '  if (!contentId) return;\n' +
      '  const key = String(contentId);\n' +
      '  _v176ProgressSet.delete(key);\n' +
      '  _v176ProgressSubs.forEach((cb) => { try { cb(); } catch (_) {} });\n' +
      '  try { await (api as any).watchProgress.delete(key); } catch (_) { /* best-effort */ }\n' +
      '}\n' +
      '\n' +
      '/* Unified long-press menu used by ContentCard, LibraryCard, and\n' +
      '   ContinueWatchingItem so every surface shows the same wording.\n' +
      '   Each caller supplies the context it already knows (e.g. LibraryCard\n' +
      '   passes inLibrary=true). */\n' +
      'export function v176ShowLongPressMenu(opts: {\n' +
      '  item: any;\n' +
      '  inLibraryOverride?: boolean | null;\n' +
      '  hasProgressOverride?: boolean | null;\n' +
      '  onAfterChange?: (action: \'watched\' | \'unwatched\' | \'cleared\' | \'added\' | \'removed\') => void;\n' +
      '}): void {\n' +
      '  const { item, inLibraryOverride, hasProgressOverride, onAfterChange } = opts || ({} as any);\n' +
      '  if (!item) return;\n' +
      '  const contentId = String((item as any).content_id || (item as any).imdb_id || (item as any).id || \'\');\n' +
      '  if (!contentId) return;\n' +
      '  const title = (item as any).title || (item as any).name || \'this item\';\n' +
      '  const contentType = (item as any).content_type || (item as any).type || \'movie\';\n' +
      '\n' +
      '  const isWatched = v172IsWatched(contentId);\n' +
      '  const hasProgress = hasProgressOverride != null ? !!hasProgressOverride : v176HasProgress(contentId);\n' +
      '  const inLibrary = !!inLibraryOverride;\n' +
      '\n' +
      '  const buttons: any[] = [];\n' +
      '  if (hasProgress) {\n' +
      '    buttons.push({\n' +
      '      text: \'Clear Progress\',\n' +
      '      onPress: () => {\n' +
      '        v176ClearProgress(contentId).then(() => { try { onAfterChange && onAfterChange(\'cleared\'); } catch (_) {} });\n' +
      '      },\n' +
      '    });\n' +
      '  }\n' +
      '  if (isWatched) {\n' +
      '    buttons.push({\n' +
      '      text: \'Mark as Unwatched\',\n' +
      '      onPress: () => {\n' +
      '        v172UnmarkWatched(contentId).then(() => { try { onAfterChange && onAfterChange(\'unwatched\'); } catch (_) {} });\n' +
      '      },\n' +
      '    });\n' +
      '  } else {\n' +
      '    buttons.push({\n' +
      '      text: \'Mark as Watched\',\n' +
      '      onPress: () => {\n' +
      '        v176MarkWatched(contentId).then(() => { try { onAfterChange && onAfterChange(\'watched\'); } catch (_) {} });\n' +
      '      },\n' +
      '    });\n' +
      '  }\n' +
      '  if (inLibrary) {\n' +
      '    buttons.push({\n' +
      '      text: \'Remove from Library\',\n' +
      '      style: \'destructive\',\n' +
      '      onPress: async () => {\n' +
      '        try { await (api as any).library.remove(contentType, contentId); } catch (_) {}\n' +
      '        try { onAfterChange && onAfterChange(\'removed\'); } catch (_) {}\n' +
      '      },\n' +
      '    });\n' +
      '  } else {\n' +
      '    buttons.push({\n' +
      '      text: \'Add to Library\',\n' +
      '      onPress: async () => {\n' +
      '        try {\n' +
      '          await (api as any).library.add({\n' +
      '            content_id: contentId,\n' +
      '            content_type: contentType,\n' +
      '            name: title,\n' +
      '            poster: (item as any).poster || \'\',\n' +
      '          });\n' +
      '        } catch (_) {}\n' +
      '        try { onAfterChange && onAfterChange(\'added\'); } catch (_) {}\n' +
      '      },\n' +
      '    });\n' +
      '  }\n' +
      '  buttons.push({ text: \'Cancel\', style: \'cancel\' });\n' +
      '\n' +
      '  Alert.alert(title, undefined, buttons);\n' +
      '}';
    src = src.replace(v172EndAnchor, v176Block);
    changes++;

    // ── 1c) Subscribe to progress changes in the component (so the menu\n
    //        recomputes when CW changes), and add inLibrary lookup from the\n
    //        contentStore so Discover cards see the right toggle. ──────────
    const v172CardAnchor =
      '  const _v172ContentId = ((item as any).content_id || _v160_id) as string | undefined;\n' +
      '  const [, _v172Bump] = useState(0);\n' +
      '  useEffect(() => v172SubscribeWatched(() => _v172Bump((x) => (x + 1) & 0xff)), []);\n' +
      '  const _v172IsWatched = v172IsWatched(_v172ContentId);\n';
    if (src.indexOf(v172CardAnchor) === -1) {
      console.error('[v176] FATAL: ContentCard.tsx — could not locate v172 card anchor.');
      process.exit(4);
    }
    const v176CardInject =
      v172CardAnchor +
      '\n' +
      '  /* V176_LONGPRESS_MENU — re-render when the CW progress registry changes\n' +
      '     so the unified long-press menu shows the right buttons. */\n' +
      '  useEffect(() => v176SubscribeProgress(() => _v172Bump((x) => (x + 1) & 0xff)), []);\n';
    src = src.replace(v172CardAnchor, v176CardInject);
    changes++;

    // ── 1d) Replace the entire handleLongPress body with a single call to\n
    //        the unified menu.  We match from "  const handleLongPress =" up\n
    //        through the deps array we appended in v172. ───────────────────
    const oldLP =
      '  const handleLongPress = useCallback(async () => {\n' +
      '    /* V172_WATCHED_REGISTRY — for an already-watched card, long-press\n' +
      '       removes the checkmark (mirrors EpisodeCard).  Falls through to\n' +
      '       the library toggle for unwatched cards. */\n' +
      '    if (_v172IsWatched && _v172ContentId) {\n' +
      '      const _v172Name = (item as any).name || (item as any).title || \'this title\';\n' +
      '      Alert.alert(\n' +
      '        \'Mark as Unwatched\',\n' +
      '        `Remove the watched checkmark from "${_v172Name}"?`,\n' +
      '        [\n' +
      '          { text: \'Cancel\', style: \'cancel\' },\n' +
      '          {\n' +
      '            text: \'Mark Unwatched\',\n' +
      '            style: \'destructive\',\n' +
      '            onPress: () => { v172UnmarkWatched(_v172ContentId); },\n' +
      '          },\n' +
      '        ],\n' +
      '      );\n' +
      '      return;\n' +
      '    }\n' +
      '    const contentId = item.imdb_id || item.id;\n' +
      '\n' +
      '    const contentName =\n' +
      '      item.name || item.title || \'this item\';\n' +
      '\n' +
      '    Alert.alert(\n' +
      '      isInLibrary\n' +
      '        ? \'Remove from Library?\'\n' +
      '        : \'Add to Library?\',\n' +
      '      isInLibrary\n' +
      '        ? `Remove "${contentName}" from your library?`\n' +
      '        : `Add "${contentName}" to your library?`,\n' +
      '      [\n' +
      '        {\n' +
      '          text: \'Cancel\',\n' +
      '          style: \'cancel\',\n' +
      '        },\n' +
      '        {\n' +
      '          text: isInLibrary ? \'Remove\' : \'Add\',\n' +
      '          style: isInLibrary\n' +
      '            ? \'destructive\'\n' +
      '            : \'default\',\n' +
      '          onPress: async () => {\n' +
      '            try {\n' +
      '              if (isInLibrary) {\n' +
      '                await api.library.remove(contentId);\n' +
      '\n' +
      '                setIsInLibrary(false);\n' +
      '              } else {\n' +
      '                await api.library.add({\n' +
      '                  content_id: contentId,\n' +
      '                  content_type: item.type || \'movie\',\n' +
      '                  name: contentName,\n' +
      '                  poster: item.poster || \'\',\n' +
      '                });\n' +
      '\n' +
      '                setIsInLibrary(true);\n' +
      '              }\n' +
      '\n' +
      '              onLibraryChange?.();\n' +
      '            } catch (error) {\n' +
      '              console.log(\'Library error:\', error);\n' +
      '\n' +
      '              Alert.alert(\n' +
      '                \'Error\',\n' +
      '                \'Failed to update library\'\n' +
      '              );\n' +
      '            }\n' +
      '          },\n' +
      '        },\n' +
      '      ]\n' +
      '    );\n' +
      '  }, [item, isInLibrary, onLibraryChange, _v172IsWatched, _v172ContentId]);';
    if (src.indexOf(oldLP) === -1) {
      console.error('[v176] FATAL: ContentCard.tsx — could not locate old handleLongPress block (post-v172).');
      process.exit(5);
    }
    const newLP =
      '  const handleLongPress = useCallback(() => {\n' +
      '    /* V176_LONGPRESS_MENU — delegate to the unified Stremio-style menu.\n' +
      '       inLibrary is the local component flag (parent-set OR toggled by a\n' +
      '       previous Add).  After Add/Remove resolves we flip the local flag\n' +
      '       and notify any parent listener. */\n' +
      '    v176ShowLongPressMenu({\n' +
      '      item,\n' +
      '      inLibraryOverride: isInLibrary,\n' +
      '      onAfterChange: (action) => {\n' +
      '        if (action === \'added\') setIsInLibrary(true);\n' +
      '        if (action === \'removed\') setIsInLibrary(false);\n' +
      '        if (action === \'added\' || action === \'removed\') {\n' +
      '          try { onLibraryChange && onLibraryChange(); } catch (_) {}\n' +
      '        }\n' +
      '      },\n' +
      '    });\n' +
      '  }, [item, isInLibrary, onLibraryChange, _v172IsWatched, _v172ContentId]);';
    src = src.replace(oldLP, newLP);
    changes++;

    write(file, src);
    console.log(`[v176] ContentCard.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 2 of 3 — app/(tabs)/library.tsx
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = LIBRARY_PATH;
  let src = read(file);

  if (src.indexOf('V176_LONGPRESS_MENU') !== -1) {
    console.log('[v176] library.tsx: already patched, skipping');
  } else {
    let changes = 0;

    // ── 2a) Ensure Alert is imported from react-native. ─────────────────────
    if (src.match(/from 'react-native'/)) {
      // Inject Alert into the existing react-native import block if not present.
      const rnImportMatch = src.match(/import\s*\{([\s\S]*?)\}\s*from\s*'react-native'/);
      if (rnImportMatch && rnImportMatch[1].indexOf('Alert') === -1) {
        const old = rnImportMatch[0];
        // Strip trailing whitespace AND any trailing comma so we don't end up
        // with a double-comma when the existing block ends with `findNodeHandle,`.
        const newImports = rnImportMatch[1].replace(/[,\s]+$/, '') + ',\n  Alert';
        const fixed = `import {${newImports}\n} from 'react-native'`;
        src = src.replace(old, fixed);
        changes++;
      }
    }

    // ── 2b) Augment the ContentCard import to include the v176 helpers. ─────
    const oldCcImport = "import { getCardWidth } from '../../src/components/ContentCard';";
    if (src.indexOf(oldCcImport) === -1) {
      console.error('[v176] FATAL: library.tsx — could not locate ContentCard import.');
      process.exit(6);
    }
    const newCcImport =
      "/* V176_LONGPRESS_MENU — pull the unified menu opener + watched/progress\n" +
      "   subscriptions in so LibraryCard renders the gold check and routes\n" +
      "   long-press through the shared Alert. */\n" +
      "import {\n" +
      "  getCardWidth,\n" +
      "  v172IsWatched as _v172IsWatched,\n" +
      "  v172SubscribeWatched as _v172SubscribeWatched,\n" +
      "  v176HasProgress as _v176HasProgress,\n" +
      "  v176SubscribeProgress as _v176SubscribeProgress,\n" +
      "  v176ShowLongPressMenu as _v176ShowLongPressMenu,\n" +
      "} from '../../src/components/ContentCard';";
    src = src.replace(oldCcImport, newCcImport);
    changes++;

    // ── 2c) Inside LibraryCard, just after `const xRowHeight = ...` line,\n
    //        derive watched + progress flags and wire a long-press handler. ─
    const xRowAnchor = '  const xRowHeight = xButtonSize + 8;';
    if (src.indexOf(xRowAnchor) === -1) {
      console.error('[v176] FATAL: library.tsx — could not locate xRowHeight anchor in LibraryCard.');
      process.exit(7);
    }
    const v176CardLogic =
      xRowAnchor + '\n' +
      '\n' +
      '  /* V176_LONGPRESS_MENU — derive watched + progress per-card; subscribe\n' +
      '     so any change elsewhere (player marks watched, another long-press\n' +
      '     clears progress) instantly refreshes the gold badge / menu. */\n' +
      '  const _v176ContentId = ((item as any).imdb_id || (item as any).id || (item as any).content_id) as string | undefined;\n' +
      '  const [, _v176Bump] = useState(0);\n' +
      '  useEffect(() => _v172SubscribeWatched(() => _v176Bump((x) => (x + 1) & 0xff)), []);\n' +
      '  useEffect(() => _v176SubscribeProgress(() => _v176Bump((x) => (x + 1) & 0xff)), []);\n' +
      '  const _v176IsWatched = _v172IsWatched(_v176ContentId);\n' +
      '  const _v176HasProg = _v176HasProgress(_v176ContentId);\n' +
      '\n' +
      '  const _v176OpenMenu = useCallback(() => {\n' +
      '    _v176ShowLongPressMenu({\n' +
      '      item: { ...(item as any), content_id: _v176ContentId, content_type: (item as any).type },\n' +
      '      inLibraryOverride: true,\n' +
      '      hasProgressOverride: _v176HasProg,\n' +
      '      onAfterChange: (action) => {\n' +
      '        if (action === \'removed\') { try { onRemove && onRemove(); } catch (_) {} }\n' +
      '      },\n' +
      '    });\n' +
      '  }, [item, _v176ContentId, _v176HasProg, onRemove]);\n';
    src = src.replace(xRowAnchor, v176CardLogic);
    changes++;

    // Need useCallback in scope.  React already imported at top with useState
    // & useEffect; ensure useCallback is present.
    const reactImportMatch = src.match(/import React,\s*\{([^}]*)\}\s*from\s*'react'/);
    if (reactImportMatch && reactImportMatch[1].indexOf('useCallback') === -1) {
      const oldR = reactImportMatch[0];
      const fixedR = oldR.replace(/(\{[^}]*)\}/, (_m, inner) => `${inner.replace(/\s*$/, '')}, useCallback }`);
      src = src.replace(oldR, fixedR);
      changes++;
    }

    // ── 2d) Wire onLongPress to the poster Pressable.  Find the Pressable\n
    //        with `ref={posterRef}` and inject onLongPress + delayLongPress. ─
    const posterPressableAnchor =
      '      <Pressable\n' +
      '        ref={posterRef}\n' +
      '        onPress={onPress}\n' +
      '        onFocus={handleFocus}\n' +
      '        onBlur={() => { setIsFocused(false); onCardBlur?.(); }}\n' +
      '        android_ripple={null}\n' +
      '        nextFocusUp={xButtonTag}';
    if (src.indexOf(posterPressableAnchor) === -1) {
      console.error('[v176] FATAL: library.tsx — could not locate poster Pressable anchor.');
      process.exit(8);
    }
    const posterPressableWithLP =
      '      <Pressable\n' +
      '        ref={posterRef}\n' +
      '        onPress={onPress}\n' +
      '        onLongPress={_v176OpenMenu}\n' +
      '        delayLongPress={500}\n' +
      '        onFocus={handleFocus}\n' +
      '        onBlur={() => { setIsFocused(false); onCardBlur?.(); }}\n' +
      '        android_ripple={null}\n' +
      '        nextFocusUp={xButtonTag}';
    src = src.replace(posterPressableAnchor, posterPressableWithLP);
    changes++;

    // ── 2e) Render gold check overlay on top of the poster image (inside\n
    //        the imageWrapper) when _v176IsWatched. ─────────────────────────
    const imgWrapperEndAnchor =
      '        <View style={styles.imageWrapper}>\n' +
      '          <Image\n' +
      '            source={{ uri: item.poster }}\n' +
      '            style={styles.posterImage}\n' +
      '            contentFit="cover"\n' +
      '            cachePolicy="memory-disk"\n' +
      '          />\n' +
      '        </View>';
    if (src.indexOf(imgWrapperEndAnchor) === -1) {
      console.error('[v176] FATAL: library.tsx — could not locate imageWrapper block.');
      process.exit(9);
    }
    const imgWrapperWithBadge =
      imgWrapperEndAnchor + '\n' +
      '\n' +
      '        {/* V176_LONGPRESS_MENU — gold check overlay when watched. */}\n' +
      '        {_v176IsWatched && (\n' +
      '          <View style={styles.v176WatchedBadge} pointerEvents="none">\n' +
      '            <Ionicons name="checkmark" size={14} color="#B8A05C" />\n' +
      '          </View>\n' +
      '        )}';
    src = src.replace(imgWrapperEndAnchor, imgWrapperWithBadge);
    changes++;

    // ── 2f) Add v176WatchedBadge style to the StyleSheet.create object. ─────
    const styleSheetAnchor = 'const styles = StyleSheet.create({';
    if (src.indexOf(styleSheetAnchor) === -1) {
      console.error('[v176] FATAL: library.tsx — could not locate StyleSheet.create.');
      process.exit(10);
    }
    src = src.replace(
      styleSheetAnchor,
      styleSheetAnchor + '\n' +
      '  /* V176_LONGPRESS_MENU — mirror EpisodeCard\'s gold checkmark badge. */\n' +
      '  v176WatchedBadge: {\n' +
      '    position: \'absolute\',\n' +
      '    top: 6,\n' +
      '    left: 6,\n' +
      '    width: 24,\n' +
      '    height: 24,\n' +
      '    borderRadius: 12,\n' +
      '    backgroundColor: \'rgba(0,0,0,0.7)\',\n' +
      '    justifyContent: \'center\',\n' +
      '    alignItems: \'center\',\n' +
      '    zIndex: 10,\n' +
      '  },'
    );
    changes++;

    write(file, src);
    console.log(`[v176] library.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 3 of 3 — app/(tabs)/discover.tsx
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = DISCOVER_PATH;
  let src = read(file);

  if (src.indexOf('V176_LONGPRESS_MENU') !== -1) {
    console.log('[v176] discover.tsx: already patched, skipping');
  } else {
    let changes = 0;

    // ── 3a) Augment the ContentCard import to also include the v172/v176\n
    //        helpers we need in ContinueWatchingItem + the CW fetch effect. ─
    const oldCcImport =
      "import { getCardWidth, v160GetPoster as _v160GetPoster, v160SubscribePoster as _v160SubscribePoster /* V166_POSTER_SUB */, v167PrewarmReleaseStatus as _v167PrewarmReleaseStatus /* V167_RELEASE_PREWARM */ } from '../../src/components/ContentCard';";
    if (src.indexOf(oldCcImport) === -1) {
      console.error('[v176] FATAL: discover.tsx — could not locate ContentCard import.');
      process.exit(11);
    }
    const newCcImport =
      "/* V176_LONGPRESS_MENU — extend the ContentCard import with the\n" +
      "   watched/progress helpers + unified menu opener. */\n" +
      "import {\n" +
      "  getCardWidth,\n" +
      "  v160GetPoster as _v160GetPoster,\n" +
      "  v160SubscribePoster as _v160SubscribePoster /* V166_POSTER_SUB */,\n" +
      "  v167PrewarmReleaseStatus as _v167PrewarmReleaseStatus /* V167_RELEASE_PREWARM */,\n" +
      "  v172IsWatched as _v172IsWatched,\n" +
      "  v172SubscribeWatched as _v172SubscribeWatched,\n" +
      "  v176RegisterProgress as _v176RegisterProgress,\n" +
      "  v176HasProgress as _v176HasProgress,\n" +
      "  v176SubscribeProgress as _v176SubscribeProgress,\n" +
      "  v176ShowLongPressMenu as _v176ShowLongPressMenu,\n" +
      "} from '../../src/components/ContentCard';";
    src = src.replace(oldCcImport, newCcImport);
    changes++;

    // ── 3b) Register CW ids into the progress registry whenever\n
    //        continueWatching state changes. ────────────────────────────────
    const cwPersistAnchor =
      '  useEffect(() => {\n' +
      '    try {\n' +
      "      AsyncStorage.setItem('@ps_cw_v1', JSON.stringify(continueWatching || [])).catch(() => {});\n" +
      '    } catch (_) {}\n' +
      '  }, [continueWatching]);';
    if (src.indexOf(cwPersistAnchor) === -1) {
      console.error('[v176] FATAL: discover.tsx — could not locate CW persist effect.');
      process.exit(12);
    }
    const cwPersistPlusRegister =
      cwPersistAnchor + '\n' +
      '\n' +
      '  /* V176_LONGPRESS_MENU — keep the in-memory progress registry in sync\n' +
      '     with the live CW list (and the disk-cached fallback) so the unified\n' +
      '     long-press menu shows "Clear Progress" for items that are in CW. */\n' +
      '  useEffect(() => {\n' +
      '    const ids: string[] = [];\n' +
      '    const live = (continueWatching && continueWatching.length > 0) ? continueWatching : cachedCW;\n' +
      '    for (const it of (live || [])) {\n' +
      '      const cid = (it as any).content_id || (it as any).imdb_id || (it as any).id;\n' +
      '      if (cid) ids.push(String(cid));\n' +
      '    }\n' +
      '    _v176RegisterProgress(ids);\n' +
      '  }, [continueWatching, cachedCW]);';
    src = src.replace(cwPersistAnchor, cwPersistPlusRegister);
    changes++;

    // ── 3c) Inside ContinueWatchingItem, derive watched/progress + a\n
    //        _v176OpenMenu callback.  Splice right after the percentWatched\n
    //        declaration (which sits at the top of the component body). ────
    const cwItemAnchor = '  const percentWatched = item.percent_watched || 0;';
    if (src.indexOf(cwItemAnchor) === -1) {
      console.error('[v176] FATAL: discover.tsx — could not locate ContinueWatchingItem percentWatched anchor.');
      process.exit(13);
    }
    const cwItemAnchorPlusLogic =
      cwItemAnchor + '\n' +
      '\n' +
      '  /* V176_LONGPRESS_MENU — derive watched + progress per CW card. */\n' +
      '  const _v176ContentId = String((item as any).content_id || (item as any).imdb_id || (item as any).id || \'\');\n' +
      '  const [, _v176Bump] = useState(0);\n' +
      '  useEffect(() => _v172SubscribeWatched(() => _v176Bump((x) => (x + 1) & 0xff)), []);\n' +
      '  useEffect(() => _v176SubscribeProgress(() => _v176Bump((x) => (x + 1) & 0xff)), []);\n' +
      '  const _v176IsWatchedCW = _v172IsWatched(_v176ContentId);\n' +
      '\n' +
      '  const _v176OpenMenu = useCallback(() => {\n' +
      '    _v176ShowLongPressMenu({\n' +
      '      item: {\n' +
      '        content_id: _v176ContentId,\n' +
      '        content_type: (item as any).content_type || (item as any).type || \'movie\',\n' +
      '        title: (item as any).title,\n' +
      '        name: (item as any).title,\n' +
      '        poster: (item as any).poster || (item as any).backdrop,\n' +
      '      },\n' +
      '      inLibraryOverride: false,\n' +
      '      hasProgressOverride: true,\n' +
      '      onAfterChange: (action) => {\n' +
      '        if (action === \'cleared\') { try { onRemove && onRemove(); } catch (_) {} }\n' +
      '      },\n' +
      '    });\n' +
      '  }, [item, _v176ContentId, onRemove]);\n';
    src = src.replace(cwItemAnchor, cwItemAnchorPlusLogic);
    changes++;

    // Ensure useCallback is imported.
    const reactImportMatch = src.match(/import React,\s*\{([^}]*)\}\s*from\s*'react'/);
    if (reactImportMatch && reactImportMatch[1].indexOf('useCallback') === -1) {
      const oldR = reactImportMatch[0];
      const fixedR = oldR.replace(/(\{[^}]*)\}/, (_m, inner) => `${inner.replace(/\s*$/, '')}, useCallback }`);
      src = src.replace(oldR, fixedR);
      changes++;
    }

    // ── 3d) Wire onLongPress to the poster Pressable in ContinueWatchingItem.\n
    //        Match the Pressable that has `ref={posterRef}` AND `nextFocusUp={xButtonTag}`. ─
    const cwPressableAnchor =
      '      <Pressable\n' +
      '        ref={posterRef}\n' +
      '        onPress={onPress}\n' +
      '        onFocus={handleFocus}\n' +
      '        onBlur={() => setIsFocused(false)}\n' +
      '        android_ripple={null}\n' +
      '        nextFocusUp={xButtonTag}';
    if (src.indexOf(cwPressableAnchor) === -1) {
      console.error('[v176] FATAL: discover.tsx — could not locate ContinueWatchingItem poster Pressable.');
      process.exit(14);
    }
    const cwPressableWithLP =
      '      <Pressable\n' +
      '        ref={posterRef}\n' +
      '        onPress={onPress}\n' +
      '        onLongPress={_v176OpenMenu}\n' +
      '        delayLongPress={500}\n' +
      '        onFocus={handleFocus}\n' +
      '        onBlur={() => setIsFocused(false)}\n' +
      '        android_ripple={null}\n' +
      '        nextFocusUp={xButtonTag}';
    src = src.replace(cwPressableAnchor, cwPressableWithLP);
    changes++;

    // ── 3e) Render gold check badge over the CW poster image when watched. ─
    //        Inject right after the progress bar inside continueImageContainer.
    const progressBarBlock =
      '          {/* Progress bar */}\n' +
      '          <View style={styles.progressContainer}>\n' +
      '            <View style={[styles.progressBar, { width: `${Math.min(percentWatched, 100)}%` }]} />\n' +
      '          </View>';
    if (src.indexOf(progressBarBlock) === -1) {
      console.error('[v176] FATAL: discover.tsx — could not locate progress bar block.');
      process.exit(15);
    }
    const progressBarWithBadge =
      progressBarBlock + '\n' +
      '\n' +
      '          {/* V176_LONGPRESS_MENU — gold check overlay when watched. */}\n' +
      '          {_v176IsWatchedCW && (\n' +
      '            <View style={styles.v176CwWatchedBadge} pointerEvents="none">\n' +
      '              <Ionicons name="checkmark" size={14} color="#B8A05C" />\n' +
      '            </View>\n' +
      '          )}';
    src = src.replace(progressBarBlock, progressBarWithBadge);
    changes++;

    // ── 3f) Add v176CwWatchedBadge style.  Splice into the existing\n
    //        StyleSheet.create({ ... }) at the top of the styles block. ────
    const styleSheetAnchor = 'const styles = StyleSheet.create({';
    if (src.indexOf(styleSheetAnchor) === -1) {
      console.error('[v176] FATAL: discover.tsx — could not locate StyleSheet.create.');
      process.exit(16);
    }
    src = src.replace(
      styleSheetAnchor,
      styleSheetAnchor + '\n' +
      '  /* V176_LONGPRESS_MENU — mirror EpisodeCard\'s gold checkmark for CW. */\n' +
      '  v176CwWatchedBadge: {\n' +
      '    position: \'absolute\',\n' +
      '    top: 6,\n' +
      '    left: 6,\n' +
      '    width: 24,\n' +
      '    height: 24,\n' +
      '    borderRadius: 12,\n' +
      '    backgroundColor: \'rgba(0,0,0,0.7)\',\n' +
      '    justifyContent: \'center\',\n' +
      '    alignItems: \'center\',\n' +
      '    zIndex: 10,\n' +
      '  },'
    );
    changes++;

    write(file, src);
    console.log(`[v176] discover.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

console.log('');
console.log(`[v176] DONE.  ${totalChanges} total change(s) across all files.`);
console.log('[v176] Rebuild your Expo app and sideload to test.');
