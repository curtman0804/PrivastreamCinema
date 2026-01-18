import React, { memo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ContentCard } from './ContentCard';
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

  // Calculate item width for getItemLayout - must match ContentCard
  const numCards = isTV ? 7 : 3;
  const horizontalPadding = isTV ? 48 : 32;
  const gapsBetweenCards = (numCards - 1) * 12;
  let cardWidth = isTV 
    ? Math.min((width - horizontalPadding - gapsBetweenCards) / numCards, 160)
    : ((Math.min(width, 500) - 48) / 3);
  const itemWidth = cardWidth + 12; // card width + marginRight

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <Text style={[styles.title, isTV && styles.titleTV]}>{serviceName}</Text>
        </View>
        {onSeeAll && (
          <TouchableOpacity 
            onPress={onSeeAll} 
            style={[
              styles.seeAllButton,
              seeAllFocused && styles.seeAllButtonFocused,
            ]}
            onFocus={() => setSeeAllFocused(true)}
            onBlur={() => setSeeAllFocused(false)}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.seeAllText,
              seeAllFocused && styles.seeAllTextFocused,
            ]}>See All</Text>
            <Ionicons 
              name="chevron-forward" 
              size={16} 
              color={seeAllFocused ? '#FFFFFF' : '#B8A05C'} 
            />
          </TouchableOpacity>
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
    borderWidth: 3,
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
