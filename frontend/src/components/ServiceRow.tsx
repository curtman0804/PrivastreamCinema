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

// Memoized content card to prevent re-renders
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
  const currentFocusIndexRef = useRef(0);

  // Internal state for loaded items - starts with initial items from discover
  const [allItems, setAllItems] = useState<ContentItem[]>(initialItems || []);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Pagination refs
  const skipRef = useRef(initialItems?.length || 0);
  const hasMoreRef = useRef(true);
  const isLoadingRef = useRef(false);
  const initializedRef = useRef(false);

  // Only set initial items once on mount - don't reset on every parent re-render
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

  // Fetch more items from the backend
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

  // Handle card focus - scroll to keep focused item visible + notify parent
  const handleCardFocus = useCallback((index: number) => {
    currentFocusIndexRef.current = index;
    
    if (onSectionFocus) {
      onSectionFocus();
    }
    
    flatListRef.current?.scrollToIndex({
      index: index,
      animated: true,
      viewPosition: 0.05,
    });
  }, [onSectionFocus]);

  // Memoized render item function
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

  // Memoized getItemLayout for performance
  const getItemLayout = useCallback((_data: any, index: number) => ({
    length: itemWidth,
    offset: itemWidth * index,
    index,
  }), [itemWidth]);

  // Handle scroll failure gracefully
  const onScrollToIndexFailed = useCallback((info: {
    index: number;
    highestMeasuredFrameIndex: number;
    averageItemLength: number;
  }) => {
    setTimeout(() => {
      flatListRef.current?.scrollToIndex({ 
        index: Math.min(info.index, info.highestMeasuredFrameIndex),
        animated: true 
      });
    }, 50);
  }, []);

  // Trigger load more when reaching end
  const handleEndReached = useCallback(() => {
    if (!isLoadingRef.current && hasMoreRef.current) {
      fetchMore();
    }
  }, [fetchMore]);

  // Loading indicator at the end of the row
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
      {/* Row Header */}
      <View style={[styles.header, isTV && styles.headerTV]}>
        <Text style={[styles.title, isTV && styles.titleTV]}>{displayTitle}</Text>
      </View>
      
      {/* Content Row - Infinite horizontal scroll */}
      <FlatList
        ref={flatListRef}
        horizontal
        data={validItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, isTV && styles.scrollContentTV]}
        style={styles.flatListStyle}
        initialNumToRender={isTV ? 10 : 5}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        windowSize={11}
        removeClippedSubviews={false}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScrollToIndexFailed={onScrollToIndexFailed}
        getItemLayout={getItemLayout}
        maintainVisibleContentPosition={null}
        onEndReached={handleEndReached}
        onEndReachedThreshold={3}
        ListFooterComponent={ListFooter}
        ListFooterComponentStyle={styles.footerStyle}
      />
    </View>
  );
});

// Also export with serviceName prop for backwards compatibility
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
