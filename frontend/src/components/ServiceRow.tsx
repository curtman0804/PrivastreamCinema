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

interface ServiceRowProps {
  serviceName: string;
  items: ContentItem[];
  onItemPress: (item: ContentItem) => void;
  onSeeAll?: () => void;
}

// Memoized content card to prevent re-renders
const MemoizedContentCard = memo(ContentCard);

export const ServiceRow: React.FC<ServiceRowProps> = memo(({
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
    />
  ), [onItemPress]);

  const keyExtractor = useCallback((item: ContentItem, index: number) => 
    item.id || item.imdb_id || `item-${index}`, []);

  // Use shared card width calculation
  const cardWidth = getCardWidth(width, isTV, 'medium');
  const itemWidth = cardWidth + 12; // card width + marginRight

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <Text style={[styles.title, isTV && styles.titleTV]}>{serviceName}</Text>
        </View>
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
            {({ focused }) => (
              <>
                <Text style={[
                  styles.seeAllText,
                  (focused || seeAllFocused) && styles.seeAllTextFocused,
                ]}>See All</Text>
                <Ionicons 
                  name="chevron-forward" 
                  size={16} 
                  color={(focused || seeAllFocused) ? '#FFFFFF' : '#B8A05C'} 
                />
              </>
            )}
          </Pressable>
        )}
      </View>
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

const styles = StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  titleTV: {
    fontSize: 20,
  },
  seeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 4,
    borderColor: 'transparent',
  },
  seeAllButtonFocused: {
    borderColor: '#FFD700',
    backgroundColor: '#B8A05C',
  },
  seeAllText: {
    color: '#B8A05C',
    fontSize: 14,
    fontWeight: '500',
  },
  seeAllTextFocused: {
    color: '#FFFFFF',
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  scrollContentTV: {
    paddingHorizontal: 24,
  },
});
