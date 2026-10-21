import { PrivastreamPageHeader } from '../../src/components/PrivastreamPageHeader';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  useWindowDimensions,
  findNodeHandle,
  Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Image as RNImage } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useContentStore } from '../../src/store/contentStore';
import { ContentItem } from '../../src/api/client';
import { colors } from '../../src/styles/colors';
/* V176_LONGPRESS_MENU â€” pull the unified menu opener + watched/progress
   subscriptions in so LibraryCard renders the gold check and routes
   long-press through the shared Alert. */
import {
  getCardWidth,
  v160GetPoster as _v149GetPoster,
  v160RegisterPoster as _v149RegisterPoster,
  v160SubscribePoster as _v149SubscribePoster,
  v172IsWatched as _v172IsWatched,
  v172SubscribeWatched as _v172SubscribeWatched,
  v176HasProgress as _v176HasProgress,
  v176SubscribeProgress as _v176SubscribeProgress,
  v176ShowLongPressMenu as _v176ShowLongPressMenu,
  /* V176E_TV_LONGPRESS â€” register this card's menu handler with the
     v173 TV event dispatcher so the remote Menu button (now mapped to
     longSelect via withTVKeyEvents.js) fires this card's menu. */
  v173RegisterLongPress as _v173RegLP,
  /* V176K_POPOVER */ V176kPopover, v176kMeasureAnchor
} from '../../src/components/ContentCard';

const NO_POSTER_IMAGE = require('../../assets/images/no-poster.png');

// W121ZLIB139D_GTV_DISCOVER_ROW_SNAP
// Six fixed columns + Discover-style edge traps + row-by-row vertical anchor scrolling.
type FilterType = 'movies' | 'series' | 'channels'; // V784F TV Channels restored

// Library card â€” EXACT same X-button pattern as ContinueWatchingCard in discover.tsx
function LibraryCard({
  item,
  cardWidth,
  cardHeight,
  isTV,
  isFirstInRow,
  isLastInRow,
  tvGridGap,
  onPress,
  onRemove,
  onCardFocus,
  onCardBlur,
}: {
  item: ContentItem;
  cardWidth: number;
  cardHeight: number;
  isTV: boolean;
  isFirstInRow?: boolean;
  isLastInRow?: boolean;
  tvGridGap?: number;
  onPress: () => void;
  onRemove: () => void;
  onCardFocus?: () => void;
  onCardBlur?: () => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const [xFocused, setXFocused] = useState(false);

  // Refs for explicit focus navigation between poster and X button
  const posterRef = useRef<View>(null);
  const xButtonRef = useRef<View>(null);
  const [posterTag, setPosterTag] = useState<number | undefined>(undefined);
  const [xButtonTag, setXButtonTag] = useState<number | undefined>(undefined);

  useEffect(() => {
    // Get native node handles after mount for nextFocusUp/Down wiring
    const pTag = posterRef.current ? findNodeHandle(posterRef.current) : null;
    const xTag = xButtonRef.current ? findNodeHandle(xButtonRef.current) : null;
    if (pTag) setPosterTag(pTag);
    if (xTag) setXButtonTag(xTag);
  }, []);

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleXFocus = () => {
    setXFocused(true);
  };

  const xButtonSize = isTV ? 30 : 24;
  const xRowHeight = xButtonSize + 8;

  /* V176_LONGPRESS_MENU â€” derive watched + progress per-card; subscribe
     so any change elsewhere (player marks watched, another long-press
     clears progress) instantly refreshes the gold badge / menu. */
  const _v176ContentId = ((item as any).imdb_id || (item as any).id || (item as any).content_id) as string | undefined;
  const [, _v176Bump] = useState(0);
  useEffect(() => _v172SubscribeWatched(() => _v176Bump((x) => (x + 1) & 0xff)), []);
  useEffect(() => _v176SubscribeProgress(() => _v176Bump((x) => (x + 1) & 0xff)), []);
  const _v176IsWatched = _v172IsWatched(_v176ContentId);
  const _v176HasProg = _v176HasProgress(_v176ContentId);

  // W121ZPOST149A: use the same persisted, per-title poster identity as
  // Continue Watching, Search, and Discover. Library previously used the
  // historical `item.poster` URL directly and never subscribed to updates.
  const _v149PosterId = String(
    (item as any).imdb_id ||
    (item as any).content_id ||
    (item as any).id ||
    ''
  ).trim();
  const _v149FallbackPoster = String(item.poster || '').trim();
  const [, _v149PosterRevision] = useState(0);
  useEffect(() => {
    const unsubscribe = _v149SubscribePoster(
      _v149PosterId,
      () => _v149PosterRevision(x => (x + 1) & 0xffff)
    );
    if (_v149FallbackPoster) {
      _v149RegisterPoster(_v149PosterId, _v149FallbackPoster);
    }
    return unsubscribe;
  }, [_v149PosterId, _v149FallbackPoster]);
  const _v149Poster = _v149GetPoster(_v149PosterId, _v149FallbackPoster);

  const _v176OpenMenu = useCallback(async () => {
    /* V176K_POPOVER_MOUNTED â€” measure the poster so the menu anchors
       from its corner, then emit through the existing v176 helper. */
    let anchor: any = null;
    try { anchor = await v176kMeasureAnchor(posterRef.current); } catch (_) {}
    _v176ShowLongPressMenu({
      item: { ...(item as any), content_id: _v176ContentId, content_type: (item as any).type },
      inLibraryOverride: true,
      hasProgressOverride: _v176HasProg,
      anchor,
      onAfterChange: (action) => {
        if (action === 'removed') { try { onRemove && onRemove(); } catch (_) {} }
      },
    });
  }, [item, _v176ContentId, _v176HasProg, onRemove]);

  /* V176B_PRESS_TIMING â€” fire menu via onPressIn/Out timing so the
     TV remote OK button works (Pressable.onLongPress is flaky). */
  const _v176bLpTimer = useRef<any>(null);
  const _v176bLpFired = useRef<boolean>(false);
  const _v176bPressIn = useCallback(() => {
    _v176bLpFired.current = false;
    if (_v176bLpTimer.current) clearTimeout(_v176bLpTimer.current);
    _v176bLpTimer.current = setTimeout(() => {
      _v176bLpFired.current = true;
      try { _v176OpenMenu(); } catch (_) {}
    }, 500);
  }, [_v176OpenMenu]);
  const _v176bPressOut = useCallback(() => {
    if (_v176bLpTimer.current) {
      clearTimeout(_v176bLpTimer.current);
      _v176bLpTimer.current = null;
    }
  }, []);
  const _v176bOnPress = useCallback(() => {
    if (_v176bLpFired.current) { _v176bLpFired.current = false; return; }
    try { onPress && onPress(); } catch (_) {}
  }, [onPress]);


  return (
    <View
      style={{
        width: cardWidth,
        // W121ZLIB139C_FIXED_COLUMN_TRACKS
        // Never redistribute a short final row. Every poster uses the same
        // fixed column width + gap as the full six-poster rows.
        marginRight: isTV
          ? (isLastInRow ? 0 : (tvGridGap || 0))
          : 16,
        marginBottom: isTV ? 22 : 0,
      }}
    >
      {/* V176P_X_REMOVED â€” X overlay removed; use long-press menu. */}
      {/* Main poster - pulled up fully to overlap X button row, so X appears inside poster corner */}
      <Pressable
        ref={posterRef}
        focusable={true}
        // W121ZLIB139C_DISCOVER_EDGE_TRAPS
        // Match Discover: the first/last poster in each row self-loop on
        // LEFT/RIGHT so Android TV cannot escape into the tab/tray controls.
        nextFocusLeft={
          isTV && isFirstInRow && posterTag
            ? posterTag
            : undefined
        }
        nextFocusRight={
          isTV && isLastInRow && posterTag
            ? posterTag
            : undefined
        }
        onPress={_v176bOnPress}
        onPressIn={_v176bPressIn}
        onPressOut={_v176bPressOut}
        onLongPress={_v176OpenMenu}
        delayLongPress={500}
        onFocus={() => {
          try { _v173RegLP(_v176OpenMenu); } catch (_) {}
          handleFocus();
          // W121ZLIB139D_ROW_SNAP_ON_FOCUS
          // When D-pad focus enters another grid row, tell the parent to
          // move that entire row into the same viewport anchor position.
          try { onCardFocus?.(); } catch (_) {}
        }}
        onBlur={() => { try { _v173RegLP(null); } catch (_) {} setIsFocused(false); onCardBlur?.(); }}
        android_ripple={null}
        /* V176P_X_REMOVED â€” nextFocusUp target gone. */
        style={[
          styles.posterContainer,
          /* V176P_X_REMOVED â€” no more X row to overlap. */
          { height: cardHeight },
          isFocused && styles.posterFocused,
        ]}
      >
        <View style={styles.imageWrapper}>
          <Image
            source={{ uri: _v149Poster }}
            style={styles.posterImage}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        </View>

        {/* V176_LONGPRESS_MENU â€” gold check overlay when watched. */}
        {_v176IsWatched && (
          <View style={styles.v176WatchedBadge} pointerEvents="none">
            <Ionicons name="checkmark" size={14} color="#B8A05C" />
          </View>
        )}

        {!_v149Poster && (
          <View style={styles.placeholder}>
            <RNImage
              source={NO_POSTER_IMAGE}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          </View>
        )}
      </Pressable>

      {/* Title below poster */}
      <View style={styles.titleContainer}>
        <Text style={[styles.cardTitle, isTV && styles.cardTitleTV]} numberOfLines={2}>
          {item.name || item.title}
        </Text>
      </View>
    </View>
  );
}

// W121ZNAV145C2: stable component identity prevents filter tabs from
// remounting (and losing native TV focus) whenever Library rerenders.
const LibraryFilterButton = React.memo(function LibraryFilterButton({
  type, label, selected, onSelect,
}: {
  type: FilterType;
  label: string;
  selected: boolean;
  onSelect: (type: FilterType) => void;
}) {
  const [btnFocused, setBtnFocused] = useState(false);
  return (
    <Pressable
      onPress={() => onSelect(type)}
      onFocus={() => setBtnFocused(true)}
      onBlur={() => setBtnFocused(false)}
      style={[
        styles.filterButton,
        btnFocused && styles.filterButtonFocused,
        selected && styles.filterButtonActive,
      ]}
    >
      <Text style={[
        styles.filterText,
        btnFocused && styles.filterTextFocused,
        selected && styles.filterTextActive,
      ]}>
        {label}
      </Text>
    </Pressable>
  );
});

export default function LibraryScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;
  const library = useContentStore(s => s.library);
  const isLoadingLibrary = useContentStore(s => s.isLoadingLibrary);
  const fetchLibrary = useContentStore(s => s.fetchLibrary);
  const removeFromLibrary = useContentStore(s => s.removeFromLibrary);
  const [filter, setFilter] = useState<FilterType>('movies');
  const [refreshing, setRefreshing] = useState(false);
  // W121ZLIB139E_LAST_ROW_ANCHOR_SPACE
  // Track the actual FlatList viewport so the content gets enough trailing
  // space for even the final grid row to move into the same top row anchor.
  const [tvGridViewportHeight, setTvGridViewportHeight] = useState(0);

  // W121ZLIB139C_GTV_DISCOVER_STYLE_GRID
  // TV/streaming-device Library is a vertical six-column poster grid.
  // Phone layout is intentionally left on the existing horizontal behavior for now.
  const TV_GRID_COLUMNS = 6;
  const TV_GRID_SIDE_PADDING = 48;
  const TV_GRID_GAP = 18;
  const tvGridCardWidth = Math.floor(
    (
      width -
      (TV_GRID_SIDE_PADDING * 2) -
      (TV_GRID_GAP * (TV_GRID_COLUMNS - 1))
    ) / TV_GRID_COLUMNS
  );
  const cardWidth = isTV
    ? Math.max(120, tvGridCardWidth)
    : getCardWidth(width, false, 'medium');
  const cardHeight = cardWidth * 1.5;
  const itemTotalWidth = cardWidth + 16;
  const paddingLeft = isTV ? TV_GRID_SIDE_PADDING : 16;

  // W121ZLIB139D_ROW_SNAP_GEOMETRY
  // One TV grid row = poster + title block + fixed bottom gap.  Scrolling
  // by this exact pitch makes the newly focused row occupy the previous
  // row's viewport position instead of merely exposing one poster.
  const TV_GRID_TITLE_HEIGHT = 38;
  const TV_GRID_ROW_BOTTOM_GAP = 22;
  const TV_GRID_CONTENT_TOP_PADDING = 8;
  const TV_GRID_CONTENT_BOTTOM_PADDING = 40;
  const tvGridRowPitch = cardHeight + TV_GRID_TITLE_HEIGHT + TV_GRID_ROW_BOTTOM_GAP;

  // W121ZLIB139E_LAST_ROW_ANCHOR_SPACE
  // Without this footer, a short Library can hit maxScrollY before a lower
  // row reaches the top anchor. The 139D diagnostic proved row 1 requested
  // y=254 but the list physically stopped at y=75. Give the list exactly
  // enough trailing space for the last row to occupy the top grid position.
  const tvGridFooterHeight = isTV && tvGridViewportHeight > 0
    ? Math.max(
        0,
        Math.ceil(
          tvGridViewportHeight -
          tvGridRowPitch -
          TV_GRID_CONTENT_TOP_PADDING -
          TV_GRID_CONTENT_BOTTOM_PADDING
        )
      )
    : 0;

  // Track horizontal nav for scroll behavior
  const isNavigatingRef = useRef(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const TV_SCROLL_ANCHOR = 4;
  const lastFocusedTvRowRef = useRef(-1);

  useEffect(() => {
    fetchLibrary();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchLibrary(true);
    setRefreshing(false);
  }, []);

  const handleItemPress = useCallback((item: ContentItem) => {
    const id = item.imdb_id || item.id;
    const encodedId = encodeURIComponent(id);
    router.push({
      pathname: `/details/${item.type}/${encodedId}`,
      params: {
        name: item.name || '',
        poster: item.poster || '',
      },
    });
  }, [router]);

  const handleRemoveItem = useCallback(async (item: ContentItem) => {
    const contentId = item.imdb_id || item.id;
    const contentType = item.type || 'movie';
    try {
      await removeFromLibrary(contentType, contentId);
    } catch (error) {
      console.log('Remove error:', error);
    }
  }, [removeFromLibrary]);

  const getFilteredContent = (): ContentItem[] => {
    if (!library) return [];
    switch (filter) {
      case 'movies': return library.movies || [];
      case 'series': return library.series || [];
      case 'channels': return library.channels || [];
      default: return library.movies || [];
    }
  };

  const filteredContent = getFilteredContent();

  const handleCardFocus = useCallback((index: number) => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }

    if (isTV) {
      // W121ZLIB139D_DISCOVER_STYLE_ROW_SNAP
      // Horizontal focus remains native.  Vertical row changes explicitly
      // scroll by one complete six-poster row so the destination row moves
      // into the same top anchor occupied by the row we just left.
      const rowIndex = Math.floor(index / TV_GRID_COLUMNS);
      if (
        flatListRef.current &&
        rowIndex !== lastFocusedTvRowRef.current
      ) {
        const targetOffset = Math.max(0, rowIndex * tvGridRowPitch);
        flatListRef.current.scrollToOffset({
          offset: targetOffset,
          animated: true,
        });
        lastFocusedTvRowRef.current = rowIndex;
      }
      isNavigatingRef.current = false;
      return;
    }

    if (flatListRef.current && isNavigatingRef.current) {
      const targetOffset = Math.max(0, (index - TV_SCROLL_ANCHOR) * itemTotalWidth);
      flatListRef.current.scrollToOffset({ offset: targetOffset, animated: true });
    }
    isNavigatingRef.current = true;
  }, [itemTotalWidth, isTV, tvGridRowPitch]);

  useEffect(() => {
    // W121ZLIB139D_FILTER_ROW_RESET
    // A filter change starts the new grid from row zero and resets the
    // row anchor so the first D-pad move is deterministic.
    lastFocusedTvRowRef.current = -1;
    if (isTV && flatListRef.current) {
      requestAnimationFrame(() => {
        try {
          flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
        } catch (_) {}
      });
    }
  }, [filter, isTV]);

  const handleCardBlur = useCallback(() => {
    blurTimerRef.current = setTimeout(() => {
      isNavigatingRef.current = false;
    }, 150);
  }, []);

  const getItemLayout = useCallback((_data: any, index: number) => ({
    length: itemTotalWidth,
    offset: paddingLeft + (index * itemTotalWidth),
    index,
  }), [itemTotalWidth, paddingLeft]);

  const getTvItemLayout = useCallback((_data: any, index: number) => ({
    length: tvGridRowPitch,
    offset: Math.floor(index / TV_GRID_COLUMNS) * tvGridRowPitch,
    index,
  }), [tvGridRowPitch]);

  const renderItem = useCallback(({ item, index }: { item: ContentItem; index: number }) => {
    const tvColumnIndex = index % TV_GRID_COLUMNS;
    const isFirstInRow = isTV && tvColumnIndex === 0;
    const isLastInRow =
      isTV &&
      (
        tvColumnIndex === (TV_GRID_COLUMNS - 1) ||
        index === (filteredContent.length - 1)
      );

    return (
      <LibraryCard
        item={item}
        onPress={() => handleItemPress(item)}
        onRemove={() => handleRemoveItem(item)}
        onCardFocus={() => handleCardFocus(index)}
        cardWidth={cardWidth}
        cardHeight={cardHeight}
        isTV={isTV}
        isFirstInRow={isFirstInRow}
        isLastInRow={isLastInRow}
        tvGridGap={TV_GRID_GAP}
        onCardBlur={handleCardBlur}
      />
    );
  }, [
    handleItemPress,
    handleRemoveItem,
    cardWidth,
    cardHeight,
    isTV,
    handleCardBlur,
    handleCardFocus,
    filteredContent.length,
  ]);


  if (isLoadingLibrary && !library) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* V176K_POPOVER_MOUNTED â€” Stremio-style menu host for this screen. */}
      <V176kPopover />
      <PrivastreamPageHeader title="Library" />

      <View style={[styles.filterContainer, isTV && styles.filterContainerTV]}>
        <LibraryFilterButton type="movies" label="Movies" selected={filter === 'movies'} onSelect={setFilter} />
        <LibraryFilterButton type="series" label="Series" selected={filter === 'series'} onSelect={setFilter} />
      </View>

      {filteredContent.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="bookmark-outline" size={64} color={colors.primaryDark} />
          <Text style={styles.emptyText}>Your library is empty</Text>
        </View>
      ) : (
        <FlatList
          key={isTV ? 'w121zlib139d-tv-grid-6-row-snap' : 'library-phone-horizontal'}
          ref={flatListRef}
          horizontal={!isTV}
          numColumns={isTV ? TV_GRID_COLUMNS : undefined}
          data={filteredContent}
          renderItem={renderItem}
          keyExtractor={(item) => item.imdb_id || item.id || item.name || ''}
          getItemLayout={isTV ? getTvItemLayout : getItemLayout}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          // W121ZLIB139E_VIEWPORT_MEASURE
          // Measure the real TV grid viewport; footer geometry above uses this
          // instead of guessing from the physical screen or header height.
          onLayout={(e) => {
            if (!isTV) return;
            const nextHeight = Math.round(e.nativeEvent?.layout?.height || 0);
            if (nextHeight > 0 && nextHeight !== tvGridViewportHeight) {
              setTvGridViewportHeight(nextHeight);
            }
          }}
          ListFooterComponent={
            isTV && tvGridFooterHeight > 0
              ? <View style={{ height: tvGridFooterHeight }} focusable={false} />
              : null
          }
          columnWrapperStyle={
            isTV
              ? [
                  styles.tvGridRow,
                  { width: width - (TV_GRID_SIDE_PADDING * 2) },
                ]
              : undefined
          }
          contentContainerStyle={[styles.listContent, isTV && styles.listContentTV]}
          initialNumToRender={isTV ? 12 : 10}
          maxToRenderPerBatch={isTV ? 12 : 8}
          windowSize={5}
          removeClippedSubviews={!isTV}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  /* V176_LONGPRESS_MENU â€” mirror EpisodeCard's gold checkmark badge. */
  v176WatchedBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  headerTV: {
    paddingHorizontal: 48,
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.primary,
  },
  headerTitleTV: {
    fontSize: 32,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  filterContainerTV: {
    paddingHorizontal: 48,
    paddingVertical: 16,
    gap: 12,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  filterButtonActive: {
    backgroundColor: colors.primary,
  },
  filterButtonFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
    transform: [{ scale: 1.1 }],
  },
  filterText: {
    color: '#888888',
    fontSize: 14,
    fontWeight: '600',
  },
  filterTextActive: {
    color: '#FFFFFF',
  },
  filterTextFocused: {
    color: '#FFFFFF',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtext: {
    color: colors.primaryDark,
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  listContent: {
    paddingLeft: 16,
    paddingRight: 48,
    paddingTop: 8,
  },
  listContentTV: {
    paddingLeft: 48,
    paddingRight: 48,
    paddingTop: 8,
    paddingBottom: 40,
  },
  // W121ZLIB139C_GTV_DISCOVER_STYLE_GRID
  // Native Android/Fire TV spatial focus owns LEFT/RIGHT/UP/DOWN, matching Home.
  tvGridRow: {
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  // X button row - sits above poster, right-aligned (matches discover.tsx)
  xButtonRow: {
    alignItems: 'flex-end',
    zIndex: 10,
    paddingRight: 8,
  },
  removeButtonOverlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  removeButtonOverlayFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(184, 160, 92, 0.5)',
    transform: [{ scale: 1.2 }],
  },
  // Poster
  posterContainer: {
    borderRadius: 6,
    overflow: 'visible',
    backgroundColor: '#1a1a1a',
    position: 'relative',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  posterFocused: {
    borderColor: colors.primary,
  },
  imageWrapper: {
    width: '100%',
    height: '100%',
    borderRadius: 4,
    overflow: 'hidden',
  },
  posterImage: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  titleContainer: {
    paddingTop: 6,
    paddingHorizontal: 2,
    height: 38,
  },
  cardTitle: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 16,
  },
  cardTitleTV: {
    fontSize: 13,
  },
});

