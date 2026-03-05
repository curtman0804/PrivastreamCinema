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

  // Pre-compute card dimensions once — used for getItemLayout
  const cardWidth = getCardWidth(width, isTV, 'medium');
  const itemTotalWidth = cardWidth + ITEM_GAP;

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

  // Fetch more with cooldown
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

  // Card focus handler — no deps on item count
  const handleCardFocus = useCallback((index: number) => {
    onSectionFocus?.();
    if (index >= totalRef.current - 15 && hasMoreRef.current) {
      fetchMore();
    }
  }, [onSectionFocus, fetchMore]);

  const handleEndReached = useCallback(() => {
    if (!isFetchingRef.current && hasMoreRef.current) {
      fetchMore();
    }
  }, [fetchMore]);

  // CRITICAL: getItemLayout lets FlatList instantly calculate scroll positions
  // without measuring each item. This is the #1 fix for navigation speed.
  const paddingLeft = isTV ? TV_PADDING_LEFT : MOBILE_PADDING;
  const getItemLayout = useCallback((_data: any, index: number) => ({
    length: itemTotalWidth,
    offset: paddingLeft + (index * itemTotalWidth),
    index,
  }), [itemTotalWidth, paddingLeft]);

  // renderItem — NO validItems.length in deps (was breaking memoization)
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
    paddingHorizontal: TV_PADDING_LEFT,
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
    paddingLeft: MOBILE_PADDING,
    paddingRight: MOBILE_PADDING + 32,
    paddingVertical: 12,
  },
  scrollContentTV: {
    paddingLeft: TV_PADDING_LEFT,
    paddingRight: TV_PADDING_RIGHT + 60,
    paddingVertical: 16,
  },
  flatListStyle: {
    overflow: 'visible',
  },
});
