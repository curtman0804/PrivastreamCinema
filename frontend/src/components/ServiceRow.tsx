import React, { memo, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  useWindowDimensions,
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
const MemoizedContentCard = memo(ContentCard);

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
  
  // Filter out undefined/null items
  const validItems = (items || []).filter(Boolean);
  if (validItems.length === 0) return null;

  // Use shared card width calculation
  const cardWidth = getCardWidth(width, isTV, 'medium');
  const itemWidth = cardWidth + 16; // card width + marginRight

  // Handle card focus - scroll to keep focused item visible
  const handleCardFocus = useCallback((index: number) => {
    setCurrentFocusIndex(index);
    
    // Calculate how many items fit on screen
    const horizontalPadding = isTV ? 48 : 32; // paddingHorizontal * 2
    const visibleWidth = width - horizontalPadding;
    const itemsPerScreen = Math.floor(visibleWidth / itemWidth);
    
    // Scroll so focused item is visible (not at the edge)
    // Keep focused item at position 1 or 2 from left when possible
    const targetPosition = Math.max(0, index - 1);
    
    flatListRef.current?.scrollToIndex({
      index: targetPosition,
      animated: true,
      viewPosition: 0, // Align to start
    });
  }, [isTV, width, itemWidth]);

  const renderItem = useCallback(({ item, index }: { item: ContentItem; index: number }) => (
    <MemoizedContentCard
      item={item}
      onPress={() => onItemPress(item)}
      onCardFocus={() => handleCardFocus(index)}
      showTitle={true}
    />
  ), [onItemPress, handleCardFocus]);

  const keyExtractor = useCallback((item: ContentItem, index: number) => 
    item.id || item.imdb_id || `item-${index}`, []);

  // Display title - use serviceName or title
  const displayTitle = title || serviceName || 'Content';

  // Handle scroll failure gracefully
  const onScrollToIndexFailed = useCallback((info: {
    index: number;
    highestMeasuredFrameIndex: number;
    averageItemLength: number;
  }) => {
    // Scroll to the closest available item
    const wait = new Promise(resolve => setTimeout(resolve, 100));
    wait.then(() => {
      flatListRef.current?.scrollToIndex({ 
        index: Math.min(info.index, info.highestMeasuredFrameIndex),
        animated: true 
      });
    });
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
      
      {/* Content Row */}
      <FlatList
        ref={flatListRef}
        horizontal
        data={validItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, isTV && styles.scrollContentTV]}
        style={styles.flatListStyle}
        initialNumToRender={isTV ? 8 : 5}
        maxToRenderPerBatch={5}
        windowSize={7}
        removeClippedSubviews={false}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScrollToIndexFailed={onScrollToIndexFailed}
        getItemLayout={(data, index) => ({
          length: itemWidth,
          offset: itemWidth * index,
          index,
        })}
      />
    </View>
  );
});

// Also export with serviceName prop for backwards compatibility
export const MetaRow = ServiceRow;

const styles = StyleSheet.create({
  container: {
    marginBottom: 32,
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
  },
  scrollContentTV: {
    paddingHorizontal: 24,
  },
});
