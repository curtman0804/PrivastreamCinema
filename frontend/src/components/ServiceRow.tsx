import React, { memo, useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
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

// Memoized card - won't re-render unless item data changes
const MemoCard = memo(({ 
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
), (prev, next) => prev.item?.id === next.item?.id && prev.item?.imdb_id === next.item?.imdb_id);

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

  // Items state
  const [allItems, setAllItems] = useState<ContentItem[]>(initialItems || []);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Pagination refs only (no re-renders)
  const skipRef = useRef(initialItems?.length || 0);
  const hasMoreRef = useRef(true);
  const isLoadingRef = useRef(false);
  const initializedRef = useRef(false);
  const totalRef = useRef(initialItems?.length || 0);

  // Initialize once
  useEffect(() => {
    if (!initializedRef.current && initialItems && initialItems.length > 0) {
      initializedRef.current = true;
      setAllItems(initialItems);
      skipRef.current = initialItems.length;
      totalRef.current = initialItems.length;
    }
  }, [initialItems]);

  const validItems = useMemo(() => 
    (allItems || []).filter(Boolean), [allItems]);
  
  if (validItems.length === 0) return null;

  // Fetch next page
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

  // When a card gets focus
  const handleCardFocus = useCallback((index: number) => {
    onSectionFocus?.();
    // Load more when within last 20 items
    if (index >= totalRef.current - 20 && hasMoreRef.current && !isLoadingRef.current) {
      fetchMore();
    }
  }, [onSectionFocus, fetchMore]);

  const displayTitle = title || serviceName || 'Content';

  return (
    <View style={styles.container}>
      <View style={[styles.header, isTV && styles.headerTV]}>
        <Text style={[styles.title, isTV && styles.titleTV]}>{displayTitle}</Text>
      </View>
      
      {/* ScrollView instead of FlatList - NO view recycling = NO flicker */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, isTV && styles.scrollContentTV]}
        style={styles.scrollStyle}
      >
        {validItems.map((item, index) => (
          <MemoCard
            key={item.id || item.imdb_id || `${index}`}
            item={item}
            onPress={() => onItemPress(item)}
            onFocus={() => handleCardFocus(index)}
          />
        ))}
        {isLoadingMore && (
          <View style={styles.loadingFooter}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        )}
      </ScrollView>
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
  scrollStyle: {
    overflow: 'visible',
  },
  loadingFooter: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 60,
    paddingLeft: 8,
  },
});
