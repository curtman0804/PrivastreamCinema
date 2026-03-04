import React, { memo, useState, useCallback, useRef, useMemo } from 'react';
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

  // Items state
  const [allItems, setAllItems] = useState<ContentItem[]>(() => initialItems || []);

  // Refs for controlled pagination
  const skipRef = useRef(initialItems?.length || 0);
  const hasMoreRef = useRef(true);
  const isFetchingRef = useRef(false);
  const lastFetchTime = useRef(0);
  const totalRef = useRef(initialItems?.length || 0);

  const validItems = useMemo(() => 
    (allItems || []).filter(Boolean), [allItems]);
  
  if (validItems.length === 0) return null;

  // Fetch more with cooldown - prevents runaway loop
  const fetchMore = useCallback(async () => {
    const now = Date.now();
    // Cooldown: at least 2 seconds between fetches
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
    onSectionFocus?.();
    // Pre-fetch when within last 15 items
    if (index >= totalRef.current - 15 && hasMoreRef.current) {
      fetchMore();
    }
  }, [onSectionFocus, fetchMore]);

  // End reached backup trigger
  const handleEndReached = useCallback(() => {
    if (!isFetchingRef.current && hasMoreRef.current) {
      fetchMore();
    }
  }, [fetchMore]);

  const renderItem = useCallback(({ item, index }: { item: ContentItem; index: number }) => (
    <ContentCard
      item={item}
      onPress={() => onItemPress(item)}
      onCardFocus={() => handleCardFocus(index)}
      showTitle={true}
      hasTVPreferredFocus={isFirstRow && index === 0}
      isFirstInRow={index === 0}
      isLastInRow={index === validItems.length - 1}
    />
  ), [onItemPress, handleCardFocus, isFirstRow, validItems.length]);

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
        removeClippedSubviews={false}
        onEndReached={handleEndReached}
        onEndReachedThreshold={3}
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
});
