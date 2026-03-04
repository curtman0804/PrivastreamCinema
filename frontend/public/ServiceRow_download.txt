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

// Card wrapper that handles focus - separated to prevent re-renders
const FocusableCard = memo(({ 
  item, 
  onPress, 
  onFocus,
}: { 
  item: ContentItem; 
  onPress: () => void;
  onFocus: () => void;
}) => (
  <ContentCard
    item={item}
    onPress={onPress}
    onCardFocus={onFocus}
    showTitle={true}
  />
), (prev, next) => {
  return prev.item?.id === next.item?.id && prev.item?.imdb_id === next.item?.imdb_id;
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

  // Items state
  const [allItems, setAllItems] = useState<ContentItem[]>(initialItems || []);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // ALL pagination tracking via refs (no re-renders)
  const skipRef = useRef(initialItems?.length || 0);
  const hasMoreRef = useRef(true);
  const isLoadingRef = useRef(false);
  const initializedRef = useRef(false);
  const itemCountRef = useRef(initialItems?.length || 0);

  // Initialize once
  useEffect(() => {
    if (!initializedRef.current && initialItems && initialItems.length > 0) {
      initializedRef.current = true;
      setAllItems(initialItems);
      skipRef.current = initialItems.length;
      itemCountRef.current = initialItems.length;
    }
  }, [initialItems]);

  const validItems = useMemo(() => 
    (allItems || []).filter(Boolean), [allItems]);
  
  if (validItems.length === 0) return null;

  const cardWidth = useMemo(() => 
    getCardWidth(width, isTV, 'medium'), [width, isTV]);
  const itemWidth = cardWidth + 16;

  // Fetch next page - uses ONLY refs, no state dependencies
  const fetchMore = useCallback(async () => {
    if (isLoadingRef.current || !hasMoreRef.current) return;
    isLoadingRef.current = true;
    setIsLoadingMore(true);
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
          itemCountRef.current = updated.length;
          return updated;
        });
        skipRef.current += newItems.length;
      }
      hasMoreRef.current = resp.data.hasMore !== undefined ? resp.data.hasMore : newItems.length >= 20;
    } catch {
      hasMoreRef.current = false;
    } finally {
      isLoadingRef.current = false;
      setIsLoadingMore(false);
    }
  }, [serviceName, contentType]);

  // STABLE focus handler - no changing deps
  const handleCardFocus = useCallback((index: number) => {
    onSectionFocus?.();
    
    // Scroll to focused card
    flatListRef.current?.scrollToIndex({
      index,
      animated: true,
      viewPosition: 0.1,
    });

    // Load more when near end (using ref, not state)
    if (index >= itemCountRef.current - 15 && hasMoreRef.current && !isLoadingRef.current) {
      fetchMore();
    }
  }, [onSectionFocus, fetchMore]);

  // STABLE press handler
  const handleItemPress = useCallback((item: ContentItem) => {
    onItemPress(item);
  }, [onItemPress]);

  // STABLE render function - deps don't change
  const renderItem = useCallback(({ item, index }: { item: ContentItem; index: number }) => (
    <FocusableCard
      item={item}
      onPress={() => handleItemPress(item)}
      onFocus={() => handleCardFocus(index)}
    />
  ), [handleItemPress, handleCardFocus]);

  const keyExtractor = useCallback((item: ContentItem, index: number) => 
    item.id || item.imdb_id || `item-${index}`, []);

  const getItemLayout = useCallback((_data: any, index: number) => ({
    length: itemWidth,
    offset: itemWidth * index,
    index,
  }), [itemWidth]);

  const onScrollToIndexFailed = useCallback((info: { index: number; highestMeasuredFrameIndex: number }) => {
    setTimeout(() => {
      flatListRef.current?.scrollToIndex({ 
        index: Math.min(info.index, info.highestMeasuredFrameIndex),
        animated: true 
      });
    }, 100);
  }, []);

  // Also use onEndReached as backup trigger
  const handleEndReached = useCallback(() => {
    if (!isLoadingRef.current && hasMoreRef.current) {
      fetchMore();
    }
  }, [fetchMore]);

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
      <View style={[styles.header, isTV && styles.headerTV]}>
        <Text style={[styles.title, isTV && styles.titleTV]}>
          {title || serviceName || 'Content'}
        </Text>
      </View>
      
      <FlatList
        ref={flatListRef}
        horizontal
        data={validItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, isTV && styles.scrollContentTV]}
        style={styles.flatListStyle}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={11}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews={false}
        getItemLayout={getItemLayout}
        onScrollToIndexFailed={onScrollToIndexFailed}
        onEndReached={handleEndReached}
        onEndReachedThreshold={5}
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
