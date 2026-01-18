import React, { memo, useState, useRef } from 'react';
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

const MemoizedContentCard = memo(ContentCard);

export const ServiceRow: React.FC<ServiceRowProps> = memo(({
  serviceName,
  items,
  onItemPress,
  onSeeAll,
}) => {
  const { width, height } = useWindowDimensions();
  const [seeAllFocused, setSeeAllFocused] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  
  // Better TV detection
  const isLandscape = width > height;
  const isTV = isLandscape || width > 800;
  const isTablet = !isTV && width > 600;
  
  const horizontalPadding = isTV ? 40 : isTablet ? 32 : 16;
  const gap = isTV ? 14 : 10;
  
  // 7 posters per row on TV
  const numColumns = isTV ? 7 : isTablet ? 5 : 3;
  const itemWidth = (width - (horizontalPadding * 2) - (gap * (numColumns - 1))) / numColumns;
  const snapInterval = itemWidth + gap;
  
  const validItems = (items || []).filter(Boolean);
  if (validItems.length === 0) return null;

  const renderItem = ({ item }: { item: ContentItem }) => (
    <MemoizedContentCard
      item={item}
      onPress={() => onItemPress(item)}
    />
  );

  const keyExtractor = (item: ContentItem, index: number) => 
    item.id || item.imdb_id || `item-${index}`;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingHorizontal: horizontalPadding }]}>
        <View style={styles.titleContainer}>
          <Text style={[styles.title, isTV && styles.titleTV, isTablet && styles.titleTablet]}>
            {serviceName}
          </Text>
        </View>
        {onSeeAll && (
          <TouchableOpacity 
            onPress={onSeeAll} 
            onFocus={() => setSeeAllFocused(true)}
            onBlur={() => setSeeAllFocused(false)}
            style={[
              styles.seeAllButton,
              seeAllFocused && styles.seeAllButtonFocused,
            ]}
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
        ref={flatListRef}
        horizontal
        data={validItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: horizontalPadding }}
        snapToInterval={snapInterval}
        snapToAlignment="start"
        decelerationRate="fast"
        initialNumToRender={numColumns + 2}
        maxToRenderPerBatch={numColumns}
        windowSize={3}
        removeClippedSubviews={true}
        getItemLayout={(data, index) => ({
          length: snapInterval,
          offset: snapInterval * index,
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
    marginBottom: 12,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  titleTV: {
    fontSize: 20,
  },
  titleTablet: {
    fontSize: 18,
  },
  seeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  seeAllButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.2)',
  },
  seeAllText: {
    color: '#B8A05C',
    fontSize: 14,
    fontWeight: '500',
  },
  seeAllTextFocused: {
    color: '#FFFFFF',
  },
});