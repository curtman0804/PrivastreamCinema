import React, { memo, useState, useCallback } from 'react';
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
  
  // Filter out undefined/null items
  const validItems = (items || []).filter(Boolean);
  if (validItems.length === 0) return null;

  const renderItem = useCallback(({ item }: { item: ContentItem }) => (
    <MemoizedContentCard
      item={item}
      onPress={() => onItemPress(item)}
      showTitle={true}
    />
  ), [onItemPress]);

  const keyExtractor = useCallback((item: ContentItem, index: number) => 
    item.id || item.imdb_id || `item-${index}`, []);

  // Use shared card width calculation
  const cardWidth = getCardWidth(width, isTV, 'medium');
  const itemWidth = cardWidth + 16; // card width + marginRight

  // Display title - use serviceName or title
  const displayTitle = title || serviceName || 'Content';

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
        horizontal
        data={validItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, isTV && styles.scrollContentTV]}
        initialNumToRender={isTV ? 8 : 5}
        maxToRenderPerBatch={5}
        windowSize={5}
        removeClippedSubviews={false}
        snapToInterval={itemWidth}
        decelerationRate="fast"
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
