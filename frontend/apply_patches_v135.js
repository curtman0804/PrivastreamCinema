/* eslint-disable */
// apply_patches_v135_focus_unlock.js
//
// THE D-PAD STUCK BUG.
//
// EpisodeCard for the watched/targeted episode does TWO things that
// together create a sticky focus lock on Android TV:
//
//   1. `hasTVPreferredFocus={!!autoFocus}` -- since `autoFocus` stays
//      true for the target card forever, the React Native -> Android
//      bridge re-applies the focus-preferred flag on EVERY render.
//      Each re-application yanks focus back to this card.
//
//   2. The retry timers at 60ms / 200ms / 500ms call
//      `p.setNativeProps({ hasTVPreferredFocus: true })` again.  Even
//      after the user has moved focus, the 200ms / 500ms calls fire
//      and snap focus back.  The `userMovedRef` guard is supposed to
//      stop this, but on Android TV `onBlur` doesn't always fire
//      reliably when the focus moves between FlatList items (the
//      blur event from the native side races the next focus event),
//      so the guard fails some of the time.
//
// Fix:
//   * One-shot focus grab.  After the initial 60ms call to
//     `p.focus()`, mark the card as "focus achieved" and refuse to
//     re-grab from that point on.  The 200ms and 500ms timers only
//     fire if `p.focus()` from the 60ms call did NOT take.
//   * Drop the `setNativeProps({ hasTVPreferredFocus: true })` lines
//     from the retry timers -- that's the line that re-applied the
//     native focus lock and snapped focus back.
//   * Tie `hasTVPreferredFocus` to an *initial-only* state flag that
//     flips false after 350ms, so React stops re-applying the
//     focus-preferred bit to the native view on every re-render.
//
// Idempotent.  CRLF-safe.  Windows CMD:
//
//   curl -s https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v135_focus_unlock.js -o apply_patches_v135.js && node apply_patches_v135.js
//
const fs = require('fs');
const path = require('path');

function find(rel) {
  const candidates = [
    path.join(process.cwd(), rel),
    path.join(process.cwd(), 'frontend', rel),
    path.join(process.cwd(), '..', 'frontend', rel),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

const idPath = find(path.join('app', 'details', '[type]', '[id].tsx'));
if (!idPath) {
  console.error('[v135] FATAL: app/details/[type]/[id].tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(idPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = idPath + '.bak_v135';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v135] Backup: ${backupPath}`);
}

const reports = [];
function applyOnce(label, marker, oldStr, newStr) {
  if (marker && src.indexOf(marker) !== -1) {
    reports.push({ label, status: 'SKIP_IDEMPOTENT' });
    return true;
  }
  const old2 = oldStr.replace(/\r?\n/g, NL);
  const new2 = newStr.replace(/\r?\n/g, NL);
  const occurrences = src.split(old2).length - 1;
  if (occurrences === 0) { reports.push({ label, status: 'NOT_FOUND' }); return false; }
  if (occurrences > 1)  { reports.push({ label, status: 'AMBIGUOUS', count: occurrences }); return false; }
  const before = src.length;
  src = src.replace(old2, new2);
  reports.push({ label, status: 'OK', delta: src.length - before });
  return true;
}

// ---------------------------------------------------------------------------
// F1 — replace the retry-timer useEffect + Pressable in EpisodeCard.
// ---------------------------------------------------------------------------
const F1_OLD = `  const pressableRef = useRef<any>(null);
  // v128: track whether the user has navigated AWAY from this card so the
  // later retries (200ms / 500ms) don't yank focus back from wherever the
  // user is now.
  const hasFocusedRef = useRef(false);
  const userMovedRef = useRef(false);
  useEffect(() => {
    if (!autoFocus) {
      // Reset for next time this card becomes the target
      hasFocusedRef.current = false;
      userMovedRef.current = false;
      return;
    }
    hasFocusedRef.current = false;
    userMovedRef.current = false;
    const tries = [60, 200, 500];
    const timers = tries.map(delay => setTimeout(() => {
      // If the user already moved D-pad away after we grabbed focus once,
      // do NOT re-grab — that's the snap-back bug.
      if (userMovedRef.current) return;
      try {
        const p: any = pressableRef.current;
        if (!p) return;
        if (typeof p.focus === 'function') { try { p.focus(); } catch (_) {} }
        try { p.setNativeProps && p.setNativeProps({ hasTVPreferredFocus: true }); } catch (_) {}
      } catch (_) {}
    }, delay));
    return () => { timers.forEach(t => clearTimeout(t)); };
  }, [autoFocus]);`;

const F1_NEW = `  const pressableRef = useRef<any>(null);
  /* v135-focus-unlock */
  // v128 tracked "user moved away" via onBlur to stop the retry timers
  // re-grabbing focus, but on Android TV onBlur races the next focus event
  // and the guard fails intermittently.  v135 instead uses a hard one-shot
  // flag: once we successfully grabbed focus ONCE, never re-grab.
  // Plus we drop the setNativeProps({ hasTVPreferredFocus: true }) line --
  // that's the call that was re-applying the native focus lock and
  // snapping focus back when the user pressed D-pad.
  const hasFocusedRef = useRef(false);
  const userMovedRef = useRef(false);
  const focusGrabbedOnceRef = useRef(false);
  // hasTVPreferredFocus is a one-shot request on Android TV but RN re-applies
  // it on every render of this Pressable.  Tie it to a state flag that flips
  // off after the initial-grab window so RN stops re-asserting the native
  // focus-preferred bit on every re-render.
  const [tvPreferred, setTvPreferred] = useState(!!autoFocus);
  useEffect(() => {
    if (!autoFocus) {
      hasFocusedRef.current = false;
      userMovedRef.current = false;
      focusGrabbedOnceRef.current = false;
      setTvPreferred(false);
      return;
    }
    hasFocusedRef.current = false;
    userMovedRef.current = false;
    focusGrabbedOnceRef.current = false;
    setTvPreferred(true);
    const tryFocus = (delay: number) => {
      if (userMovedRef.current || focusGrabbedOnceRef.current) {
        console.log('[FOCUS v135] skip retry@' + delay + 'ms (moved=' + userMovedRef.current + ' grabbed=' + focusGrabbedOnceRef.current + ')');
        return;
      }
      try {
        const p: any = pressableRef.current;
        if (!p) return;
        if (typeof p.focus === 'function') {
          console.log('[FOCUS v135] retry@' + delay + 'ms p.focus() ep=' + episode.episode);
          try { p.focus(); } catch (_) {}
        }
      } catch (_) {}
    };
    const tries = [60, 200, 500];
    const timers = tries.map((delay) => setTimeout(() => tryFocus(delay), delay));
    // Release the React-level hasTVPreferredFocus flag after the initial
    // grab window so RN stops re-applying the native focus lock on every
    // subsequent render.
    const releaseTimer = setTimeout(() => {
      console.log('[FOCUS v135] releasing hasTVPreferredFocus for ep=' + episode.episode);
      setTvPreferred(false);
    }, 600);
    return () => {
      timers.forEach((t) => clearTimeout(t));
      clearTimeout(releaseTimer);
    };
  }, [autoFocus, episode.episode]);`;

applyOnce(
  'F1: one-shot focus + drop native focus-lock + release hasTVPreferredFocus',
  '/* v135-focus-unlock */',
  F1_OLD,
  F1_NEW
);

// ---------------------------------------------------------------------------
// F2 — update the Pressable to use `tvPreferred` state and mark
// focusGrabbedOnceRef in onFocus.
// ---------------------------------------------------------------------------
const F2_OLD = `    <Pressable
      ref={pressableRef}
      style={[styles.episodeCard, isFocused && styles.episodeCardFocused]}
      onPress={onPress}
      onLongPress={isWatched ? onMarkUnwatched : undefined}
      /* v128-focus-cancel-blur */
      onFocus={() => { setIsFocused(true); hasFocusedRef.current = true; }}
      onBlur={() => { setIsFocused(false); if (hasFocusedRef.current) userMovedRef.current = true; }}
      delayLongPress={600}
      hasTVPreferredFocus={!!autoFocus}
    >`;

const F2_NEW = `    <Pressable
      ref={pressableRef}
      style={[styles.episodeCard, isFocused && styles.episodeCardFocused]}
      onPress={onPress}
      onLongPress={isWatched ? onMarkUnwatched : undefined}
      /* v135-focus-unlock-blur */
      onFocus={() => {
        setIsFocused(true);
        hasFocusedRef.current = true;
        focusGrabbedOnceRef.current = true;
        console.log('[FOCUS v135] onFocus ep=' + episode.episode + ' (one-shot guard set)');
      }}
      onBlur={() => {
        setIsFocused(false);
        if (hasFocusedRef.current) {
          userMovedRef.current = true;
          console.log('[FOCUS v135] onBlur ep=' + episode.episode + ' (userMoved=true)');
        }
      }}
      delayLongPress={600}
      hasTVPreferredFocus={tvPreferred}
    >`;

applyOnce(
  'F2: Pressable uses tvPreferred state and sets focusGrabbedOnceRef',
  '/* v135-focus-unlock-blur */',
  F2_OLD,
  F2_NEW
);

const failed = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT');
console.log('');
console.log('[v135] === PATCH REPORT =====================================');
for (const r of reports) {
  let tag;
  if (r.status === 'OK') tag = 'OK  ';
  else if (r.status === 'SKIP_IDEMPOTENT') tag = 'SKIP';
  else if (r.status === 'NOT_FOUND') tag = 'MISS';
  else tag = 'AMBI';
  let extras = '';
  if (r.delta != null) extras += `  (Δ ${r.delta} chars)`;
  if (r.count != null) extras += `  (×${r.count})`;
  console.log(`  [${tag}] ${r.label}${extras}`);
}
console.log('[v135] =====================================================');

if (failed.length) { console.error('[v135] Patch failed.'); process.exit(2); }
if (src.length === originalLen) { console.log('[v135] No changes.'); process.exit(0); }
fs.writeFileSync(idPath, src, 'utf8');
console.log(`[v135] Wrote ${src.length} chars (was ${originalLen}, Δ ${src.length - originalLen}).`);
console.log('[v135] Done. Rebuild + side-load.');
