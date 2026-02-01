import React, { memo, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ContentCard, getCardWidth } from './ContentCard';
import { ContentItem } from '../api/client';
import { colors } from '../styles/colors';

interface ServiceRowProps {
  title: string;
  serviceName?: string;
  items: ContentItem[];
  onItemPress: (item: ContentItem) => void;
  onSeeAll?: () => void;
}

// Memoized content card to prevent re-renders
const MemoizedContentCard = memo(ContentCard, (prev, next) => {
  // Only re-render if item id changes
  return prev.item?.id === next.item?.id && 
         prev.item?.imdb_id === next.item?.imdb_id;
});

export const ServiceRow: React.FC<ServiceRowProps> = memo(({
  title,
  serviceName,
  items,
  onItemPress,
  onSeeAll,
}) => {
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;
  const [seeAllFocused, setSeeAllFocused] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const [currentFocusIndex, setCurrentFocusIndex] = useState(0);
  
  // Memoize valid items to prevent recalculation
  const validItems = useMemo(() => 
    (items || []).filter(Boolean), [items]);
  
  if (validItems.length === 0) return null;

  // Use shared card width calculation - memoized
  const cardWidth = useMemo(() => 
    getCardWidth(width, isTV, 'medium'), [width, isTV]);
  const itemWidth = cardWidth + 16; // card width + marginRight

  // Handle card focus - scroll to keep focused item visible
  const handleCardFocus = useCallback((index: number) => {
    setCurrentFocusIndex(index);
    
    // Scroll so focused item is visible (not at the edge)
    const targetPosition = Math.max(0, index - 1);
    
    flatListRef.current?.scrollToIndex({
      index: targetPosition,
      animated: true,
      viewPosition: 0,
    });
  }, []);

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

  // Display title - use serviceName or title
  const displayTitle = title || serviceName || 'Content';

  // Memoized getItemLayout for performance
  const getItemLayout = useCallback((data: any, index: number) => ({
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

  return (
    <View style={styles.container}>
      {/* Row Header - Stremio style */}
      <View style={[styles.header, isTV && styles.headerTV]}>
        <Text style={[styles.title, isTV && styles.titleTV]}>{displayTitle}</Text>
        {onSeeAll && (
          <Pressable 
            onPress={onSeeAll} 
            onFocus={() => setSeeAllFocused(true)}
            onBlur={() => setSeeAllFocused(false)}
            style={({ focused }) => [
              styles.seeAllButton,
              (focused || seeAllFocused) && styles.seeAllButtonFocused,
            ]}
          >
            <Text style={[
              styles.seeAllText,
              (seeAllFocused) && styles.seeAllTextFocused,
            ]}>SEE ALL</Text>
            <Ionicons 
              name="chevron-forward" 
              size={16} 
              color={seeAllFocused ? colors.textPrimary : colors.textSecondary} 
            />
          </Pressable>
        )}
      </View>
      
      {/* Content Row - Optimized FlatList */}
      <FlatList
        ref={flatListRef}
        horizontal
        data={validItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, isTV && styles.scrollContentTV]}
        style={styles.flatListStyle}
        // Performance optimizations
        initialNumToRender={isTV ? 7 : 4}
        maxToRenderPerBatch={3}
        updateCellsBatchingPeriod={30}
        windowSize={5}
        removeClippedSubviews={Platform.OS === 'android'}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScrollToIndexFailed={onScrollToIndexFailed}
        getItemLayout={getItemLayout}
        // Disable automatic scroll adjustments
        maintainVisibleContentPosition={null}
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
  seeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 4,
  },
  seeAllButtonFocused: {
    backgroundColor: colors.primary,
  },
  seeAllText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    marginRight: 4,
  },
  seeAllTextFocused: {
    color: colors.textPrimary,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 12, // Add vertical padding to prevent clipping of focused items
  },
  scrollContentTV: {
    paddingHorizontal: 24,
    paddingVertical: 16, // More padding on TV
  },
  flatListStyle: {
    overflow: 'visible', // Allow focused items to show outside bounds
  },
});
