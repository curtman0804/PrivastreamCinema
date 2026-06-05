/*
 * apply_patches_v176k_stremio_popover.js
 *
 * V176K — Custom Stremio-style popover, gold-themed, anchored to the
 *         focused poster.  Replaces the system Alert for all long-press
 *         menus.  D-pad navigable on TV, tap-outside-to-dismiss on touch.
 *
 *   FILES CHANGED:
 *     • src/components/ContentCard.tsx
 *         - New <V176kPopover /> Modal component + popover styles
 *         - New v176kEmitOpen() event-bus function (uses
 *           DeviceEventEmitter so any surface can fire it without prop
 *           drilling)
 *         - Rewrites v176ShowLongPressMenu() to dispatch the event
 *           instead of Alert.alert; builds a typed action list.
 *
 *     • app/(tabs)/discover.tsx
 *         - Mount one <V176kPopover /> at screen root.
 *         - ContinueWatchingItem._v176OpenMenu measures its poster via
 *           findNodeHandle + UIManager.measureInWindow and passes the
 *           anchor rect into v176kEmitOpen.
 *
 *     • app/(tabs)/library.tsx
 *         - Mount one <V176kPopover /> at screen root.
 *         - LibraryCard._v176OpenMenu measures + emits.
 *
 *     • app/details/[type]/[id].tsx
 *         - Mount one <V176kPopover /> at screen root.
 *         - EpisodeCard's _v176cOpenEpMenu uses v176kEmitOpen with
 *           episode-only action set (no Library).
 *
 *   Idempotent.  CRLF preserved.
 *
 *   Usage:
 *       node apply_patches_v176k_stremio_popover.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CC_PATH       = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');
const LIBRARY_PATH  = path.join(ROOT, 'app', '(tabs)', 'library.tsx');
const DISCOVER_PATH = path.join(ROOT, 'app', '(tabs)', 'discover.tsx');
const ID_PATH       = path.join(ROOT, 'app', 'details', '[type]', '[id].tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v176k] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v176k] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

let totalChanges = 0;

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 1 — src/components/ContentCard.tsx
//    Add <V176kPopover />, v176kEmitOpen, rewrite v176ShowLongPressMenu
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = CC_PATH;
  let src = read(file);

  if (src.indexOf('V176K_POPOVER') !== -1) {
    console.log('[v176k] ContentCard.tsx: already patched, skipping');
  } else {
    let changes = 0;

    // 1a) Extend the react-native import block to also pull Modal,
    //     UIManager, Dimensions, Platform.  Keep existing imports intact.
    const oldImport =
      'import {\n' +
      '  View,\n' +
      '  StyleSheet,\n' +
      '  Pressable,\n' +
      '  useWindowDimensions,\n' +
      '  Text,\n' +
      '  Alert,\n' +
      '  findNodeHandle,\n' +
      '  Image as RNImage,\n' +
      '  DeviceEventEmitter,\n' +
      "} from 'react-native';";
    if (src.indexOf(oldImport) === -1) {
      console.error('[v176k] FATAL: ContentCard.tsx — could not locate react-native import block.');
      process.exit(2);
    }
    const newImport =
      'import {\n' +
      '  View,\n' +
      '  StyleSheet,\n' +
      '  Pressable,\n' +
      '  useWindowDimensions,\n' +
      '  Text,\n' +
      '  Alert,\n' +
      '  findNodeHandle,\n' +
      '  Image as RNImage,\n' +
      '  DeviceEventEmitter,\n' +
      '  /* V176K_POPOVER — Stremio-style anchored popover. */\n' +
      '  Modal,\n' +
      '  UIManager,\n' +
      '  Dimensions,\n' +
      '  Platform,\n' +
      "} from 'react-native';";
    src = src.replace(oldImport, newImport);
    changes++;

    // 1b) Inject the v176k popover module (helpers + emit + component)
    //     directly after the existing v176ShowLongPressMenu definition.
    //     Anchor: the closing `}` of v176ShowLongPressMenu followed by
    //     `export function v160GetPoster(`.
    const insertAnchor =
      '  buttons.push({ text: \'Cancel\', style: \'cancel\' });\n' +
      '\n' +
      '  Alert.alert(title, undefined, buttons);\n' +
      '}\n' +
      'export function v160GetPoster';
    // Note: in current file v176j removed the Cancel push + made it
    // cancelable.  Detect which variant is present.
    const variantA = insertAnchor; // pre-v176j
    const variantB =
      '  /* V176J_MENU_REFRESH — Cancel removed; Alert.alert is invoked with\n' +
      '     cancelable=true so hardware Back dismisses on Android. */\n' +
      '\n' +
      '  Alert.alert(title, undefined, buttons, { cancelable: true });\n' +
      '}\n' +
      'export function v160GetPoster';
    let usedVariant = null;
    if (src.indexOf(variantB) !== -1) usedVariant = variantB;
    else if (src.indexOf(variantA) !== -1) usedVariant = variantA;
    if (!usedVariant) {
      console.error('[v176k] FATAL: ContentCard.tsx — could not locate insertion anchor after v176ShowLongPressMenu.');
      process.exit(3);
    }

    const popoverBlock =
      "/* ─── V176K_POPOVER ──────────────────────────────────────────────────────\n" +
      "   Custom Stremio-style popover anchored to the focused poster.  Used by\n" +
      "   ContentCard, LibraryCard, ContinueWatchingItem, and EpisodeCard via the\n" +
      "   v176kEmitOpen helper below.  A single <V176kPopover /> host mounted at\n" +
      "   each screen root listens for the 'v176k:open' DeviceEventEmitter event\n" +
      "   and renders the Modal with the supplied actions + anchor rect.\n" +
      "──────────────────────────────────────────────────────────────────────── */\n" +
      "\n" +
      "export type V176kAction = {\n" +
      "  id: string;\n" +
      "  label: string;\n" +
      "  icon?: string;\n" +
      "  destructive?: boolean;\n" +
      "  onPress: () => void;\n" +
      "};\n" +
      "\n" +
      "export type V176kOpenPayload = {\n" +
      "  anchor?: { x: number; y: number; width: number; height: number } | null;\n" +
      "  title?: string;\n" +
      "  actions: V176kAction[];\n" +
      "};\n" +
      "\n" +
      "export function v176kEmitOpen(payload: V176kOpenPayload): void {\n" +
      "  try { DeviceEventEmitter.emit('v176k:open', payload); } catch (_) {}\n" +
      "}\n" +
      "\n" +
      "/* Helper that callers can use to build the standard action list with\n" +
      "   the same Stremio-style logic the Alert version used.  Centralizes the\n" +
      "   business rules so all surfaces stay consistent. */\n" +
      "export function v176kBuildActions(opts: {\n" +
      "  item: any;\n" +
      "  inLibrary: boolean;\n" +
      "  hasProgress?: boolean;\n" +
      "  includeLibrary?: boolean;        // default true; episodes set false\n" +
      "  includeWatchedToggle?: boolean;  // default true\n" +
      "  onAfterChange?: (action: 'watched' | 'unwatched' | 'cleared' | 'added' | 'removed') => void;\n" +
      "}): { title: string; actions: V176kAction[] } {\n" +
      "  const { item, inLibrary, hasProgress, onAfterChange } = opts;\n" +
      "  const includeLibrary = opts.includeLibrary !== false;\n" +
      "  const includeWatchedToggle = opts.includeWatchedToggle !== false;\n" +
      "  const contentId = String((item as any).content_id || (item as any).imdb_id || (item as any).id || '');\n" +
      "  const title = (item as any).title || (item as any).name || 'this item';\n" +
      "  const contentType = (item as any).content_type || (item as any).type || 'movie';\n" +
      "  const isWatched = v172IsWatched(contentId);\n" +
      "  const hasProg = hasProgress != null ? !!hasProgress : v176HasProgress(contentId);\n" +
      "\n" +
      "  const actions: V176kAction[] = [];\n" +
      "  if (hasProg) {\n" +
      "    actions.push({\n" +
      "      id: 'clear',\n" +
      "      label: 'Clear Progress',\n" +
      "      icon: 'refresh-circle-outline',\n" +
      "      onPress: () => {\n" +
      "        v176ClearProgress(contentId).then(() => { try { onAfterChange && onAfterChange('cleared'); } catch (_) {} });\n" +
      "      },\n" +
      "    });\n" +
      "  }\n" +
      "  if (includeWatchedToggle) {\n" +
      "    if (isWatched) {\n" +
      "      actions.push({\n" +
      "        id: 'unwatch',\n" +
      "        label: 'Mark as Unwatched',\n" +
      "        icon: 'eye-off-outline',\n" +
      "        onPress: () => {\n" +
      "          v172UnmarkWatched(contentId).then(() => { try { onAfterChange && onAfterChange('unwatched'); } catch (_) {} });\n" +
      "        },\n" +
      "      });\n" +
      "    } else {\n" +
      "      actions.push({\n" +
      "        id: 'watch',\n" +
      "        label: 'Mark as Watched',\n" +
      "        icon: 'checkmark-circle-outline',\n" +
      "        onPress: () => {\n" +
      "          v176MarkWatched(contentId).then(() => { try { onAfterChange && onAfterChange('watched'); } catch (_) {} });\n" +
      "        },\n" +
      "      });\n" +
      "    }\n" +
      "  }\n" +
      "  if (includeLibrary) {\n" +
      "    if (inLibrary) {\n" +
      "      actions.push({\n" +
      "        id: 'remove',\n" +
      "        label: 'Remove from Library',\n" +
      "        icon: 'bookmark',\n" +
      "        destructive: true,\n" +
      "        onPress: async () => {\n" +
      "          try {\n" +
      "            const removeFn = (_v169UseContentStore as any).getState().removeFromLibrary;\n" +
      "            await removeFn(contentType, contentId);\n" +
      "          } catch (e) { console.log('[V176K] remove error:', e); }\n" +
      "          try { onAfterChange && onAfterChange('removed'); } catch (_) {}\n" +
      "        },\n" +
      "      });\n" +
      "    } else {\n" +
      "      actions.push({\n" +
      "        id: 'add',\n" +
      "        label: 'Add to Library',\n" +
      "        icon: 'bookmark-outline',\n" +
      "        onPress: async () => {\n" +
      "          try {\n" +
      "            const addFn = (_v169UseContentStore as any).getState().addToLibrary;\n" +
      "            await addFn({\n" +
      "              id: contentId,\n" +
      "              imdb_id: contentId && String(contentId).startsWith('tt') ? contentId : undefined,\n" +
      "              name: title,\n" +
      "              type: contentType,\n" +
      "              poster: (item as any).poster || '',\n" +
      "            });\n" +
      "          } catch (e) { console.log('[V176K] add error:', e); }\n" +
      "          try { onAfterChange && onAfterChange('added'); } catch (_) {}\n" +
      "        },\n" +
      "      });\n" +
      "    }\n" +
      "  }\n" +
      "  return { title, actions };\n" +
      "}\n" +
      "\n" +
      "/* The popover host.  Mount ONE per screen.  When multiple are mounted,\n" +
      "   each receives the open event independently, but Modal renders at the\n" +
      "   platform root so only the top-most is visible.  This keeps things\n" +
      "   simple — no global coordination needed. */\n" +
      "export const V176kPopover: React.FC = () => {\n" +
      "  const [open, setOpen] = useState(false);\n" +
      "  const [payload, setPayload] = useState<V176kOpenPayload | null>(null);\n" +
      "\n" +
      "  useEffect(() => {\n" +
      "    const sub = DeviceEventEmitter.addListener('v176k:open', (p: V176kOpenPayload) => {\n" +
      "      setPayload(p);\n" +
      "      setOpen(true);\n" +
      "    });\n" +
      "    const closeSub = DeviceEventEmitter.addListener('v176k:close', () => setOpen(false));\n" +
      "    return () => { try { sub.remove(); } catch (_) {} try { closeSub.remove(); } catch (_) {} };\n" +
      "  }, []);\n" +
      "\n" +
      "  const dismiss = useCallback(() => setOpen(false), []);\n" +
      "  const runAction = useCallback((a: V176kAction) => {\n" +
      "    setOpen(false);\n" +
      "    // Delay slightly so the close animation can start before the action\n" +
      "    // triggers anything heavy (e.g. fetchLibrary).\n" +
      "    setTimeout(() => { try { a.onPress(); } catch (e) { console.log('[V176K] action error:', e); } }, 50);\n" +
      "  }, []);\n" +
      "\n" +
      "  if (!open || !payload) return null;\n" +
      "\n" +
      "  // Position: top-right corner of the poster, popping out RIGHT + DOWN.\n" +
      "  // If that clips off-screen, fall back to centering horizontally and\n" +
      "  // anchoring below the poster.\n" +
      "  const win = Dimensions.get('window');\n" +
      "  const POPOVER_WIDTH = 260;\n" +
      "  const ROW_HEIGHT = 48;\n" +
      "  const padding = 8;\n" +
      "  const popoverHeight = (payload.actions.length * ROW_HEIGHT) + (payload.title ? 36 : 0) + 12;\n" +
      "  let left: number;\n" +
      "  let top: number;\n" +
      "  if (payload.anchor) {\n" +
      "    // Start at poster's right edge minus some inset so it overlaps slightly.\n" +
      "    left = payload.anchor.x + Math.max(0, payload.anchor.width - 60);\n" +
      "    top = payload.anchor.y + 20;\n" +
      "    // Clamp horizontally.\n" +
      "    if (left + POPOVER_WIDTH > win.width - padding) {\n" +
      "      left = Math.max(padding, win.width - POPOVER_WIDTH - padding);\n" +
      "    }\n" +
      "    // Clamp vertically.\n" +
      "    if (top + popoverHeight > win.height - padding) {\n" +
      "      top = Math.max(padding, win.height - popoverHeight - padding);\n" +
      "    }\n" +
      "    if (top < padding) top = padding;\n" +
      "    if (left < padding) left = padding;\n" +
      "  } else {\n" +
      "    left = Math.floor((win.width - POPOVER_WIDTH) / 2);\n" +
      "    top = Math.floor((win.height - popoverHeight) / 2);\n" +
      "  }\n" +
      "\n" +
      "  return (\n" +
      "    <Modal\n" +
      "      transparent\n" +
      "      visible={open}\n" +
      "      animationType=\"fade\"\n" +
      "      onRequestClose={dismiss}\n" +
      "      statusBarTranslucent\n" +
      "    >\n" +
      "      <Pressable style={v176kStyles.backdrop} onPress={dismiss}>\n" +
      "        <View\n" +
      "          style={[\n" +
      "            v176kStyles.popover,\n" +
      "            { left, top, width: POPOVER_WIDTH },\n" +
      "          ]}\n" +
      "          /* Stop press propagation so tapping inside the popover does not\n" +
      "             dismiss it via the backdrop. */\n" +
      "          onStartShouldSetResponder={() => true}\n" +
      "        >\n" +
      "          {payload.title ? (\n" +
      "            <Text numberOfLines={1} style={v176kStyles.title}>{payload.title}</Text>\n" +
      "          ) : null}\n" +
      "          {payload.actions.map((a, i) => (\n" +
      "            <V176kRow key={a.id} action={a} isFirst={i === 0} onSelect={runAction} />\n" +
      "          ))}\n" +
      "        </View>\n" +
      "      </Pressable>\n" +
      "    </Modal>\n" +
      "  );\n" +
      "};\n" +
      "\n" +
      "const V176kRow: React.FC<{ action: V176kAction; isFirst: boolean; onSelect: (a: V176kAction) => void }> = ({ action, isFirst, onSelect }) => {\n" +
      "  const [focused, setFocused] = useState(false);\n" +
      "  return (\n" +
      "    <Pressable\n" +
      "      hasTVPreferredFocus={isFirst}\n" +
      "      focusable={true}\n" +
      "      onPress={() => onSelect(action)}\n" +
      "      onFocus={() => setFocused(true)}\n" +
      "      onBlur={() => setFocused(false)}\n" +
      "      android_ripple={null}\n" +
      "      style={[v176kStyles.row, focused && v176kStyles.rowFocused]}\n" +
      "    >\n" +
      "      {focused ? <View style={v176kStyles.focusBar} /> : null}\n" +
      "      {action.icon ? (\n" +
      "        <Ionicons\n" +
      "          name={action.icon as any}\n" +
      "          size={18}\n" +
      "          color={focused ? colors.primary : (action.destructive ? '#ff5757' : 'rgba(255,255,255,0.85)')}\n" +
      "          style={v176kStyles.rowIcon}\n" +
      "        />\n" +
      "      ) : null}\n" +
      "      <Text\n" +
      "        numberOfLines={1}\n" +
      "        style={[\n" +
      "          v176kStyles.rowLabel,\n" +
      "          focused && v176kStyles.rowLabelFocused,\n" +
      "          action.destructive && !focused && v176kStyles.rowLabelDestructive,\n" +
      "        ]}\n" +
      "      >\n" +
      "        {action.label}\n" +
      "      </Text>\n" +
      "    </Pressable>\n" +
      "  );\n" +
      "};\n" +
      "\n" +
      "const v176kStyles = StyleSheet.create({\n" +
      "  backdrop: {\n" +
      "    flex: 1,\n" +
      "    backgroundColor: 'rgba(0,0,0,0.45)',\n" +
      "  },\n" +
      "  popover: {\n" +
      "    position: 'absolute',\n" +
      "    backgroundColor: 'rgba(20, 22, 36, 0.97)',\n" +
      "    borderRadius: 10,\n" +
      "    borderWidth: 1,\n" +
      "    borderColor: 'rgba(184, 160, 92, 0.35)',\n" +
      "    paddingVertical: 6,\n" +
      "    shadowColor: '#000',\n" +
      "    shadowOpacity: 0.5,\n" +
      "    shadowRadius: 12,\n" +
      "    shadowOffset: { width: 0, height: 6 },\n" +
      "    elevation: 24,\n" +
      "  },\n" +
      "  title: {\n" +
      "    color: 'rgba(255,255,255,0.55)',\n" +
      "    fontSize: 12,\n" +
      "    fontWeight: '600',\n" +
      "    letterSpacing: 0.4,\n" +
      "    textTransform: 'uppercase',\n" +
      "    paddingHorizontal: 14,\n" +
      "    paddingTop: 10,\n" +
      "    paddingBottom: 6,\n" +
      "  },\n" +
      "  row: {\n" +
      "    flexDirection: 'row',\n" +
      "    alignItems: 'center',\n" +
      "    paddingHorizontal: 14,\n" +
      "    height: 48,\n" +
      "    position: 'relative',\n" +
      "  },\n" +
      "  rowFocused: {\n" +
      "    backgroundColor: 'rgba(184, 160, 92, 0.16)',\n" +
      "  },\n" +
      "  focusBar: {\n" +
      "    position: 'absolute',\n" +
      "    left: 0,\n" +
      "    top: 8,\n" +
      "    bottom: 8,\n" +
      "    width: 3,\n" +
      "    backgroundColor: colors.primary,\n" +
      "    borderRadius: 2,\n" +
      "  },\n" +
      "  rowIcon: {\n" +
      "    marginRight: 10,\n" +
      "    width: 22,\n" +
      "    textAlign: 'center',\n" +
      "  },\n" +
      "  rowLabel: {\n" +
      "    flex: 1,\n" +
      "    color: 'rgba(255,255,255,0.92)',\n" +
      "    fontSize: 15,\n" +
      "    fontWeight: '500',\n" +
      "  },\n" +
      "  rowLabelFocused: {\n" +
      "    color: colors.primary,\n" +
      "    fontWeight: '700',\n" +
      "  },\n" +
      "  rowLabelDestructive: {\n" +
      "    color: '#ff8080',\n" +
      "  },\n" +
      "});\n" +
      "\n" +
      "/* Helper measure utility callers can use to grab a poster rect before\n" +
      "   emitting open.  Returns null on failure so callers can fall back to\n" +
      "   centered placement. */\n" +
      "export function v176kMeasureAnchor(ref: any): Promise<{ x: number; y: number; width: number; height: number } | null> {\n" +
      "  return new Promise((resolve) => {\n" +
      "    try {\n" +
      "      const handle = findNodeHandle(ref);\n" +
      "      if (!handle) return resolve(null);\n" +
      "      UIManager.measureInWindow(handle, (x: number, y: number, width: number, height: number) => {\n" +
      "        if (typeof x !== 'number' || isNaN(x)) return resolve(null);\n" +
      "        resolve({ x, y, width, height });\n" +
      "      });\n" +
      "    } catch (_) {\n" +
      "      resolve(null);\n" +
      "    }\n" +
      "  });\n" +
      "}\n" +
      "/* ─── /V176K_POPOVER ───────────────────────────────────────────────────── */\n" +
      "\n";

    // Replace the variant we matched with: variant + popoverBlock + variant's
    // closing line.  Just insert the block BEFORE `export function v160GetPoster`.
    src = src.replace(
      'export function v160GetPoster',
      popoverBlock + 'export function v160GetPoster'
    );
    changes++;

    // 1c) Rewrite the body of v176ShowLongPressMenu to route through the
    //     popover instead of Alert.  Anchor on its full current body.
    //     We'll detect both v176j (cancelable) and pre-v176j variants.
    const oldBodyV176j =
      'export function v176ShowLongPressMenu(opts: {\n' +
      '  item: any;\n' +
      '  inLibraryOverride?: boolean | null;\n' +
      '  hasProgressOverride?: boolean | null;\n' +
      "  onAfterChange?: (action: 'watched' | 'unwatched' | 'cleared' | 'added' | 'removed') => void;\n" +
      '}): void {';
    if (src.indexOf(oldBodyV176j) === -1) {
      console.error('[v176k] FATAL: ContentCard.tsx — could not locate v176ShowLongPressMenu signature.');
      process.exit(4);
    }
    // We need to surgically replace just the body — find the function and
    // overwrite up to the matching closing brace `Alert.alert(...)\n}`.
    // Simpler: locate the WHOLE function block and replace.
    // Body starts at "export function v176ShowLongPressMenu(opts:" and ends at
    // the line "Alert.alert(title, undefined, buttons" (v176j) or
    // similar then `}` then `export function v160GetPoster`.
    // The v176k popoverBlock we already injected ends with the closing comment
    // and then 'export function v160GetPoster'.  Now we need to ALSO swap the
    // OLD v176ShowLongPressMenu body to call v176kEmitOpen.
    const funcStart = src.indexOf(oldBodyV176j);
    const funcEnd   = src.indexOf("\n}\n/* ─── V176K_POPOVER", funcStart);
    if (funcEnd === -1) {
      console.error('[v176k] FATAL: ContentCard.tsx — could not find end of v176ShowLongPressMenu (expected popover block right after).');
      process.exit(5);
    }
    const newFuncBody =
      'export function v176ShowLongPressMenu(opts: {\n' +
      '  item: any;\n' +
      '  inLibraryOverride?: boolean | null;\n' +
      '  hasProgressOverride?: boolean | null;\n' +
      '  anchor?: { x: number; y: number; width: number; height: number } | null;\n' +
      "  onAfterChange?: (action: 'watched' | 'unwatched' | 'cleared' | 'added' | 'removed') => void;\n" +
      '}): void {\n' +
      '  /* V176K_POPOVER — emit the open event instead of calling Alert.alert.\n' +
      '     Every screen that hosts a <V176kPopover /> will render the menu. */\n' +
      '  const { item, inLibraryOverride, hasProgressOverride, anchor, onAfterChange } = opts || ({} as any);\n' +
      '  if (!item) return;\n' +
      '  const { title, actions } = v176kBuildActions({\n' +
      '    item,\n' +
      '    inLibrary: !!inLibraryOverride,\n' +
      '    hasProgress: hasProgressOverride == null ? undefined : !!hasProgressOverride,\n' +
      '    onAfterChange,\n' +
      '  });\n' +
      '  if (!actions.length) return;\n' +
      '  v176kEmitOpen({ anchor: anchor || null, title, actions });\n' +
      '}';
    src = src.substring(0, funcStart) + newFuncBody + src.substring(funcEnd + 2);
    // (+2 to skip the "\n}" we replaced inline above)
    changes++;

    // 1d) Add anchor measurement to ContentCardComponent's handleLongPress so
    //     Discover/Search posters get a properly anchored popover (not the
    //     centered fallback).
    const oldHandle =
      '  const handleLongPress = useCallback(() => {\n' +
      '    /* V176_LONGPRESS_MENU — delegate to the unified Stremio-style menu.\n' +
      '       inLibrary is the local component flag (parent-set OR toggled by a\n' +
      '       previous Add).  After Add/Remove resolves we flip the local flag\n' +
      '       and notify any parent listener. */\n' +
      '    v176ShowLongPressMenu({\n' +
      '      item,\n' +
      '      inLibraryOverride: isInLibrary,\n' +
      '      onAfterChange: (action) => {\n' +
      "        if (action === 'added') setIsInLibrary(true);\n" +
      "        if (action === 'removed') setIsInLibrary(false);\n" +
      "        if (action === 'added' || action === 'removed') {\n" +
      '          try { onLibraryChange && onLibraryChange(); } catch (_) {}\n' +
      '        }\n' +
      '      },\n' +
      '    });\n' +
      '  }, [item, isInLibrary, onLibraryChange, _v172IsWatched, _v172ContentId]);';
    if (src.indexOf(oldHandle) !== -1) {
      const newHandle =
        '  const handleLongPress = useCallback(async () => {\n' +
        '    /* V176K_POPOVER — measure poster so the popover anchors from its\n' +
        '       corner instead of the centered fallback. */\n' +
        '    let anchor: any = null;\n' +
        '    try { anchor = await v176kMeasureAnchor(pressableRef.current); } catch (_) {}\n' +
        '    v176ShowLongPressMenu({\n' +
        '      item,\n' +
        '      inLibraryOverride: isInLibrary,\n' +
        '      anchor,\n' +
        '      onAfterChange: (action) => {\n' +
        "        if (action === 'added') setIsInLibrary(true);\n" +
        "        if (action === 'removed') setIsInLibrary(false);\n" +
        "        if (action === 'added' || action === 'removed') {\n" +
        '          try { onLibraryChange && onLibraryChange(); } catch (_) {}\n' +
        '        }\n' +
        '      },\n' +
        '    });\n' +
        '  }, [item, isInLibrary, onLibraryChange, _v172IsWatched, _v172ContentId]);';
      src = src.replace(oldHandle, newHandle);
      changes++;
    } else {
      console.log('[v176k] WARN: ContentCard handleLongPress anchor not found — popover will use centered fallback on Discover/Search.');
    }

    write(file, src);
    console.log(`[v176k] ContentCard.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  Helper to mount <V176kPopover /> at a screen root.
// ═════════════════════════════════════════════════════════════════════════════
function injectPopoverImport(src, relPath) {
  // relPath e.g. '../../src/components/ContentCard' or '../../../src/components/ContentCard'
  // We extend the FIRST import line that pulls from ContentCard with the popover
  // named exports.  This way we don't duplicate imports.
  const ccImportRegex = /import\s*\{([\s\S]*?)\}\s*from\s*'([^']+\/ContentCard)';/;
  const m = src.match(ccImportRegex);
  if (!m) return null;
  if (m[1].indexOf('V176kPopover') !== -1) return src; // already done
  const newImports = m[1].replace(/\s*$/, '').replace(/,\s*$/, '') +
    ',\n  /* V176K_POPOVER */ V176kPopover, v176kMeasureAnchor';
  const replaced = `import {${newImports}\n} from '${m[2]}';`;
  return src.replace(m[0], replaced);
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 2 — app/(tabs)/library.tsx
//    Mount <V176kPopover /> + measure-and-emit in LibraryCard._v176OpenMenu
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = LIBRARY_PATH;
  let src = read(file);

  if (src.indexOf('V176K_POPOVER_MOUNTED') !== -1) {
    console.log('[v176k] library.tsx: already patched, skipping');
  } else {
    let changes = 0;

    // 2a) Extend the existing ContentCard import to also include V176kPopover
    //     and v176kMeasureAnchor.
    const extended = injectPopoverImport(src, '../../src/components/ContentCard');
    if (extended === null) {
      console.error('[v176k] FATAL: library.tsx — could not extend ContentCard import.');
      process.exit(6);
    }
    if (extended !== src) {
      src = extended;
      changes++;
    }

    // 2b) Mount <V176kPopover /> at the screen root.  Anchor on the existing
    //     `<SafeAreaView style={styles.container} edges={['top']}>` line.
    const safeAreaAnchor = '    <SafeAreaView style={styles.container} edges={[\'top\']}>';
    if (src.indexOf(safeAreaAnchor) === -1) {
      console.error('[v176k] FATAL: library.tsx — could not locate SafeAreaView root.');
      process.exit(7);
    }
    src = src.replace(
      safeAreaAnchor,
      safeAreaAnchor + '\n' +
      '      {/* V176K_POPOVER_MOUNTED — Stremio-style menu host for this screen. */}\n' +
      '      <V176kPopover />'
    );
    changes++;

    // 2c) Rewrite LibraryCard._v176OpenMenu to MEASURE the poster, then call
    //     v176ShowLongPressMenu({...anchor}).  Replace the existing function
    //     body (it currently uses _v176ShowLongPressMenu with no anchor).
    const oldOpen =
      '  const _v176OpenMenu = useCallback(() => {\n' +
      '    _v176ShowLongPressMenu({\n' +
      '      item: { ...(item as any), content_id: _v176ContentId, content_type: (item as any).type },\n' +
      '      inLibraryOverride: true,\n' +
      '      hasProgressOverride: _v176HasProg,\n' +
      '      onAfterChange: (action) => {\n' +
      "        if (action === 'removed') { try { onRemove && onRemove(); } catch (_) {} }\n" +
      '      },\n' +
      '    });\n' +
      '  }, [item, _v176ContentId, _v176HasProg, onRemove]);';
    if (src.indexOf(oldOpen) === -1) {
      console.error('[v176k] FATAL: library.tsx — could not locate LibraryCard _v176OpenMenu.');
      process.exit(8);
    }
    const newOpen =
      '  const _v176OpenMenu = useCallback(async () => {\n' +
      '    /* V176K_POPOVER_MOUNTED — measure the poster so the menu anchors\n' +
      '       from its corner, then emit through the existing v176 helper. */\n' +
      '    let anchor: any = null;\n' +
      '    try { anchor = await v176kMeasureAnchor(posterRef.current); } catch (_) {}\n' +
      '    _v176ShowLongPressMenu({\n' +
      '      item: { ...(item as any), content_id: _v176ContentId, content_type: (item as any).type },\n' +
      '      inLibraryOverride: true,\n' +
      '      hasProgressOverride: _v176HasProg,\n' +
      '      anchor,\n' +
      '      onAfterChange: (action) => {\n' +
      "        if (action === 'removed') { try { onRemove && onRemove(); } catch (_) {} }\n" +
      '      },\n' +
      '    });\n' +
      '  }, [item, _v176ContentId, _v176HasProg, onRemove]);';
    src = src.replace(oldOpen, newOpen);
    changes++;

    write(file, src);
    console.log(`[v176k] library.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 3 — app/(tabs)/discover.tsx
//    Mount <V176kPopover /> + measure-and-emit in ContinueWatchingItem
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = DISCOVER_PATH;
  let src = read(file);

  if (src.indexOf('V176K_POPOVER_MOUNTED') !== -1) {
    console.log('[v176k] discover.tsx: already patched, skipping');
  } else {
    let changes = 0;

    const extended = injectPopoverImport(src, '../../src/components/ContentCard');
    if (extended === null) {
      console.error('[v176k] FATAL: discover.tsx — could not extend ContentCard import.');
      process.exit(9);
    }
    if (extended !== src) {
      src = extended;
      changes++;
    }

    // Mount popover.  Anchor on the existing root SafeAreaView line.
    const safeAreaAnchor = '    <SafeAreaView style={styles.container} edges={[\'top\']}>';
    if (src.indexOf(safeAreaAnchor) === -1) {
      console.error('[v176k] FATAL: discover.tsx — could not locate SafeAreaView root.');
      process.exit(10);
    }
    src = src.replace(
      safeAreaAnchor,
      safeAreaAnchor + '\n' +
      '      {/* V176K_POPOVER_MOUNTED — Stremio-style menu host for this screen. */}\n' +
      '      <V176kPopover />'
    );
    changes++;

    // Rewrite ContinueWatchingItem._v176OpenMenu to measure + anchor.
    const oldOpen =
      '  const _v176OpenMenu = useCallback(() => {\n' +
      '    _v176ShowLongPressMenu({\n' +
      '      item: {\n' +
      '        content_id: _v176ContentId,\n' +
      "        content_type: (item as any).content_type || (item as any).type || 'movie',\n" +
      '        title: (item as any).title,\n' +
      '        name: (item as any).title,\n' +
      '        poster: (item as any).poster || (item as any).backdrop,\n' +
      '      },\n' +
      '      inLibraryOverride: false,\n' +
      '      hasProgressOverride: true,\n' +
      '      onAfterChange: (action) => {\n' +
      "        if (action === 'cleared') { try { onRemove && onRemove(); } catch (_) {} }\n" +
      '      },\n' +
      '    });\n' +
      '  }, [item, _v176ContentId, onRemove]);';
    if (src.indexOf(oldOpen) === -1) {
      console.error('[v176k] FATAL: discover.tsx — could not locate ContinueWatchingItem _v176OpenMenu.');
      process.exit(11);
    }
    const newOpen =
      '  const _v176OpenMenu = useCallback(async () => {\n' +
      '    /* V176K_POPOVER_MOUNTED — measure poster + emit via v176 helper. */\n' +
      '    let anchor: any = null;\n' +
      '    try { anchor = await v176kMeasureAnchor(posterRef.current); } catch (_) {}\n' +
      '    _v176ShowLongPressMenu({\n' +
      '      item: {\n' +
      '        content_id: _v176ContentId,\n' +
      "        content_type: (item as any).content_type || (item as any).type || 'movie',\n" +
      '        title: (item as any).title,\n' +
      '        name: (item as any).title,\n' +
      '        poster: (item as any).poster || (item as any).backdrop,\n' +
      '      },\n' +
      '      inLibraryOverride: false,\n' +
      '      hasProgressOverride: true,\n' +
      '      anchor,\n' +
      '      onAfterChange: (action) => {\n' +
      "        if (action === 'cleared') { try { onRemove && onRemove(); } catch (_) {} }\n" +
      '      },\n' +
      '    });\n' +
      '  }, [item, _v176ContentId, onRemove]);';
    src = src.replace(oldOpen, newOpen);
    changes++;

    write(file, src);
    console.log(`[v176k] discover.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 4 — app/details/[type]/[id].tsx
//    Mount popover + reroute EpisodeCard to use v176kEmitOpen with episode-only set
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = ID_PATH;
  let src = read(file);

  if (src.indexOf('V176K_POPOVER_MOUNTED') !== -1) {
    console.log('[v176k] details/[type]/[id].tsx: already patched, skipping');
  } else {
    let changes = 0;

    // 4a) Extend imports — the v173RegLP import line already pulls from
    //     ContentCard.  Use the same helper to inject popover + buildActions.
    const ccImportRegex = /import\s*\{([\s\S]*?)\}\s*from\s*'\.\.\/\.\.\/\.\.\/src\/components\/ContentCard';/;
    const m = src.match(ccImportRegex);
    if (!m) {
      console.error('[v176k] FATAL: id.tsx — could not locate ContentCard import.');
      process.exit(12);
    }
    if (m[1].indexOf('V176kPopover') === -1) {
      const newImports = m[1].replace(/\s*$/, '').replace(/,\s*$/, '') +
        ',\n  /* V176K_POPOVER */ V176kPopover, v176kMeasureAnchor, v176kEmitOpen, v176kBuildActions';
      src = src.replace(m[0], `import {${newImports}\n} from '../../../src/components/ContentCard';`);
      changes++;
    }

    // 4b) Mount <V176kPopover /> near the root of the detail screen.  Try
    //     SafeAreaView first, then fall back to the root `<View
    //     style={styles.container}>` from the main return.
    const safeAreaCandidates = [
      '    <SafeAreaView style={styles.container} edges={[\'top\']}>',
      '    <SafeAreaView style={styles.container}>',
      '    <View style={styles.container}>',
    ];
    let mountedHere = false;
    for (const anchorLine of safeAreaCandidates) {
      if (src.indexOf(anchorLine) !== -1) {
        src = src.replace(
          anchorLine,
          anchorLine + '\n' +
          '      {/* V176K_POPOVER_MOUNTED — Stremio-style menu host for this screen. */}\n' +
          '      <V176kPopover />'
        );
        changes++;
        mountedHere = true;
        break;
      }
    }
    if (!mountedHere) {
      console.error('[v176k] FATAL: id.tsx — could not find screen-root container to mount popover.');
      process.exit(13);
    }

    // 4c) Reroute _v176cOpenEpMenu to measure + emit via v176kEmitOpen with
    //     episode-only action set.  The existing implementation uses
    //     _V176cAlert.alert; replace its body.
    const oldOpenBody =
      '  const _v176cOpenEpMenu = useCallback(() => {\n' +
      '    const id = _v176cEpId;\n' +
      '    if (!id) return;\n' +
      '    const watchedNow = !!isWatched || _v176cV172IsWatched(id);\n' +
      '    const hasProg = _v176cV176HasProg(id);\n' +
      "    const title = `S${(episode as any).season ?? '?'} · E${(episode as any).episode ?? '?'}`\n" +
      "      + ((episode as any).name ? ` — ${(episode as any).name}` : '');\n" +
      '    const buttons: any[] = [];\n' +
      '    if (hasProg) {\n' +
      "      buttons.push({ text: 'Clear Progress', onPress: () => { _v176cV176Clear(id); } });\n" +
      '    }\n' +
      '    if (watchedNow) {\n' +
      "      buttons.push({ text: 'Mark as Unwatched', onPress: () => { _v176cV172Unmark(id); try { onMarkUnwatched && onMarkUnwatched(); } catch (_) {} } });\n" +
      '    } else {\n' +
      "      buttons.push({ text: 'Mark as Watched', onPress: () => { _v176cV176Mark(id); } });\n" +
      '    }\n' +
      '    /* V176I_EPISODE_PAINT — Cancel removed; back button dismisses Alert. */\n' +
      '    /* V176J_EPISODE_CANCELABLE — cancelable=true so hardware Back\n' +
      '       dismisses the menu (Cancel button was removed in v176i). */\n' +
      '    _V176cAlert.alert(title, undefined, buttons, { cancelable: true });\n' +
      '  }, [episode, isWatched, onMarkUnwatched, _v176cEpId]);';
    if (src.indexOf(oldOpenBody) === -1) {
      console.error('[v176k] FATAL: id.tsx — could not locate _v176cOpenEpMenu body (post v176i/j).');
      process.exit(14);
    }
    const newOpenBody =
      '  const _v176cOpenEpMenu = useCallback(async () => {\n' +
      '    const id = _v176cEpId;\n' +
      '    if (!id) return;\n' +
      "    const title = `S${(episode as any).season ?? '?'} \\u00B7 E${(episode as any).episode ?? '?'}`\n" +
      "      + ((episode as any).name ? ` \\u2014 ${(episode as any).name}` : '');\n" +
      '    /* V176K_POPOVER_MOUNTED — episodes use a custom action set (no Library). */\n' +
      '    const actions: any[] = [];\n' +
      '    const hasProg = _v176cV176HasProg(id);\n' +
      '    if (hasProg) {\n' +
      "      actions.push({ id: 'clear', label: 'Clear Progress', icon: 'refresh-circle-outline',\n" +
      "        onPress: () => { _v176cV176Clear(id); } });\n" +
      '    }\n' +
      '    const watchedNow = !!isWatched || _v176cV172IsWatched(id);\n' +
      '    if (watchedNow) {\n' +
      "      actions.push({ id: 'unwatch', label: 'Mark as Unwatched', icon: 'eye-off-outline',\n" +
      "        onPress: () => { _v176cV172Unmark(id); try { onMarkUnwatched && onMarkUnwatched(); } catch (_) {} } });\n" +
      '    } else {\n' +
      "      actions.push({ id: 'watch', label: 'Mark as Watched', icon: 'checkmark-circle-outline',\n" +
      "        onPress: () => { _v176cV176Mark(id); } });\n" +
      '    }\n' +
      '    if (!actions.length) return;\n' +
      '    let anchor: any = null;\n' +
      '    try { anchor = await v176kMeasureAnchor(pressableRef.current); } catch (_) {}\n' +
      '    v176kEmitOpen({ anchor, title, actions });\n' +
      '  }, [episode, isWatched, onMarkUnwatched, _v176cEpId]);';
    src = src.replace(oldOpenBody, newOpenBody);
    changes++;

    write(file, src);
    console.log(`[v176k] details/[type]/[id].tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

console.log('');
console.log(`[v176k] DONE.  ${totalChanges} total change(s).`);
console.log('[v176k] Pure JS — Metro reload OR rebuild + sideload both work.');
console.log('');
console.log('After install, verify:');
console.log('  1. Long-press any poster on Discover, Library, Continue Watching,');
console.log('     or an episode in a series → Stremio-style dark popover with');
console.log('     gold focus appears anchored to the poster.');
console.log('  2. D-pad up/down navigates rows (gold left bar + gold text on');
console.log('     focused row).');
console.log('  3. OK selects → action fires → popover dismisses.');
console.log('  4. Back button dismisses the popover.');
console.log('  5. Tap outside the popover (touch) → dismisses.');
