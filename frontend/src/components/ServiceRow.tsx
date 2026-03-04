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
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;
  const flatListRef = useRef<FlatList>(null);

  // Items state
  const [allItems, setAllItems] = useState<ContentItem[]>(() => initialItems || []);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // ALL refs — never cause re-renders
  const skipRef = useRef(initialItems?.length || 0);
  const hasMoreRef = useRef(true);
  const isLoadingRef = useRef(false);
  const totalRef = useRef(initialItems?.length || 0);

  const validItems = useMemo(() => 
    (allItems || []).filter(Boolean), [allItems]);
  
  if (validItems.length === 0) return null;

  const cardWidth = useMemo(() => 
    getCardWidth(width, isTV, 'medium'), [width, isTV]);

  // Fetch next page — stable deps, no state in closure
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
          totalRef.current = updated.length;
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

  // STABLE focus handler — uses ONLY refs, never changes
  const handleCardFocus = useCallback((index: number) => {
    onSectionFocus?.();
    // Load more when within last 10 items (uses ref, not state)
    if (index >= totalRef.current - 10 && hasMoreRef.current && !isLoadingRef.current) {
      fetchMore();
    }
  }, [onSectionFocus, fetchMore]);

  // STABLE render function — handleCardFocus never changes, so this never changes
  // FlatList won't re-render existing items when new items are appended
  const renderItem = useCallback(({ item, index }: { item: ContentItem; index: number }) => (
    <ContentCard
      item={item}
      onPress={() => onItemPress(item)}
      onCardFocus={() => handleCardFocus(index)}
      showTitle={true}
      hasTVPreferredFocus={isFirstRow && index === 0}
    />
  ), [onItemPress, handleCardFocus, isFirstRow]);

  const keyExtractor = useCallback((item: ContentItem) => 
    item.id || item.imdb_id || `${item.name}`, []);

  // Backup trigger via scroll position
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
        maxToRenderPerBatch={5}
        windowSize={9}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews={false}
        onEndReached={handleEndReached}
        onEndReachedThreshold={3}
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
