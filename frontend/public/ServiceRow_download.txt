import React, { memo, useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { ContentCard, getCardWidth } from './ContentCard';
import { ContentItem } from '../api/client';
import apiClient from '../api/client';
import { colors } from '../styles/colors';

interface ServiceRowProps {
  title: string;
  serviceName: string;
  contentType: 'movies' | 'series' | 'channels';
  items: ContentItem[];
  onItemPress: (item: ContentItem) => void;
  onSectionFocus?: () => void;
}

// Memoized content card - prevent any unnecessary re-renders
const MemoizedContentCard = memo(ContentCard, (prev, next) => {
  return prev.item?.id === next.item?.id && 
         prev.item?.imdb_id === next.item?.imdb_id;
});

export const ServiceRow: React.FC<ServiceRowProps> = memo(({
  title,
  serviceName,
  contentType,
  items: initialItems,
  onItemPress,
  onSectionFocus,
}) => {
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;
  const flatListRef = useRef<FlatList>(null);

  // Internal state for loaded items
  const [allItems, setAllItems] = useState<ContentItem[]>(initialItems || []);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Pagination refs - never cause re-renders
  const skipRef = useRef(initialItems?.length || 0);
  const hasMoreRef = useRef(true);
  const isLoadingRef = useRef(false);
  const initializedRef = useRef(false);

  // Only set initial items once
  useEffect(() => {
    if (!initializedRef.current && initialItems && initialItems.length > 0) {
      initializedRef.current = true;
      setAllItems(initialItems);
      skipRef.current = initialItems.length;
    }
  }, [initialItems]);

  // Valid items
  const validItems = useMemo(() => 
    (allItems || []).filter(Boolean), [allItems]);
  
  if (validItems.length === 0) return null;

  // Card width calculation
  const cardWidth = useMemo(() => 
    getCardWidth(width, isTV, 'medium'), [width, isTV]);
  const itemWidth = cardWidth + 16;

  // Fetch more items from backend
  const fetchMore = useCallback(async () => {
    if (isLoadingRef.current || !hasMoreRef.current) return;
    
    isLoadingRef.current = true;
    setIsLoadingMore(true);

    try {
      const response = await apiClient.get(
        `/api/content/category/${encodeURIComponent(serviceName)}/${contentType}?skip=${skipRef.current}&limit=100`
      );
      const data = response.data;
      const newItems: ContentItem[] = data.items || [];

      if (newItems.length > 0) {
        setAllItems(prev => {
          const existingIds = new Set(prev.map(i => i.id || i.imdb_id));
          const unique = newItems.filter(i => !existingIds.has(i.id || i.imdb_id));
          return [...prev, ...unique];
        });
        skipRef.current += newItems.length;
      }

      const moreAvailable = data.hasMore !== undefined ? data.hasMore : newItems.length >= 20;
      hasMoreRef.current = moreAvailable;
    } catch (error) {
      console.log(`[ServiceRow] Error loading more for ${serviceName}:`, error);
      hasMoreRef.current = false;
    } finally {
      isLoadingRef.current = false;
      setIsLoadingMore(false);
    }
  }, [serviceName, contentType]);

  // Handle card focus - trigger load more when near end
  const handleCardFocus = useCallback((index: number) => {
    // Notify parent that this section received focus (for vertical scroll)
    if (onSectionFocus) {
      onSectionFocus();
    }
    
    // Scroll the focused item into view
    if (flatListRef.current) {
      flatListRef.current.scrollToIndex({
        index: index,
        animated: true,
        viewPosition: 0.1,
      });
    }

    // Load more when within last 15 items
    if (index >= validItems.length - 15 && hasMoreRef.current && !isLoadingRef.current) {
      fetchMore();
    }
  }, [onSectionFocus, validItems.length, fetchMore]);

  // Memoized render item
  const renderItem = useCallback(({ item, index }: { item: ContentItem; index: number }) => (
    <MemoizedContentCard
      item={item}
      onPress={() => onItemPress(item)}
      onCardFocus={() => handleCardFocus(index)}
      showTitle={true}
    />
  ), [onItemPress, handleCardFocus]);

  // Stable key extractor
  const keyExtractor = useCallback((item: ContentItem, index: number) => 
    item.id || item.imdb_id || `item-${index}`, []);

  // Display title
  const displayTitle = title || serviceName || 'Content';

  // Fixed item layout for zero-cost scrolling (no measuring needed)
  const getItemLayout = useCallback((_data: any, index: number) => ({
    length: itemWidth,
    offset: itemWidth * index,
    index,
  }), [itemWidth]);

  // Handle scroll failure
  const onScrollToIndexFailed = useCallback((info: {
    index: number;
    highestMeasuredFrameIndex: number;
  }) => {
    setTimeout(() => {
      flatListRef.current?.scrollToIndex({ 
        index: Math.min(info.index, info.highestMeasuredFrameIndex),
        animated: true 
      });
    }, 100);
  }, []);

  // Loading indicator at end of row
  const ListFooter = useCallback(() => {
    if (isLoadingMore) {
      return (
        <View style={styles.loadingFooter}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      );
    }
    return null;
  }, [isLoadingMore]);

  return (
    <View style={styles.container}>
      {/* Row Header - just title, no buttons */}
      <View style={[styles.header, isTV && styles.headerTV]}>
        <Text style={[styles.title, isTV && styles.titleTV]}>{displayTitle}</Text>
      </View>
      
      {/* Horizontal content row */}
      <FlatList
        ref={flatListRef}
        horizontal
        data={validItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, isTV && styles.scrollContentTV]}
        style={styles.flatListStyle}
        // HIGH values to prevent view recycling (prevents flicker)
        initialNumToRender={15}
        maxToRenderPerBatch={15}
        windowSize={51}
        // CRITICAL: prevent clipping-related flicker
        removeClippedSubviews={false}
        // Performance
        getItemLayout={getItemLayout}
        onScrollToIndexFailed={onScrollToIndexFailed}
        updateCellsBatchingPeriod={100}
        // Disable end-reached (we use focus-based loading instead)
        onEndReached={null}
        ListFooterComponent={ListFooter}
        ListFooterComponentStyle={styles.footerStyle}
      />
    </View>
  );
});

export const MetaRow = ServiceRow;

const styles = StyleSheet.create({
  container: {
    marginBottom: 32,
    overflow: 'visible',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  headerTV: {
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  titleTV: {
    fontSize: 22,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  scrollContentTV: {
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  flatListStyle: {
    overflow: 'visible',
  },
  loadingFooter: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 60,
    height: '100%',
  },
  footerStyle: {
    justifyContent: 'center',
    paddingLeft: 8,
  },
});
