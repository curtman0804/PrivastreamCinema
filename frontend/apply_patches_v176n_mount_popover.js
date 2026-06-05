/*
 * apply_patches_v176n_mount_popover.js
 *
 * V176N — Mount the V176kPopover host that v176k forgot to wire in.
 *
 *   Confirmed live by v176m diagnostic:
 *     • Native long-press fires.
 *     • JS dispatcher fires.
 *     • handleLongPress runs (Alert "LP fired" appeared on screen).
 *     • v176kEmitOpen emits 'v176k:open' into the void — no <V176kPopover/>
 *       host is mounted on any screen.
 *
 *   This patch solves it WITHOUT touching screen files (which uploads are
 *   stale for) by adding a self-mounting singleton host inside ContentCard
 *   itself.  First card to render claims the host slot; siblings stay
 *   silent.  When the owner unmounts, the next surviving card claims.
 *   Net effect: anywhere a ContentCard exists, the popover host exists.
 *
 *   Also:
 *     1) Removes the v176m diagnostic Alert (its job is done).
 *     2) Keeps the two cheap [V176M] dispatcher / focus-reg logs for one
 *        more verification round.  They only fire on focus change & long-
 *        press (NOT per keypress) so they cannot cause lag.
 *
 *   Idempotent.  CRLF preserved.  Pure JS — Metro reload OR rebuild.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CC_PATH = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');

let _eol = 'lf';
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v176n] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eol = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eol === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eol === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v176n] wrote ${path.relative(ROOT, p) || p} (${_eol.toUpperCase()})`);
}

let src = read(CC_PATH);

if (src.indexOf('V176N_HOST_SINGLETON') !== -1) {
  console.log('[v176n] ContentCard.tsx: already patched, skipping');
  process.exit(0);
}

let changes = 0;

// ─── 1) Drop the v176m diagnostic Alert ──────────────────────────────────
const oldDiagAlert =
  '    /* V176M_DIAG — synchronous popup so we can SEE that handleLongPress\n' +
  '       actually ran on the device.  If this Alert appears but no Stremio\n' +
  '       popover follows, the dispatch chain is fine and the missing piece\n' +
  '       is the <V176kPopover/> host being unmounted on this screen. */\n' +
  "    try { Alert.alert('LP fired', String((item as any)?.name || (item as any)?.title || 'unknown')); } catch (_) {}\n";
if (src.indexOf(oldDiagAlert) !== -1) {
  src = src.replace(oldDiagAlert, '');
  changes++;
  console.log('[v176n] removed v176m diagnostic Alert');
} else {
  console.log('[v176n] note: v176m Alert not present (already removed?)');
}

// ─── 2) Inject singleton claim infrastructure ────────────────────────────
//     Anchor on the closing comment of the V176K_POPOVER block; the new
//     singleton wrapper sits immediately after V176kPopover is defined.
const singletonAnchor = '/* ─── /V176K_POPOVER ───────────────────────────────────────────────────── */';
const singletonInject =
  '/* V176N_HOST_SINGLETON — v176k defined V176kPopover but never mounted it\n' +
  '   on any screen, so long-press emitted into the void.  This singleton\n' +
  '   wrapper auto-mounts ONE popover host per app instance: every\n' +
  '   ContentCard renders a <V176kPopoverHost/> sibling, but only the first\n' +
  '   to mount claims the slot and actually renders <V176kPopover/>.  When\n' +
  '   the owner unmounts, the next claimant takes over.  Net effect: as\n' +
  '   long as ANY ContentCard exists on the screen, the popover works. */\n' +
  'let _v176nHostClaim: string | null = null;\n' +
  'const _v176nHostSubs = new Set<() => void>();\n' +
  'function _v176nTryClaim(id: string): boolean {\n' +
  '  if (!_v176nHostClaim) { _v176nHostClaim = id; return true; }\n' +
  '  return _v176nHostClaim === id;\n' +
  '}\n' +
  'function _v176nRelease(id: string): void {\n' +
  '  if (_v176nHostClaim === id) {\n' +
  '    _v176nHostClaim = null;\n' +
  '    _v176nHostSubs.forEach((cb) => { try { cb(); } catch (_) {} });\n' +
  '  }\n' +
  '}\n' +
  'export const V176kPopoverHost: React.FC = () => {\n' +
  '  const idRef = useRef<string>(Math.random().toString(36).slice(2));\n' +
  '  const [owner, setOwner] = useState<boolean>(false);\n' +
  '  useEffect(() => {\n' +
  '    const id = idRef.current;\n' +
  '    if (_v176nTryClaim(id)) {\n' +
  '      setOwner(true);\n' +
  '      return () => { _v176nRelease(id); };\n' +
  '    }\n' +
  '    const recheck = () => { if (_v176nTryClaim(id)) setOwner(true); };\n' +
  '    _v176nHostSubs.add(recheck);\n' +
  '    return () => { _v176nHostSubs.delete(recheck); _v176nRelease(id); };\n' +
  '  }, []);\n' +
  '  if (!owner) return null;\n' +
  '  return <V176kPopover />;\n' +
  '};\n\n' +
  singletonAnchor;
if (src.indexOf(singletonAnchor) !== -1 && src.indexOf('V176kPopoverHost') === -1) {
  src = src.replace(singletonAnchor, singletonInject);
  changes++;
  console.log('[v176n] injected V176kPopoverHost singleton wrapper');
} else if (src.indexOf('V176kPopoverHost') !== -1) {
  console.log('[v176n] note: V176kPopoverHost already exists');
} else {
  console.error('[v176n] FATAL: V176K_POPOVER anchor not found.  Are you on v176k?');
  process.exit(2);
}

// ─── 3) Render the host inside every ContentCard return ──────────────────
//     The current return statement is a single <Pressable>...</Pressable>.
//     Wrap in a Fragment so we can render the host as a sibling.  We do
//     this surgically by editing the opening tag and the final closing
//     tag of the JSX returned from ContentCardComponent.
const returnAnchor =
  '  return (\n' +
  '    <Pressable\n' +
  '      ref={pressableRef}\n' +
  '      focusable={true}';
const returnInject =
  '  return (\n' +
  '    /* V176N_HOST_SINGLETON — render the popover host alongside every\n' +
  '       card.  Only one will actually display (singleton claim above). */\n' +
  '    <React.Fragment>\n' +
  '    <V176kPopoverHost />\n' +
  '    <Pressable\n' +
  '      ref={pressableRef}\n' +
  '      focusable={true}';
if (src.indexOf(returnAnchor) !== -1) {
  src = src.replace(returnAnchor, returnInject);
  changes++;
  console.log('[v176n] wrapped ContentCard return in React.Fragment + injected host');
} else {
  console.error('[v176n] FATAL: ContentCard return-anchor not found.  Bailing.');
  process.exit(3);
}

// Find the matching closing </Pressable> for the ContentCard root.
// In the current file it is the last </Pressable> before
//   `};` followed by `export const ContentCard = memo(ContentCardComponent);`
// We can safely anchor on that distinctive sequence.
const closeAnchor =
  '    </Pressable>\n' +
  '  );\n' +
  '};\n' +
  '\n' +
  'export const ContentCard = memo(ContentCardComponent);';
const closeInject =
  '    </Pressable>\n' +
  '    </React.Fragment>\n' +
  '  );\n' +
  '};\n' +
  '\n' +
  'export const ContentCard = memo(ContentCardComponent);';
if (src.indexOf(closeAnchor) !== -1) {
  src = src.replace(closeAnchor, closeInject);
  changes++;
  console.log('[v176n] closed React.Fragment after root </Pressable>');
} else {
  console.error('[v176n] FATAL: ContentCard close-anchor not found.  Bailing.');
  process.exit(4);
}

if (changes > 0) {
  // Tag for idempotency.  The marker block already includes V176M_DIAG so
  // we just append our marker after it.
  src = src.replace(
    '/* V176M_DIAG marker */',
    '/* V176M_DIAG marker */\n  /* V176N_HOST_SINGLETON marker */'
  );
  write(CC_PATH, src);
  console.log(`[v176n] DONE.  ${changes} change(s) applied.`);
  console.log('[v176n] Next: Metro reload (press r in your Metro terminal).');
  console.log('[v176n] Then cold-start the app and hold OK on a poster.');
  console.log('[v176n] You should now see the dark Stremio-style popover.');
} else {
  console.log('[v176n] nothing changed.  File may already be patched.');
}
