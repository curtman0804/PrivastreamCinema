import React, { useCallback, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
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
  // Filter out undefined/null items and limit to 30 for performance
  const validItems = (items || []).filter(Boolean).slice(0, 30);
  if (validItems.length === 0) return null;

  const renderItem = useCallback(({ item }: { item: ContentItem }) => (
    <MemoizedContentCard
      item={item}
      onPress={() => onItemPress(item)}
    />
  ), [onItemPress]);

  const keyExtractor = useCallback((item: ContentItem, index: number) => 
    item.id || item.imdb_id || `${serviceName}-${index}`, [serviceName]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <Text style={styles.title}>{serviceName}</Text>
        </View>
        {onSeeAll && (
          <TouchableOpacity onPress={onSeeAll} style={styles.seeAllButton}>
            <Text style={styles.seeAllText}>See All</Text>
            <Ionicons name="chevron-forward" size={16} color="#B8A05C" />
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={validItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        windowSize={5}
        removeClippedSubviews={true}
        getItemLayout={(data, index) => ({
          length: 120,
          offset: 120 * index,
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
  seeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  seeAllText: {
    color: '#B8A05C',
    fontSize: 14,
    fontWeight: '500',
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
});
