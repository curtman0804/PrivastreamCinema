import React, { memo, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  useWindowDimensions,
} from 'react-native';
import { ContentCard, getCardWidth } from './ContentCard';
import { ContentItem } from '../api/client';
import apiClient from '../api/client';
import { colors } from '../styles/colors';

const ITEM_GAP = 16;
const TV_PADDING_LEFT = 48;
const TV_PADDING_RIGHT = 48;
const MOBILE_PADDING = 16;

// Anchor position: the row starts scrolling once focus reaches this card index.
// 4 means: posters 1-5 free movement, poster 6 triggers first scroll.
const TV_SCROLL_ANCHOR = 4;

interface ServiceRowProps {
  title: string;
  serviceName: string;
  contentType: 'movies' | 'series' | 'channels';
  items: ContentItem[];
  onItemPress: (item: ContentItem) => void;
  onSectionFocus?: () => void;
  isFirstRow?: boolean;
}

export const ServiceRow: React.FC<ServiceRowProps> = memo(({
  title,
  serviceName,
  contentType,
  items: initialItems,
  onItemPress,
  onSectionFocus,
  isFirstRow = false,
}) => {
  const { width: screenWidth, height } = useWindowDimensions();
  const isTV = screenWidth > height || screenWidth > 800;

  const cardWidth = getCardWidth(screenWidth, isTV, 'medium');
  const itemTotalWidth = cardWidth + ITEM_GAP;
  const paddingLeft = isTV ? TV_PADDING_LEFT : MOBILE_PADDING;

  const [allItems, setAllItems] = useState<ContentItem[]>(() => initialItems || []);

  const skipRef = useRef(initialItems?.length || 0);
  const hasMoreRef = useRef(true);
  const isFetchingRef = useRef(false);
  const lastFetchTime = useRef(0);
  const totalRef = useRef(initialItems?.length || 0);
  const itemCountRef = useRef(initialItems?.length || 0);
  const flatListRef = useRef<FlatList>(null);

  // Track whether user is navigating horizontally within this row
  const isNavigatingInRowRef = useRef(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const validItems = useMemo(() => 
    (allItems || []).filter(Boolean), [allItems]);
  
  itemCountRef.current = validItems.length;
  
  if (validItems.length === 0) return null;

  const fetchMore = useCallback(async () => {
    const now = Date.now();
    if (isFetchingRef.current || !hasMoreRef.current) return;
    if (now - lastFetchTime.current < 2000) return;

    isFetchingRef.current = true;
    lastFetchTime.current = now;
    try {
      const resp = await apiClient.get(
        `/api/content/category/${encodeURIComponent(serviceName)}/${contentType}?skip=${skipRef.current}&limit=100`
      );
      const newItems: ContentItem[] = resp.data.items || [];
      if (newItems.length > 0) {
        setAllItems(prev => {
          const ids = new Set(prev.map(i => i.id || i.imdb_id));
          const unique = newItems.filter(i => !ids.has(i.id || i.imdb_id));
          const updated = [...prev, ...unique];
          totalRef.current = updated.length;
          return updated;
        });
        skipRef.current += newItems.length;
      }
      hasMoreRef.current = resp.data.hasMore !== undefined 
        ? resp.data.hasMore 
        : newItems.length >= 20;
    } catch {
      hasMoreRef.current = false;
    } finally {
      isFetchingRef.current = false;
    }
  }, [serviceName, contentType]);

  // Card focus handler
  const handleCardFocus = useCallback((index: number) => {
    // Cancel any pending blur timer — user is still in this row
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }

    onSectionFocus?.();

    if (isTV && flatListRef.current && isNavigatingInRowRef.current) {
      // HORIZONTAL NAVIGATION — apply smooth 1-card scroll
      const targetOffset = Math.max(0, (index - TV_SCROLL_ANCHOR) * itemTotalWidth);
      flatListRef.current.scrollToOffset({ offset: targetOffset, animated: true });
    }
    // If isNavigatingInRowRef is false, user entered from another row via up/down
    // → DON'T scroll, just let the selector land where Android TV placed it

    // Mark this row as active for horizontal navigation
    isNavigatingInRowRef.current = true;

    // Pre-fetch when near end
    if (index >= totalRef.current - 15 && hasMoreRef.current) {
      fetchMore();
    }
  }, [onSectionFocus, fetchMore, itemTotalWidth, isTV]);

  // Card blur handler — detect when user leaves this row
  const handleCardBlur = useCallback(() => {
    // Set timer: if no card in this row gets focus within 150ms,
    // user has left this row (pressed up/down)
    blurTimerRef.current = setTimeout(() => {
      isNavigatingInRowRef.current = false;
    }, 150);
  }, []);

  const handleEndReached = useCallback(() => {
    if (!isFetchingRef.current && hasMoreRef.current) {
      fetchMore();
    }
  }, [fetchMore]);

  const getItemLayout = useCallback((_data: any, index: number) => ({
    length: itemTotalWidth,
    offset: paddingLeft + (index * itemTotalWidth),
    index,
  }), [itemTotalWidth, paddingLeft]);

  const renderItem = useCallback(({ item, index }: { item: ContentItem; index: number }) => (
    <ContentCard
      item={item}
      onPress={() => onItemPress(item)}
      onCardFocus={() => handleCardFocus(index)}
      onCardBlur={handleCardBlur}
      showTitle={true}
      hasTVPreferredFocus={isFirstRow && index === 0}
      isFirstInRow={index === 0}
      isLastInRow={index === itemCountRef.current - 1}
    />
  ), [onItemPress, handleCardFocus, handleCardBlur, isFirstRow]);

  const keyExtractor = useCallback((item: ContentItem) => 
    item.id || item.imdb_id || `${item.name}`, []);

  return (
    <View style={styles.container}>
      <View style={[styles.header, isTV && styles.headerTV]}>
        <Text style={[styles.title, isTV && styles.titleTV]}>
          {title || serviceName || 'Content'}
        </Text>
      </View>
      
      <FlatList
        ref={flatListRef}
        horizontal
        data={validItems}
        extraData={validItems.length}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          isTV && styles.scrollContentTV,
        ]}
        style={styles.flatListStyle}
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        removeClippedSubviews={true}
        onEndReached={handleEndReached}
        onEndReachedThreshold={3}
      />
    </View>
  );
});

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
