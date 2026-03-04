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

  // Simple items state - starts with initial, can grow once
  const [allItems, setAllItems] = useState<ContentItem[]>(() => initialItems || []);

  // Simple fetch tracking
  const hasFetchedMore = useRef(false);
  const isFetching = useRef(false);

  const validItems = useMemo(() => 
    (allItems || []).filter(Boolean), [allItems]);
  
  if (validItems.length === 0) return null;

  // Fetch ONE extra batch when user gets near end - no loop
  const fetchMoreOnce = useCallback(async () => {
    if (hasFetchedMore.current || isFetching.current) return;
    isFetching.current = true;
    try {
      const skip = allItems.length;
      const resp = await apiClient.get(
        `/api/content/category/${encodeURIComponent(serviceName)}/${contentType}?skip=${skip}&limit=100`
      );
      const newItems: ContentItem[] = resp.data.items || [];
      if (newItems.length > 0) {
        setAllItems(prev => {
          const ids = new Set(prev.map(i => i.id || i.imdb_id));
          const unique = newItems.filter(i => !ids.has(i.id || i.imdb_id));
          return [...prev, ...unique];
        });
      }
      hasFetchedMore.current = true;
    } catch {
      hasFetchedMore.current = true;
    } finally {
      isFetching.current = false;
    }
  }, [serviceName, contentType, allItems.length]);

  // Card focus - simple, stable
  const handleCardFocus = useCallback((index: number) => {
    onSectionFocus?.();
    // Fetch more when within last 10 items (only fires once)
    if (index >= allItems.length - 10) {
      fetchMoreOnce();
    }
  }, [onSectionFocus, allItems.length, fetchMoreOnce]);

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
