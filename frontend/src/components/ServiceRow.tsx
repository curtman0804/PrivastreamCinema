import React, {
  memo,
  useState,
  useCallback,
  useRef,
  useMemo,
  useEffect,
} from 'react';

import {
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
  InteractionManager,
  DeviceEventEmitter,
} from 'react-native';

import { FlashList } from '@shopify/flash-list';
import PrivastreamTVRow from './PrivastreamTVRow';

import {
  ContentCard,
  getCardWidth,
  v160GetPoster as _v614GetPoster,
  v614RegisterVerifiedPoster as _v614RegisterVerifiedPoster,
} from './ContentCard'; // V614B_NATIVE_POSTER_SYNC
import {
  v173RegisterLongPress,
  v176iRegisterGetter,
  v176pRegisterPressGetter,
  v176ShowLongPressMenu,
  v172SubscribeWatched,
  v634GetStatusIds,
  v634IsItemWatched,
  v610GetReleaseStatus,
  v610SubscribeReleaseStatus,
} from './ContentCard';
import { ContentItem } from '../api/client';
import apiClient, { api } from '../api/client';
import { useContentStore } from '../store/contentStore';
import { getMetaCache, setMetaCache } from '../store/contentStore'; // PATCH_V250_VIEWPORT_PREFETCH
import { colors } from '../styles/colors';

const ITEM_GAP = 16;
const TV_PADDING_LEFT = 48;
const TV_PADDING_RIGHT = 48;
const MOBILE_PADDING = 16;

const TV_SCROLL_ANCHOR = 4;

// PATCH_V250_BACK_NAV_FOCUS Ã¢â‚¬â€ module-level map of rowKey -> last-focused content_id.
// When user backs out of Details, ServiceRow re-mounts and gives the previously
// focused poster hasTVPreferredFocus=true, so the highlight appears in the same
// frame as the row renders (no D-pad-poll latency, no scroll glitch).
const _v250_lastFocusedByRow = new Map<string, string>();

// PATCH_V250_VIEWPORT_PREFETCH Ã¢â‚¬â€ track which ids we've already kicked
// off a /meta prefetch for (per app session). Avoids duplicate hits.
const _v250_prefetched = new Set<string>();

// V445_META_QUEUE - global bounded meta-fetch queue.  Prior code fired an
// uncoordinated getMeta() per viewable poster; with 6 rows lazy-mounting
// this produced 30+ concurrent XHRs at boot, choking the JS thread and
// making the D-pad feel sluggish.  Max 3 in flight; the rest queue.
const _V445_MAX_INFLIGHT = 3;
let _v445Inflight = 0;
const _v445Queue: Array<{ t: string; cid: string }> = [];
function _v445Drain() {
  while (_v445Inflight < _V445_MAX_INFLIGHT && _v445Queue.length > 0) {
    const job = _v445Queue.shift();
    if (!job) break;
    _v445Inflight++;
    (api as any)?.content?.getMeta?.(job.t, job.cid)
      .then((d: any) => {
        if (d) {
          setMetaCache(job.cid, d);

          if (d.poster) {
            try {
              _v614RegisterVerifiedPoster(
                job.cid,
                String(d.poster)
              );
            } catch (_) {}
          }
        }
      })
      .catch(() => { /* best-effort */ })
      .finally(() => { _v445Inflight = Math.max(0, _v445Inflight - 1); _v445Drain(); });
  }
}
function _v445QueueMeta(t: string, cid: string) {
  _v445Queue.push({ t, cid });
  _v445Drain();
}

// V575_DECOUPLE - decouple D-pad focus from image/meta readiness.  While the
// user is actively holding the D-pad (focus moving faster than the settle
// window) we PAUSE meta prefetch so poster decode + network never competes
// with focus movement.  Candidate ids collect in _v575PendingMeta and only
// flush through the bounded queue once navigation SETTLES (no focus change
// for _v575SettleMs).  Net effect: focus tracks the D-pad column instantly,
// regardless of network/render state.
let _v575LastNavAt = 0;
const _v575SettleMs = 350;
const _v575PendingMeta = new Map<string, string>(); // cid -> type
let _v575DrainTimer: any = null;
function _v575Tick() {
  _v575DrainTimer = null;
  // Still holding the D-pad?  Wait out another settle window.
  if (Date.now() - _v575LastNavAt < _v575SettleMs) {
    _v575DrainTimer = setTimeout(_v575Tick, _v575SettleMs);
    return;
  }
  // Settled - flush pending metas through the existing bounded 3-slot queue.
  _v575PendingMeta.forEach((t, cid) => { _v445QueueMeta(t, cid); });
  _v575PendingMeta.clear();
}
function _v575QueueMetaWhenIdle(t: string, cid: string) {
  _v575PendingMeta.set(cid, t);
  if (!_v575DrainTimer) _v575DrainTimer = setTimeout(_v575Tick, _v575SettleMs);
}

// V598D_PROACTIVE_PRIMARY_RAIL_BUFFER
// The four main Discover rails must load ahead of navigation instead of
// waiting for the selector to get close to the currently loaded edge.
// A hard TV hold can consume posters much faster than a catalog page returns.
// V608_CINEMETA_FEATURED_ROWS
const _V598D_PRIMARY_RAIL_NAMES = new Set([
  'popular movies',
  'popular series',
  'featured movies',
  'featured series',
]);
const _V598D_PRIMARY_PRIME_TARGET = 300;
const _V598D_PRIMARY_FETCH_AHEAD = 120;
const _V598D_FETCH_COOLDOWN_MS = 250;

// V444_BOOT_SERVICE_ROW - visible startup marker.  If this line appears in
// logcat, v443+v444 patches are ACTIVE in the bundle.
try { console.log('[V444_BOOT] ServiceRow module loaded; v443 map-read=DISABLED'); } catch (_) {}
try { console.log('[V587_RUNTIME] Fast held-D-pad navigation ACTIVE'); } catch (_) {}

// V443_STOP_FOCUS_HOP marker.  See patch_v443.ps1 for rationale.  The map
// _v250_lastFocusedByRow is still written on every card focus (harmless
// tracking) but is NEVER read by hasTVPreferredFocus.

// v238 Ã¢â‚¬â€ eager-mount top 3 rows so user sees a "full" Discover screen
// in the first frame instead of 1 row + empty space.  Rows 3+ paint at
// 20ms steps (cap 400ms total) Ã¢â‚¬â€ fast enough to feel simultaneous.
const LazyMount: React.FC<{
  height: number;
  rowIndex: number;
  children: React.ReactNode;
}> = memo(({ height, rowIndex, children }) => {
  const [shouldRender, setShouldRender] = useState(rowIndex <= 4); /* V449_LAG_TUNE: eager 5 rows */

  useEffect(() => {
    if (shouldRender) return;

    const delayMs = Math.min((rowIndex - 4) * 10, 250); /* V449_LAG_TUNE: tighter stagger */

    const t = setTimeout(() => {
      setShouldRender(true);
    }, delayMs);

    return () => clearTimeout(t);
  }, [rowIndex, shouldRender]);

  if (!shouldRender) {
    return <View style={{ height, backgroundColor: 'transparent' }} />;
  }

  return <View>{children}</View>;
});

interface ServiceRowProps {
  title: string;
  serviceName: string;
  contentType: 'movies' | 'series' | 'channels';
  items: ContentItem[];
  onItemPress: (item: ContentItem) => void;
  onItemFocus?: (item: ContentItem) => void;
  onSectionFocus?: () => void;
  isFirstRow?: boolean;
  rowIndex?: number;
  /* V316c_FOCUS_UP - forwarded to every ContentCard in this row.
     Only the Discover row 0 (Popular Movies) supplies a non-null value. */
  nextFocusUpTag?: number | null;
  tvRowIndex?: number;
}

export const ServiceRow: React.FC<ServiceRowProps> = memo(
  ({
    title,
    serviceName,
    contentType,
    items: initialItems,
    onItemPress,
    onItemFocus,
    onSectionFocus,
    isFirstRow = false,
    rowIndex = 0,
    nextFocusUpTag = null,
    tvRowIndex,
  }) => {
    const { width: screenWidth, height } = useWindowDimensions();

    const isTV = screenWidth > height || screenWidth > 800;

    const cardWidth = getCardWidth(screenWidth, isTV, 'medium');

    const itemTotalWidth = cardWidth + ITEM_GAP;

    const [allItems, setAllItems] = useState<ContentItem[]>(
      () => initialItems || []
    );

    // V614B_NATIVE_POSTER_SYNC
    // When verified current metadata changes a poster, update only the
    // matching item's poster URL. Native focus/scroll ownership is untouched.
    useEffect(() => {
      const sub = DeviceEventEmitter.addListener(
        'v614:posterChanged',
        (payload: any) => {
          const key = String(payload?.key || '');
          const url = String(payload?.url || '');

          if (!key || !url) return;

          setAllItems(prev => {
            let changed = false;

            const next = (prev || []).map((it: any) => {
              const rawId = String(
                it?.imdb_id ||
                it?.id ||
                ''
              );

              const itemKey = /^tt\d+/.test(rawId)
                ? rawId.split(':')[0]
                : rawId;

              if (
                itemKey === key &&
                String(it?.poster || '') !== url
              ) {
                changed = true;

                return {
                  ...it,
                  poster: url,
                };
              }

              return it;
            });

            return changed ? next : prev;
          });
        }
      );

      return () => {
        try { sub.remove(); } catch (_) {}
      };
    }, []);

    const skipRef = useRef(initialItems?.length || 0);
    const hasMoreRef = useRef(true);
    const isFetchingRef = useRef(false);
    const lastFetchTime = useRef(0);

    const totalRef = useRef(initialItems?.length || 0);
    const itemCountRef = useRef(initialItems?.length || 0);

    const flatListRef = useRef<FlashList<ContentItem>>(null);

    const isNavigatingInRowRef = useRef(false);

    const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null
    );

    // V587_FAST_HOLD
    // During a held D-pad sequence, native TV focus must remain the hot path.
    // Do not force the parent to process every intermediate focused poster.
    const rapidFocusLastAtRef = useRef(0);
    const rapidFocusTimerRef =
      useRef<ReturnType<typeof setTimeout> | null>(null);
    const rapidFocusPendingRef = useRef<ContentItem | null>(null);

    // V610_NATIVE_TV_BADGE_SUBSCRIPTION
    // One coalesced render tick when release statuses arrive. The actual
    // status/cache/network ownership remains in ContentCard's singleton.
    const [v610BadgeVersion, setV610BadgeVersion] = useState(0);
    const v610BadgeRefreshTimerRef =
      useRef<ReturnType<typeof setTimeout> | null>(null);
    const validItems = useMemo(
      () => (allItems || []).filter(Boolean),
      [allItems]
    );

    const isV598DPrimaryRail = useMemo(() => {
      const names = [
        String(title || '').trim().toLowerCase(),
        String(serviceName || '').trim().toLowerCase(),
      ];

      return names.some(name => _V598D_PRIMARY_RAIL_NAMES.has(name));
    }, [title, serviceName]);

    itemCountRef.current = validItems.length;
    // V610_NATIVE_TV_BADGE_SUBSCRIPTION
    // TV rails bypass React ContentCard and render through PrivastreamTVRow.
    // Subscribe each loaded movie IMDb id to the SAME V607 release cache.
    useEffect(() => {
      if (!isTV || validItems.length === 0) return;

      let disposed = false;
      const cleanups: Array<() => void> = [];
      const ids = new Set<string>();

      for (const it of validItems as any[]) {
        if (!it) continue;

        const type = String(it.type || '').toLowerCase();
        if (type && type !== 'movie') continue;

        const id = String(it.imdb_id || it.id || '');
        if (!id.startsWith('tt')) continue;

        ids.add(id);
      }

      const scheduleRefresh = () => {
        if (disposed || v610BadgeRefreshTimerRef.current) return;

        v610BadgeRefreshTimerRef.current = setTimeout(() => {
          v610BadgeRefreshTimerRef.current = null;
          if (!disposed) {
            setV610BadgeVersion(v => v + 1);
          }
        }, 80);
      };

      ids.forEach(id => {
        cleanups.push(
          v610SubscribeReleaseStatus(id, () => {
            scheduleRefresh();
          })
        );
      });

      return () => {
        disposed = true;

        cleanups.forEach(fn => {
          try { fn(); } catch (_) {}
        });

        if (v610BadgeRefreshTimerRef.current) {
          clearTimeout(v610BadgeRefreshTimerRef.current);
          v610BadgeRefreshTimerRef.current = null;
        }
      };
    }, [isTV, validItems]);


    // v238 Ã¢â‚¬â€ DO NOT early-return here.  Hooks below this point MUST run
    // every render or React throws "Rendered more/fewer hooks than during
    // the previous render".  The empty-state guard is moved AFTER all
    // hooks (see further down).

    const fetchMore = useCallback(async () => {
      const now = Date.now();

      if (isFetchingRef.current || !hasMoreRef.current) return;

      if (now - lastFetchTime.current < _V598D_FETCH_COOLDOWN_MS) return;

      isFetchingRef.current = true;
      lastFetchTime.current = now;

      try {
        if (isV598DPrimaryRail) {
          console.log(
            '[V598D_RAIL_FETCH]',
            String(title || serviceName || ''),
            `skip=${skipRef.current}`,
            `loaded=${totalRef.current}`
          );
        }
        const resp = await apiClient.get(
          `/api/content/category/${encodeURIComponent(
            serviceName
          )}/${contentType}?skip=${skipRef.current}&limit=100`
        );

        const newItems: ContentItem[] = resp.data.items || [];

        if (newItems.length > 0) {
          setAllItems(prev => {
            const ids = new Set(
              prev.map(i => i.id || i.imdb_id)
            );

            const unique = newItems.filter(
              i => !ids.has(i.id || i.imdb_id)
            );

            const updated = [...prev, ...unique];

            totalRef.current = updated.length;

            return updated;
          });

          skipRef.current += newItems.length;
        }

        hasMoreRef.current =
          resp.data.hasMore !== undefined
            ? resp.data.hasMore
            : newItems.length >= 20;
      } catch {
        hasMoreRef.current = false;
      } finally {
        isFetchingRef.current = false;
      }
    }, [serviceName, contentType, isV598DPrimaryRail, title]);

    // V598D_PROACTIVE_PRIMARY_RAIL_BUFFER
    // Prime Popular/Featured Movies/Series in the background. This is deliberately
    // independent of focus so merely sitting on the screen fills the rail.
    useEffect(() => {
      if (
        !isTV ||
        !isV598DPrimaryRail ||
        validItems.length === 0 ||
        validItems.length >= _V598D_PRIMARY_PRIME_TARGET ||
        !hasMoreRef.current
      ) {
        return;
      }

      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const pump = async () => {
        if (
          cancelled ||
          !hasMoreRef.current ||
          totalRef.current >= _V598D_PRIMARY_PRIME_TARGET
        ) {
          return;
        }

        if (isFetchingRef.current) {
          timer = setTimeout(pump, 150);
          return;
        }

        const elapsed = Date.now() - lastFetchTime.current;
        if (elapsed < _V598D_FETCH_COOLDOWN_MS) {
          timer = setTimeout(
            pump,
            Math.max(50, _V598D_FETCH_COOLDOWN_MS - elapsed)
          );
          return;
        }

        await fetchMore();

        if (
          !cancelled &&
          hasMoreRef.current &&
          totalRef.current < _V598D_PRIMARY_PRIME_TARGET
        ) {
          timer = setTimeout(pump, 150);
        }
      };

      // Small row stagger prevents all four main rails from issuing their
      // first look-ahead request on the exact same JS frame.
      timer = setTimeout(pump, 75 + Math.min(rowIndex, 3) * 125);

      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }, [
      isTV,
      isV598DPrimaryRail,
      validItems.length,
      fetchMore,
      rowIndex,
    ]);

    const handleCardFocus = useCallback(
      (index: number) => {
        if (blurTimerRef.current) {
          clearTimeout(blurTimerRef.current);
          blurTimerRef.current = null;
        }

        // V575_DECOUPLE - mark that the D-pad just moved so any in-flight
        // viewport prefetch pauses until navigation settles.
        _v575LastNavAt = Date.now();

        // TV_AXIS_GUARD
        // Remember which rail owns focus. A vertical row-entry must NEVER
        // cause this rail to horizontally reposition itself.
        const tvRowToken =
          typeof tvRowIndex === 'number' ? tvRowIndex : rowIndex + 1;

        const enteringDifferentRow =
          isTV &&
          (globalThis as any).__psTVActiveRowIndex !== tvRowToken;

        if (isTV) {
          (globalThis as any).__psTVActiveRowIndex = tvRowToken;
        }

        onSectionFocus?.();

        const focusedItem = validItems[index];

        // PATCH_V250_BACK_NAV_FOCUS Ã¢â‚¬â€ remember which poster was focused
        // in this row, so the highlight returns to it on Back nav.
        if (focusedItem) {
          const cid = focusedItem.imdb_id || focusedItem.id;
          if (cid) {
            _v250_lastFocusedByRow.set(
              `${rowIndex}:${serviceName || title || ''}`,
              cid
            );
          }
        }

        if (focusedItem && onItemFocus) {
          const now = Date.now();
          const gap = now - rapidFocusLastAtRef.current;
          rapidFocusLastAtRef.current = now;

          if (rapidFocusTimerRef.current) {
            clearTimeout(rapidFocusTimerRef.current);
            rapidFocusTimerRef.current = null;
          }

          // Normal individual D-pad press: notify immediately.
          if (gap <= 0 || gap >= 140) {
            rapidFocusPendingRef.current = null;
            onItemFocus(focusedItem);
          } else {
            // Held D-pad / rapid repeat:
            // let native focus fly through cards without making Discover
            // re-process every intermediate poster.
            rapidFocusPendingRef.current = focusedItem;

            rapidFocusTimerRef.current = setTimeout(() => {
              rapidFocusTimerRef.current = null;

              const pending = rapidFocusPendingRef.current;
              rapidFocusPendingRef.current = null;

              if (pending) {
                onItemFocus(pending);
              }
            }, 140);
          }
        }

        const recentVerticalTVNav =
          isTV &&
          (globalThis as any).__psTVLastNavAxis === 'vertical' &&
          Date.now() - Number((globalThis as any).__psTVLastNavAt || 0) < 220;

        if (
          isTV &&
          !recentVerticalTVNav &&
          !enteringDifferentRow &&
          flatListRef.current &&
          isNavigatingInRowRef.current
        ) {
          const targetOffset = Math.max(
            0,
            (index - TV_SCROLL_ANCHOR) * itemTotalWidth
          );

          flatListRef.current.scrollToOffset({
            offset: targetOffset,
            animated: false,
          });
        }

        isNavigatingInRowRef.current = true;

        const fetchAhead = isV598DPrimaryRail
          ? _V598D_PRIMARY_FETCH_AHEAD
          : 15;

        if (
          index >= totalRef.current - fetchAhead &&
          hasMoreRef.current
        ) {
          fetchMore();
        }
      },
      [
        onSectionFocus,
        onItemFocus,
        validItems,
        fetchMore,
        itemTotalWidth,
        isTV,
        tvRowIndex,
        rowIndex,
        isV598DPrimaryRail,
      ]
    );

    const handleCardBlur = useCallback(() => {
      blurTimerRef.current = setTimeout(() => {
        isNavigatingInRowRef.current = false;
      }, 150);
    }, []);

    const handleEndReached = useCallback(() => {
      if (!isFetchingRef.current && hasMoreRef.current) {
        fetchMore();
      }
    }, [fetchMore]);

    const renderItem = useCallback(
      ({
        item,
        index,
      }: {
        item: ContentItem;
        index: number;
      }) => {
        const isFirst = index === 0;
        const isLast =
          index === itemCountRef.current - 1;

        return (
          <ContentCard
            item={item}
            onPress={() => onItemPress(item)}
            onCardFocus={() => handleCardFocus(index)}
            onCardBlur={handleCardBlur}
            showTitle={true}
            hasTVPreferredFocus={
              (isFirstRow && index === 0) ||
              // PATCH_V250_BACK_NAV_FOCUS Ã¢â‚¬â€ restore last-focused poster
              // in this row when user returns from Details.
              (false /* V443_STOP_FOCUS_HOP - map-driven focus disabled */)
            }
            isFirstInRow={isFirst}
            isLastInRow={isLast}
            /* V316c_FOCUS_UP - only row 0 supplies a real tag; deeper
               rows pass null and fall back to default spatial nav. */
            nextFocusUpTag={nextFocusUpTag}
            /* v475: pass rowIndex so ContentCard's v443:navBack listener
               can scope focus restore by row (fixes cross-row focus race). */
            rowIndex={rowIndex}
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

    const keyExtractor = useCallback(
      (item: ContentItem) =>
        item.id || item.imdb_id || `${item.name}`,
      []
    );

    // PATCH_V250_VIEWPORT_PREFETCH Ã¢â‚¬â€ when posters scroll into view, fire
    // their meta prefetch immediately (no dwell needed).  This is the real
    // fix for "spotty" hover-to-instant: by the time the user's D-pad
    // lands on ANY visible poster, /meta has already been warmed.
    // Throttled by _v250_prefetched Set so we never duplicate per session.
    const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
      if (!viewableItems || !viewableItems.length) return;
      for (const v of viewableItems) {
        const it = v.item;
        if (!it) continue;
        const cid = it.imdb_id || it.id;
        const t = it.type;
        if (!cid || (t !== 'movie' && t !== 'series')) continue;
        if (_v250_prefetched.has(cid)) continue;
        if (getMetaCache(cid)) { _v250_prefetched.add(cid); continue; }
        _v250_prefetched.add(cid);
        // V575_DECOUPLE - do NOT fetch mid-hold.  Stash the candidate and let
        // it drain through the bounded 3-slot queue once the D-pad settles,
        // so focus movement is never blocked by meta/decode work.
        _v575QueueMetaWhenIdle(t, cid);
      }
    }).current;

    const viewabilityConfig = useRef({
      itemVisiblePercentThreshold: 30, // fire when 30% of poster visible
      minimumViewTime: 150,             // 150ms in-viewport before counting (debounces fast scrolls)
    }).current;

    // v238 Ã¢â‚¬â€ SAFE empty-state guard: every hook above has already been
    // called this render, so React's hook order is stable across renders
    // regardless of whether validItems is empty.
    // NATIVE_TV_RECYCLER_ROW
    // TV service rails use one native RecyclerView instead of mounting a
    // React ContentCard for every poster. Mobile keeps the existing FlashList.
    // V633_LIBRARYCARD_STATE_ON_DISCOVER
    //
    // This intentionally copies LibraryCard's working model.
    //
    // ONE canonical identity everywhere:
    //   imdb_id || id || content_id
    //
    // The watched registry, library membership, long-press actions and
    // native poster booleans all use this SAME key.
    const v633LibrarySet =
      useContentStore(
        (state: any) => state.librarySet
      );

    const [
      v633WatchedVersion,
      setV633WatchedVersion,
    ] = useState(0);

    /*
     * LibraryCard subscribes directly to the shared watched registry
     * and bumps when it broadcasts. Do the same at row level.
     *
     * One subscription per ServiceRow is still much lighter than the old
     * one-subscription-per-poster ContentCard implementation.
     */
    useEffect(() => {
      const unsubscribe =
        v172SubscribeWatched(() => {
          setV633WatchedVersion(
            (v) => (v + 1) & 0xffff
          );
        });

      return () => {
        try {
          unsubscribe();
        } catch (_) {}
      };
    }, []);

    const nativeTVItems =
      useMemo(
        () =>
          validItems.map(
            (it, index) => {
              // V634_SHARED_STATUS_IDENTITY
              //
              // Every poster checks all known aliases instead of assuming
              // every addon populated the same id field.
              const statusIds =
                v634GetStatusIds(it);

              const watched =
                v634IsItemWatched(it);

              const inLibrary =
                !!v633LibrarySet &&
                typeof (
                  v633LibrarySet as any
                ).has ===
                  'function' &&
                statusIds.some(
                  (id) =>
                    (
                      v633LibrarySet as
                        Set<string>
                    ).has(id)
                );

              /*
               * IN CINEMA remains independent.
               */
              const releaseId =
                String(
                  (it as any).imdb_id ||
                    (it as any).id ||
                    ''
                );

              const inCinema =
                v610GetReleaseStatus(
                  releaseId
                ) === 'in_cinemas';

              /*
               * Existing canonical artwork logic remains untouched.
               */
              const posterId =
                String(
                  (it as any).imdb_id ||
                    (it as any).id ||
                    (it as any).content_id ||
                    ''
                );

              const suppliedPoster =
                it.poster
                  ? String(it.poster)
                  : null;

              // V714D_CANONICAL_SEARCH_POSTERS
              // If the supplied item already carries the Cinemeta/MetaHub
              // canonical artwork, use it immediately. This prevents a stale
              // persisted registry value from winning the first TV paint.
              const suppliedIsCanonicalMetaHub =
                !!suppliedPoster &&
                /^https:\/\/images\.metahub\.space\/poster\//i.test(
                  suppliedPoster
                );

              const canonicalPoster =
                suppliedIsCanonicalMetaHub
                  ? suppliedPoster
                  : _v614GetPoster(
                      posterId,
                      suppliedPoster
                    );

              return {
                id: String(
                  it.id ||
                    it.imdb_id ||
                    `${serviceName}-${index}`
                ),

                title: String(
                  it.name ||
                    it.title ||
                    ''
                ),

                poster:
                  canonicalPoster || null,

                badge:
                  inCinema
                    ? 'IN CINEMA'
                    : null,

                inLibrary,
                watched,
              };
            }
          ),

        [
          validItems,
          serviceName,
          v610BadgeVersion,
          v633LibrarySet,
          v633WatchedVersion,
        ]
      );

    // V635_DIRECT_NATIVE_STATUS
    //
    // Normal shared state remains authoritative. This is only the
    // immediate native paint path so the user never has to move focus.
    const v635NativeTVRowRef =
      useRef<any>(null);

    const v635NativeItemsRef =
      useRef<any[]>(
        nativeTVItems as any[]
      );

    v635NativeItemsRef.current =
      nativeTVItems as any[];

    const v635PushNativeStatusNow =
      useCallback(
        (
          index: number,
          action: any
        ) => {
          if (
            !Number.isInteger(index) ||
            index < 0
          ) {
            return;
          }

          let watched:
            boolean |
            undefined;

          let inLibrary:
            boolean |
            undefined;

          if (
            action === 'watched'
          ) {
            watched = true;
          }

          if (
            action === 'unwatched'
          ) {
            watched = false;
          }

          if (
            action === 'added'
          ) {
            inLibrary = true;
          }

          if (
            action === 'removed'
          ) {
            inLibrary = false;
          }

          if (
            watched === undefined &&
            inLibrary === undefined
          ) {
            return;
          }

          const current =
            v635NativeItemsRef
              .current || [];

          if (
            index >=
            current.length
          ) {
            return;
          }

          const next =
            current.map(
              (
                entry: any,
                i: number
              ) =>
                i === index
                  ? {
                      ...entry,

                      ...(watched !==
                      undefined
                        ? {
                            watched,
                          }
                        : {}),

                      ...(inLibrary !==
                      undefined
                        ? {
                            inLibrary,
                          }
                        : {}),
                    }
                  : entry
            );

          v635NativeItemsRef
            .current = next;

          try {
            const host: any =
              v635NativeTVRowRef
                .current;

            /*
             * Direct host prop update.
             * No React state wait, no Modal-close wait.
             */
            if (
              host &&
              typeof host
                .setNativeProps ===
                'function'
            ) {
              host.setNativeProps({
                items: next,
              });
            }
          } catch (e) {
            try {
              console.log(
                '[V635] direct native status failed:',
                e
              );
            } catch (_) {}
          }
        },
        []
      );

    const nativeTVPressRef = useRef<(() => void) | null>(null);
    const nativeTVLongPressRef = useRef<(() => void) | null>(null);
    const nativeTVFocusedIndexRef = useRef<number>(-1);
    const nativeTVOwnerRef = useRef(
      `native-tv-row:${rowIndex}:${serviceName || title || ''}`
    );

    const handleNativeTVFocus = useCallback(
      (event: any) => {
        const ne = event?.nativeEvent || {};
        const index = Number(ne.index);

        if (!Number.isInteger(index) || index < 0 || index >= validItems.length) {
          return;
        }

        const focusedItem = validItems[index];
        if (!focusedItem) return;

        // V625_LONGPRESS_OVER_FOCUS_EVENT
        // Native row sends holds through the same proven topItemFocus
        // event that ordinary poster focus already uses.
        if (ne.longPress === true) {
          const anchor =
            [ne.x, ne.y, ne.width, ne.height].every(
              (v: any) =>
                typeof v === 'number' &&
                Number.isFinite(v)
            )
              ? {
                  x: Number(ne.x),
                  y: Number(ne.y),
                  width: Number(ne.width),
                  height: Number(ne.height),
                }
              : null;

          let inLibrary = false;

          try {
            const statusIds =
              v634GetStatusIds(
                focusedItem
              );

            const libSet =
              (useContentStore as any)
                .getState?.()
                .librarySet;

            if (
              libSet &&
              typeof libSet.has ===
                'function'
            ) {
              inLibrary =
                statusIds.some(
                  (id) =>
                    libSet.has(id)
                );
            }
          } catch (_) {}

          try {
            console.log(
              '[V625] native long-press received index=' +
                index
            );

            // V634_SHARED_STATUS_IDENTITY
            //
            // Preserve the original object. The shared menu now understands
            // imdb_id + id + content_id simultaneously.
            v176ShowLongPressMenu({
              item: focusedItem,
              inLibraryOverride:
                inLibrary,
              anchor,
              onAfterChange: (action) => {
                v635PushNativeStatusNow(
                  index,
                  action
                );
              },
            });
          } catch (e) {
            console.log(
              '[V625] long-press menu failed:',
              e
            );
          }

          return;
        }
        // V614B_NATIVE_POSTER_SYNC
        // Current metadata verification reuses the existing settle-aware,
        // bounded metadata queue. No network work is added to held-D-pad focus.
        try {
          const cid = String(
            (focusedItem as any).imdb_id ||
            (focusedItem as any).id ||
            ''
          );

          const baseId = /^tt\d+/.test(cid)
            ? cid.split(':')[0]
            : cid;

          const type = String(
            (focusedItem as any).type || ''
          ).toLowerCase();

          if (
            /^tt\d+$/.test(baseId) &&
            (type === 'movie' || type === 'series')
          ) {
            const cached: any = getMetaCache(baseId);

            if (cached?.poster) {
              _v614RegisterVerifiedPoster(
                baseId,
                String(cached.poster)
              );
            } else {
              _v575QueueMetaWhenIdle(
                type,
                baseId
              );
            }
          }
        } catch (_) {}

        nativeTVFocusedIndexRef.current = index;
        (globalThis as any).__psNativeTVFocusOwner = nativeTVOwnerRef.current;

        const anchor =
          [ne.x, ne.y, ne.width, ne.height].every(
            (v: any) => typeof v === 'number' && Number.isFinite(v)
          )
            ? {
                x: Number(ne.x),
                y: Number(ne.y),
                width: Number(ne.width),
                height: Number(ne.height),
              }
            : null;

        nativeTVPressRef.current = () => {
          try {
            onItemPress(focusedItem);
          } catch (_) {}
        };

        nativeTVLongPressRef.current = () => {
          let inLibrary = false;

          try {
            const statusIds =
              v634GetStatusIds(
                focusedItem
              );

            const libSet =
              (useContentStore as any)
                .getState?.()
                .librarySet;

            if (
              libSet &&
              typeof libSet.has ===
                'function'
            ) {
              inLibrary =
                statusIds.some(
                  (id) =>
                    libSet.has(id)
                );
            }
          } catch (_) {}

          try {
            // V634_SHARED_STATUS_IDENTITY
            //
            // Preserve the original object. The shared menu now understands
            // imdb_id + id + content_id simultaneously.
            v176ShowLongPressMenu({
              item: focusedItem,
              inLibraryOverride:
                inLibrary,
              anchor,
              onAfterChange: (action) => {
                v635PushNativeStatusNow(
                  index,
                  action
                );
              },
            });
          } catch (_) {}
        };

        // Reuse the SAME MainActivity -> onTVKeyEvent short/long-select path
        // ContentCard already uses. Only the focused native item owns it.
        try {
          v176pRegisterPressGetter(() => nativeTVPressRef.current);
        } catch (_) {}

        try {
          v176iRegisterGetter(() => nativeTVLongPressRef.current);
        } catch (_) {}

        try {
          v173RegisterLongPress(nativeTVLongPressRef.current);
        } catch (_) {}

        handleCardFocus(index);
      },
      [validItems, onItemPress, handleCardFocus]
    );

    const handleNativeTVRowBlur = useCallback(() => {
      if (
        (globalThis as any).__psNativeTVFocusOwner !==
        nativeTVOwnerRef.current
      ) {
        return;
      }

      (globalThis as any).__psNativeTVFocusOwner = null;
      nativeTVFocusedIndexRef.current = -1;
      nativeTVPressRef.current = null;
      nativeTVLongPressRef.current = null;

      try {
        v176pRegisterPressGetter(null);
      } catch (_) {}

      try {
        v176iRegisterGetter(null);
      } catch (_) {}

      try {
        v173RegisterLongPress(null);
      } catch (_) {}

      handleCardBlur();
    }, [handleCardBlur]);

    useEffect(() => {
      return () => {
        if (
          (globalThis as any).__psNativeTVFocusOwner ===
          nativeTVOwnerRef.current
        ) {
          (globalThis as any).__psNativeTVFocusOwner = null;

          try {
            v176pRegisterPressGetter(null);
          } catch (_) {}

          try {
            v176iRegisterGetter(null);
          } catch (_) {}

          try {
            v173RegisterLongPress(null);
          } catch (_) {}
        }
      };
    }, []);

    const nativeTVPreferredFocusIndex = useMemo(() => {
      try {
        const savedRow = Number((globalThis as any).__v442LastNavRowIdx);
        const savedId = String(
          (globalThis as any).__v443LastPressedId ||
            (globalThis as any).__v442LastFocusedId ||
            ''
        );
        const savedAt = Number(
          (globalThis as any).__v443LastPressedAt ||
            (globalThis as any).__v442LastNavAt ||
            0
        );

        if (
          savedId &&
          savedRow === rowIndex &&
          savedAt > 0 &&
          Date.now() - savedAt < 60000
        ) {
          const i = validItems.findIndex(
            (it: any) =>
              String(it?.imdb_id || it?.id || it?.content_id || '') === savedId
          );

          if (i >= 0) return i;
        }
      } catch (_) {}

      return isFirstRow ? 0 : -1;
    }, [validItems, rowIndex, isFirstRow]);

    if (validItems.length === 0) {
      return null;
    }

    return (
      <LazyMount height={200} rowIndex={rowIndex}>
        <View style={styles.container}>
          <View
            style={[
              styles.header,
              isTV && styles.headerTV,
            ]}
          >
            <Text
              style={[
                styles.title,
                isTV && styles.titleTV,
              ]}
            >
              {title || serviceName || 'Content'}
            </Text>
          </View>

          {isTV ? (
            <PrivastreamTVRow
              ref={v635NativeTVRowRef as any}
              style={{ height: cardWidth * 1.5 + 44 }}
              items={nativeTVItems}
              cardWidth={cardWidth}
              cardHeight={cardWidth * 1.5}
              gap={ITEM_GAP}
              leftPadding={TV_PADDING_LEFT}
              rightPadding={screenWidth}
              anchorColumn={5}
              diagnosticLabel={String(title || serviceName || '')}
              preferredFocusIndex={nativeTVPreferredFocusIndex}
              onItemFocus={handleNativeTVFocus}
              onRowBlur={handleNativeTVRowBlur}
            />
          ) : (
            <FlashList
            ref={flatListRef as any}
            horizontal
            data={validItems}
            extraData={validItems.length}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={
              isTV
                ? { paddingLeft: TV_PADDING_LEFT, paddingRight: screenWidth, paddingVertical: 4 }
                : styles.scrollContent
            }
            estimatedItemSize={itemTotalWidth}
            drawDistance={itemTotalWidth * 4} /* V438_ROW_HYDRATION - more pre-rendered tiles = D-pad stays in-row */ // V250 Ã¢â‚¬â€ was 1.5x; gives more pre-rendered cards = smoother D-pad
            onEndReached={handleEndReached}
            onEndReachedThreshold={3}
            onViewableItemsChanged={onViewableItemsChanged} // PATCH_V250_VIEWPORT_PREFETCH
            viewabilityConfig={viewabilityConfig}
            removeClippedSubviews={true} /* V438 - keep native tags alive for spatial nav */
          />
          )}
        </View>
      </LazyMount>
    );
  }
);

export const MetaRow = ServiceRow;

const styles = StyleSheet.create({
  container: {
    marginBottom: 8,
    overflow: 'visible',
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },

  headerTV: {
    paddingHorizontal: TV_PADDING_LEFT,
    marginBottom: 6,
  },

  title: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0.5,
  },

  titleTV: {
    fontSize: 22,
  },

  scrollContent: {
    paddingLeft: MOBILE_PADDING,
    paddingRight: MOBILE_PADDING + 32,
    paddingVertical: 4,
  },

  scrollContentTV: {
    paddingLeft: TV_PADDING_LEFT,
    paddingRight: TV_PADDING_RIGHT + 80,
    paddingVertical: 4,
  },

  flatListStyle: {
    overflow: 'visible',
  },
});
