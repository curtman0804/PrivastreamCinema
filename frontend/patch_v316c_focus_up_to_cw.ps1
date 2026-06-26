# patch_v316c_focus_up_to_cw.ps1
# V316c - Wire __firstCWPosterTag as nextFocusUp on Popular Movies row's
# ContentCards so a SINGLE UP press from Popular Movies routes focus
# directly into the Continue Watching poster.  Companion to V316b which
# fixed the scroll snap; this completes the visual selector jump.
#
# Touches 3 files:
#   - app\(tabs)\discover.tsx
#   - src\components\ServiceRow.tsx
#   - src\components\ContentCard.tsx
#
# Idempotent: re-runs are no-ops once 'V316c_FOCUS_UP' marker is present.

$ErrorActionPreference = 'Stop'

$D = 'app\(tabs)\discover.tsx'
$S = 'src\components\ServiceRow.tsx'
$C = 'src\components\ContentCard.tsx'

foreach ($p in @($D, $S, $C)) {
  if (-not (Test-Path -LiteralPath $p)) {
    Write-Host ('[v316c] ERROR: cannot find ' + $p)
    exit 1
  }
}

# ---------- Patch 1: ContentCard.tsx ----------
$cs = Get-Content -Raw -LiteralPath $C
if ($cs -match 'V316c_FOCUS_UP') {
  Write-Host '[v316c] ContentCard.tsx already patched, skipping'
} else {
  # 1a) Add nextFocusUpTag to the props interface
  $cs_bad1 = @'
  hasTVPreferredFocus?: boolean;
  isFirstInRow?: boolean;
  isLastInRow?: boolean;
  onCardBlur?: () => void;
}
'@
  $cs_good1 = @'
  hasTVPreferredFocus?: boolean;
  isFirstInRow?: boolean;
  isLastInRow?: boolean;
  onCardBlur?: () => void;
  /* V316c_FOCUS_UP - native view tag of the Continue-Watching poster
     to jump to on UP press.  Only the first non-CW row (Popular
     Movies) supplies this. */
  nextFocusUpTag?: number | null;
}
'@
  if (-not $cs.Contains($cs_bad1)) {
    Write-Host '[v316c] ERROR: ContentCard props interface anchor not found'
    exit 2
  }
  $cs = $cs.Replace($cs_bad1, $cs_good1)

  # 1b) Destructure in component signature
  $cs_bad2 = @'
  hasTVPreferredFocus = false,
  isFirstInRow = false,
  isLastInRow = false,
  onCardBlur,
}) => {
'@
  $cs_good2 = @'
  hasTVPreferredFocus = false,
  isFirstInRow = false,
  isLastInRow = false,
  onCardBlur,
  nextFocusUpTag,
}) => {
'@
  if (-not $cs.Contains($cs_bad2)) {
    Write-Host '[v316c] ERROR: ContentCard destructure anchor not found'
    exit 3
  }
  $cs = $cs.Replace($cs_bad2, $cs_good2)

  # 1c) Add nextFocusUp prop on the Pressable (after nextFocusLeft block)
  $cs_bad3 = @'
      nextFocusLeft={
        isFirstInRow && selfNode
          ? selfNode
          : undefined
      }

      style={[
'@
  $cs_good3 = @'
      nextFocusLeft={
        isFirstInRow && selfNode
          ? selfNode
          : undefined
      }

      /* V316c_FOCUS_UP - single UP-press jump into Continue Watching.
         Only the first non-CW row supplies a tag; deeper rows still
         use default spatial navigation. */
      nextFocusUp={
        nextFocusUpTag != null && nextFocusUpTag > 0
          ? nextFocusUpTag
          : undefined
      }

      style={[
'@
  if (-not $cs.Contains($cs_bad3)) {
    Write-Host '[v316c] ERROR: ContentCard nextFocusLeft anchor not found'
    exit 4
  }
  $cs = $cs.Replace($cs_bad3, $cs_good3)

  Set-Content -LiteralPath $C -Value $cs -NoNewline -Encoding UTF8
  Write-Host '[v316c] ContentCard.tsx patched OK'
}

# ---------- Patch 2: ServiceRow.tsx ----------
$ss = Get-Content -Raw -LiteralPath $S
if ($ss -match 'V316c_FOCUS_UP') {
  Write-Host '[v316c] ServiceRow.tsx already patched, skipping'
} else {
  # 2a) Add nextFocusUpTag to props interface
  $ss_bad1 = @'
  isFirstRow?: boolean;
  rowIndex?: number;
}
'@
  $ss_good1 = @'
  isFirstRow?: boolean;
  rowIndex?: number;
  /* V316c_FOCUS_UP - forwarded to every ContentCard in this row.
     Only the Discover row 0 (Popular Movies) supplies a non-null value. */
  nextFocusUpTag?: number | null;
}
'@
  if (-not $ss.Contains($ss_bad1)) {
    Write-Host '[v316c] ERROR: ServiceRow props interface anchor not found'
    exit 5
  }
  $ss = $ss.Replace($ss_bad1, $ss_good1)

  # 2b) Add nextFocusUpTag to destructure
  $ss_bad2 = @'
    isFirstRow = false,
    rowIndex = 0,
  }) => {
'@
  $ss_good2 = @'
    isFirstRow = false,
    rowIndex = 0,
    nextFocusUpTag = null,
  }) => {
'@
  if (-not $ss.Contains($ss_bad2)) {
    Write-Host '[v316c] ERROR: ServiceRow destructure anchor not found'
    exit 6
  }
  $ss = $ss.Replace($ss_bad2, $ss_good2)

  # 2c) Forward to ContentCard in renderItem
  $ss_bad3 = @'
            isFirstInRow={isFirst}
            isLastInRow={isLast}
          />
        );
      },
      [
        onItemPress,
        handleCardFocus,
        handleCardBlur,
        isFirstRow,
        rowIndex,
        serviceName,
        title,
      ]
    );
'@
  $ss_good3 = @'
            isFirstInRow={isFirst}
            isLastInRow={isLast}
            /* V316c_FOCUS_UP - only row 0 supplies a real tag; deeper
               rows pass null and fall back to default spatial nav. */
            nextFocusUpTag={nextFocusUpTag}
          />
        );
      },
      [
        onItemPress,
        handleCardFocus,
        handleCardBlur,
        isFirstRow,
        rowIndex,
        serviceName,
        title,
        nextFocusUpTag,
      ]
    );
'@
  if (-not $ss.Contains($ss_bad3)) {
    Write-Host '[v316c] ERROR: ServiceRow renderItem anchor not found'
    exit 7
  }
  $ss = $ss.Replace($ss_bad3, $ss_good3)

  Set-Content -LiteralPath $S -Value $ss -NoNewline -Encoding UTF8
  Write-Host '[v316c] ServiceRow.tsx patched OK'
}

# ---------- Patch 3: discover.tsx ----------
$ds = Get-Content -Raw -LiteralPath $D
if ($ds -match 'V316c_FOCUS_UP') {
  Write-Host '[v316c] discover.tsx already patched, skipping'
} else {
  # 3a) Add DeviceEventEmitter import
  $ds_bad1 = @'
  Animated,
  Easing,
} from 'react-native';
'@
  $ds_good1 = @'
  Animated,
  Easing,
  DeviceEventEmitter,
} from 'react-native';
'@
  if (-not $ds.Contains($ds_bad1)) {
    Write-Host '[v316c] ERROR: discover.tsx react-native import block anchor not found'
    exit 8
  }
  $ds = $ds.Replace($ds_bad1, $ds_good1)

  # 3b) Add firstCWTag state + DeviceEventEmitter listener
  $ds_bad2 = @'
  const [cachedCW, setCachedCW] = useState<WatchProgress[]>([]);
  const scrollViewRef = useRef<ScrollView>(null);
  const sectionPositions = useRef<Record<string, number>>({});
  const lastFocusedSection = useRef<string>('');
  const lastCWFetchTime = useRef<number>(0);
'@
  $ds_good2 = @'
  const [cachedCW, setCachedCW] = useState<WatchProgress[]>([]);
  const scrollViewRef = useRef<ScrollView>(null);
  const sectionPositions = useRef<Record<string, number>>({});
  const lastFocusedSection = useRef<string>('');
  const lastCWFetchTime = useRef<number>(0);

  // V316c_FOCUS_UP - first-mounted Continue-Watching poster's native
  // view tag.  ContinueWatchingItem broadcasts the tag via
  // DeviceEventEmitter('v316c:firstCWTag', tag|null) on mount and
  // clears (null) on unmount.  Fed to ContentCard's nextFocusUp on
  // the first non-CW row (Popular Movies) so a single D-pad UP press
  // jumps focus directly into Continue Watching instead of getting
  // stranded on the same row.
  const [firstCWTag, setFirstCWTag] = useState<number | null>(
    () => ((globalThis as any).__firstCWPosterTag as number | undefined) || null
  );
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      'v316c:firstCWTag',
      (tag: number | null) => {
        setFirstCWTag(typeof tag === 'number' && tag > 0 ? tag : null);
      }
    );
    return () => { try { sub.remove(); } catch (_) {} };
  }, []);
'@
  if (-not $ds.Contains($ds_bad2)) {
    Write-Host '[v316c] ERROR: discover.tsx state block anchor not found'
    exit 9
  }
  $ds = $ds.Replace($ds_bad2, $ds_good2)

  # 3c) Update ContinueWatchingItem useEffect to broadcast + cleanup on unmount
  $ds_bad3 = @'
    // V280_FIRST_CW_TAG — broadcast first-mounted CW item's tag.
    if (pTag) {
      try {
        const g: any = globalThis as any;
        if (!g.__firstCWPosterTag) {
          g.__firstCWPosterTag = pTag;
          console.log('[V280_FIRST_CW_TAG] first-mounted CW poster tag=' + pTag);
        }
      } catch (_) {}
    }
  }, []);
'@
  $ds_good3 = @'
    // V280_FIRST_CW_TAG / V316c_FOCUS_UP — broadcast first-mounted CW
    // item's tag.  Emit a DeviceEventEmitter event so the Discover
    // screen re-renders and feeds the tag to row-0 ContentCards via
    // nextFocusUp.  On unmount, release the slot and broadcast null
    // so any subsequent CW item can re-claim.
    let _v316cClaimed = false;
    if (pTag) {
      try {
        const g: any = globalThis as any;
        if (!g.__firstCWPosterTag) {
          g.__firstCWPosterTag = pTag;
          _v316cClaimed = true;
          console.log('[V316c] first CW poster tag=' + pTag + ' (claimed)');
          try { DeviceEventEmitter.emit('v316c:firstCWTag', pTag); } catch (_) {}
        }
      } catch (_) {}
    }
    return () => {
      if (_v316cClaimed) {
        try {
          const g: any = globalThis as any;
          if (g.__firstCWPosterTag === pTag) {
            g.__firstCWPosterTag = null;
            console.log('[V316c] first CW poster unmount - releasing tag=' + pTag);
            try { DeviceEventEmitter.emit('v316c:firstCWTag', null); } catch (_) {}
          }
        } catch (_) {}
      }
    };
  }, []);
'@
  if (-not $ds.Contains($ds_bad3)) {
    Write-Host '[v316c] ERROR: discover.tsx ContinueWatchingItem useEffect anchor not found'
    exit 10
  }
  $ds = $ds.Replace($ds_bad3, $ds_good3)

  # 3d) Pass nextFocusUpTag to ServiceRow for row 0 (Popular Movies)
  $ds_bad4 = @'
                  rowIndex={item.rowIdx}
                />
              </View>
            );
          })}
'@
  $ds_good4 = @'
                  rowIndex={item.rowIdx}
                  /* V316c_FOCUS_UP - only row 0 (Popular Movies) gets the
                     CW poster tag; deeper rows pass null and fall back to
                     default spatial navigation. */
                  nextFocusUpTag={item.rowIdx === 0 ? firstCWTag : null}
                />
              </View>
            );
          })}
'@
  if (-not $ds.Contains($ds_bad4)) {
    Write-Host '[v316c] ERROR: discover.tsx ServiceRow anchor not found'
    exit 11
  }
  $ds = $ds.Replace($ds_bad4, $ds_good4)

  Set-Content -LiteralPath $D -Value $ds -NoNewline -Encoding UTF8
  Write-Host '[v316c] discover.tsx patched OK'
}

Write-Host ''
Write-Host '[v316c] ALL DONE - V316c_FOCUS_UP marker is now present in all 3 files.'
Write-Host '[v316c] Next: run deploy_ota.bat, then on the Firestick:'
Write-Host '[v316c]   1. Open Discover.'
Write-Host '[v316c]   2. Navigate down to a Popular Movies poster.'
Write-Host '[v316c]   3. Press UP ONCE.'
Write-Host '[v316c] Expected: scroll snaps to top AND selector jumps to the first Continue Watching poster.'
Write-Host '[v316c] If it still takes 2 presses, run:  adb logcat -d -t 500 ReactNativeJS:V *:S | findstr V316c'
Write-Host '[v316c] You should see "[V316c] first CW poster tag=NNNNN (claimed)" on Discover mount.'
