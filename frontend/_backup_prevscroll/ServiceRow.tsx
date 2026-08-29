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
} from 'react-native';

import { FlashList } from '@shopify/flash-list';

import { ContentCard, getCardWidth } from './ContentCard';
import { ContentItem } from '../api/client';
import apiClient, { api } from '../api/client';
import { getMetaCache, setMetaCache } from '../store/contentStore'; // PATCH_V250_VIEWPORT_PREFETCH
import { colors } from '../styles/colors';

const ITEM_GAP = 16;
const TV_PADDING_LEFT = 48;
const TV_PADDING_RIGHT = 48;
const MOBILE_PADDING = 16;

const TV_SCROLL_ANCHOR = 4;

// PATCH_V250_BACK_NAV_FOCUS ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â module-level map of rowKey -> last-focused content_id.
// When user backs out of Details, ServiceRow re-mounts and gives the previously
// focused poster hasTVPreferredFocus=true, so the highlight appears in the same
// frame as the row renders (no D-pad-poll latency, no scroll glitch).
const _v250_lastFocusedByRow = new Map<string, string>();

// PATCH_V250_VIEWPORT_PREFETCH ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â track which ids we've already kicked
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
      .then((d: any) => { if (d) setMetaCache(job.cid, d); })
      .catch(() => { /* best-effort */ })
      .finally(() => { _v445Inflight = Math.max(0, _v445Inflight - 1); _v445Drain(); });
  }
}
function _v445QueueMeta(t: string, cid: string) {
  _v445Queue.push({ t, cid });
  _v445Drain();
}

// V444_BOOT_SERVICE_ROW - visible startup marker.  If this line appears in
// logcat, v443+v444 patches are ACTIVE in the bundle.
try { console.log('[V444_BOOT] ServiceRow module loaded; v443 map-read=DISABLED'); } catch (_) {}

// V443_STOP_FOCUS_HOP marker.  See patch_v443.ps1 for rationale.  The map
// _v250_lastFocusedByRow is still written on every card focus (harmless
// tracking) but is NEVER read by hasTVPreferredFocus.

// v238 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â eager-mount top 3 rows so user sees a "full" Discover screen
// in the first frame instead of 1 row + empty space.  Rows 3+ paint at
// 20ms steps (cap 400ms total) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â fast enough to feel simultaneous.
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


const tvRowFocusRegistry = new Map<
  number,
  Map<number, number>
>();

function tvRegisterCardTag(
  rowIndex: number,
  columnIndex: number,
  tag: number
) {
  if (!Number.isFinite(rowIndex) || !Number.isFinite(columnIndex) || !Number.isFinite(tag) || tag <= 0) {
    return;
  }

  let row = tvRowFocusRegistry.get(rowIndex);

  if (!row) {
    row = new Map<number, number>();
    tvRowFocusRegistry.set(rowIndex, row);
  }

  row.set(columnIndex, tag);
}

function tvGetCardTag(
  rowIndex: number,
  columnIndex: number
): number | null {
  const row = tvRowFocusRegistry.get(rowIndex);

  if (!row || row.size === 0) {
    return null;
  }

  const exact = row.get(columnIndex);

  if (exact) {
    return exact;
  }

  const columns = Array.from(row.keys()).sort((a, b) => a - b);

  const lower = columns.filter(c => c <= columnIndex);

  if (lower.length > 0) {
    return row.get(lower[lower.length - 1]) ?? null;
  }

  return row.get(columns[0]) ?? null;
}

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
  nextFocusDownTag?: number | null;
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
    nextFocusDownTag = null,
  }) => {
    const { width: screenWidth, height } = useWindowDimensions();

    const isTV = screenWidth > height || screenWidth > 800;

    const cardWidth = getCardWidth(screenWidth, isTV, 'medium');

    const itemTotalWidth = cardWidth + ITEM_GAP;

    const [allItems, setAllItems] = useState<ContentItem[]>(
      () => initialItems || []
    );

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

    const validItems = useMemo(
      () => (allItems || []).filter(Boolean),
      [allItems]
    );

    itemCountRef.current = validItems.length;

    // v238 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â DO NOT early-return here.  Hooks below this point MUST run
    // every render or React throws "Rendered more/fewer hooks than during
    // the previous render".  The empty-state guard is moved AFTER all
    // hooks (see further down).

    const fetchMore = useCallback(async () => {
      const now = Date.now();

      if (isFetchingRef.current || !hasMoreRef.current) return;

      if (now - lastFetchTime.current < 2000) return;

      isFetchingRef.current = true;
      lastFetchTime.current = now;

      try {
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
    }, [serviceName, contentType]);

    const handleCardFocus = useCallback(
      (index: number) => {
        if (blurTimerRef.current) {
          clearTimeout(blurTimerRef.current);
          blurTimerRef.current = null;
        }

        onSectionFocus?.();

        const focusedItem = validItems[index];

        // PATCH_V250_BACK_NAV_FOCUS ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â remember which poster was focused
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

        (globalThis as any).__dbgHCF = 'fi=' + (focusedItem ? 'Y' : 'N') + ',oif=' + (onItemFocus ? 'Y' : 'N'); if (focusedItem && onItemFocus) {
          onItemFocus(focusedItem);
        }

        if (
          isTV &&
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

        if (
          index >= totalRef.current - 15 &&
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
            onCardFocus={() => {
              handleCardFocus(index);

              try {
                const cardNode = ReactNative.findNodeHandle(
                  flatListRef.current
                );

                if (cardNode) {
                  tvRegisterCardTag(rowIndex, index, cardNode);
                }
              } catch (_) {}
            }}
            onCardBlur={handleCardBlur}
            showTitle={true}
            hasTVPreferredFocus={
              (isFirstRow && index === 0) ||
              // PATCH_V250_BACK_NAV_FOCUS ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â restore last-focused poster
              // in this row when user returns from Details.
              (false /* V443_STOP_FOCUS_HOP - map-driven focus disabled */)
            }
            isFirstInRow={isFirst}
            isLastInRow={isLast}
            /* V316c_FOCUS_UP - only row 0 supplies a real tag; deeper
               rows pass null and fall back to default spatial nav. */
            nextFocusUpTag={
              nextFocusUpTag ??
              tvGetCardTag(rowIndex - 1, index)
            }
            /* TEMP: disable native nextFocusDown while diagnosing Fire TV focus bug */
            nextFocusDownTag={undefined}
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
        nextFocusDownTag,
      ]
    );

    const keyExtractor = useCallback(
      (item: ContentItem) =>
        item.id || item.imdb_id || `${item.name}`,
      []
    );

    // PATCH_V250_VIEWPORT_PREFETCH ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â when posters scroll into view, fire
    // their meta prefetch immediately (no dwell needed).  This is the real
    // fix for "spotty" hover-to-instant: by the time the user's D-pad
    // lands on ANY visible poster, /meta has already been warmed.
    // Throttled by _v250_prefetched Set so we never duplicate per session.
    const onViewableItemsChanged = useRef((_info: any) => {
      /* V563_NO_VIEWPORT_META - disabled. This fired a /meta request for EVERY
         poster that scrolled into view, producing constant network + JSON churn
         that triggered GC and froze the scroll (the 2-step). Metadata loads on
         the details screen instead. */
    }).current;

    const viewabilityConfig = useRef({
      itemVisiblePercentThreshold: 30, // fire when 30% of poster visible
      minimumViewTime: 150,             // 150ms in-viewport before counting (debounces fast scrolls)
    }).current;

    // v238 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â SAFE empty-state guard: every hook above has already been
    // called this render, so React's hook order is stable across renders
    // regardless of whether validItems is empty.
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
                ? styles.scrollContentTV
                : styles.scrollContent
            }
            estimatedItemSize={itemTotalWidth}
            drawDistance={itemTotalWidth * 2} /* V563_LIGHTER_ROWS - was *8 (~16 cards/row); that made each row expensive to mount = the ~1s freeze. *2 keeps enough buffer for horizontal D-pad. */ // V250 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â was 1.5x; gives more pre-rendered cards = smoother D-pad
            onEndReached={handleEndReached}
            onEndReachedThreshold={3}
            onViewableItemsChanged={onViewableItemsChanged} // PATCH_V250_VIEWPORT_PREFETCH
            viewabilityConfig={viewabilityConfig}
            removeClippedSubviews={false} /* V438 - keep native tags alive for spatial nav */
          />
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


