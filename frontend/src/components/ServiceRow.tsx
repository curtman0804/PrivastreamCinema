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

// PATCH_V250_BACK_NAV_FOCUS â€” module-level map of rowKey -> last-focused content_id.
// When user backs out of Details, ServiceRow re-mounts and gives the previously
// focused poster hasTVPreferredFocus=true, so the highlight appears in the same
// frame as the row renders (no D-pad-poll latency, no scroll glitch).
const _v250_lastFocusedByRow = new Map<string, string>();

// PATCH_V250_VIEWPORT_PREFETCH â€” track which ids we've already kicked
// off a /meta prefetch for (per app session). Avoids duplicate hits.
const _v250_prefetched = new Set<string>();

// v238 â€” eager-mount top 3 rows so user sees a "full" Discover screen
// in the first frame instead of 1 row + empty space.  Rows 3+ paint at
// 20ms steps (cap 400ms total) â€” fast enough to feel simultaneous.
const LazyMount: React.FC<{
  height: number;
  rowIndex: number;
  children: React.ReactNode;
}> = memo(({ height, rowIndex, children }) => {
  const [shouldRender, setShouldRender] = useState(rowIndex <= 2);

  useEffect(() => {
    if (shouldRender) return;

    const delayMs = Math.min((rowIndex - 2) * 20, 400);

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

    // v238 â€” DO NOT early-return here.  Hooks below this point MUST run
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

        // PATCH_V250_BACK_NAV_FOCUS â€” remember which poster was focused
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
            onCardFocus={() => handleCardFocus(index)}
            onCardBlur={handleCardBlur}
            showTitle={true}
            hasTVPreferredFocus={
              (isFirstRow && index === 0) ||
              // PATCH_V250_BACK_NAV_FOCUS â€” restore last-focused poster
              // in this row when user returns from Details.
              (_v250_lastFocusedByRow.get(
                `${rowIndex}:${serviceName || title || ''}`
              ) === (item.imdb_id || item.id))
            }
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

    const keyExtractor = useCallback(
      (item: ContentItem) =>
        item.id || item.imdb_id || `${item.name}`,
      []
    );

    // PATCH_V250_VIEWPORT_PREFETCH â€” when posters scroll into view, fire
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
        (api as any)?.content?.getMeta?.(t, cid)
          .then((d: any) => { if (d) setMetaCache(cid, d); })
          .catch(() => { /* best-effort */ });
      }
    }).current;

    const viewabilityConfig = useRef({
      itemVisiblePercentThreshold: 30, // fire when 30% of poster visible
      minimumViewTime: 150,             // 150ms in-viewport before counting (debounces fast scrolls)
    }).current;

    // v238 â€” SAFE empty-state guard: every hook above has already been
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
            drawDistance={itemTotalWidth * 3} // V250 â€” was 1.5x; gives more pre-rendered cards = smoother D-pad
            onEndReached={handleEndReached}
            onEndReachedThreshold={3}
            onViewableItemsChanged={onViewableItemsChanged} // PATCH_V250_VIEWPORT_PREFETCH
            viewabilityConfig={viewabilityConfig}
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