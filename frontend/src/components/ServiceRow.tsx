import React, { memo } from 'react';
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
  
  // Responsive breakpoints
  const isTV = width > 1000;
  const isTablet = width > 600 && width <= 1000;
  
  const horizontalPadding = isTV ? 48 : isTablet ? 32 : 16;
  const gap = isTV ? 12 : 10;
  
  // Calculate number of columns
  const numColumns = isTV ? 8 : isTablet ? 5 : 3;
  const itemWidth = (width - (horizontalPadding * 2) - (gap * (numColumns + 1))) / numColumns + gap;
  
  // Filter out undefined/null items
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
            style={styles.seeAllButton}
            activeOpacity={0.7}
          >
            <Text style={styles.seeAllText}>See All</Text>
            <Ionicons name="chevron-forward" size={16} color="#B8A05C" />
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        horizontal
        data={validItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: horizontalPadding }}
        initialNumToRender={isTV ? 10 : 5}
        maxToRenderPerBatch={5}
        windowSize={5}
        removeClippedSubviews={true}
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
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
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
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  seeAllText: {
    color: '#B8A05C',
    fontSize: 14,
    fontWeight: '500',
  },
});