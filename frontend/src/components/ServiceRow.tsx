import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
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

const serviceIcons: { [key: string]: string } = {
  'Netflix': 'logo-youtube',
  'HBO Max': 'film-outline',
  'Disney+': 'star-outline',
  'Prime Video': 'play-circle-outline',
  'Hulu': 'tv-outline',
  'Paramount+': 'videocam-outline',
  'Apple TV+': 'logo-apple',
  'Peacock': 'leaf-outline',
  'Discovery+': 'globe-outline',
};

const serviceColors: { [key: string]: string } = {
  'Netflix': '#E50914',
  'HBO Max': '#B19CD9',
  'Disney+': '#113CCF',
  'Prime Video': '#00A8E1',
  'Hulu': '#1CE783',
  'Paramount+': '#0064FF',
  'Apple TV+': '#000000',
  'Peacock': '#FFD700',
  'Discovery+': '#003087',
};

export const ServiceRow: React.FC<ServiceRowProps> = ({
  serviceName,
  items,
  onItemPress,
  onSeeAll,
}) => {
  // Filter out undefined/null items
  const validItems = (items || []).filter(Boolean);
  if (validItems.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <Text style={styles.title}>{serviceName}</Text>
        </View>
        {onSeeAll && (
          <TouchableOpacity onPress={onSeeAll} style={styles.seeAllButton}>
            <Text style={styles.seeAllText}>See All</Text>
            <Ionicons name="chevron-forward" size={16} color="#8B5CF6" />
          </TouchableOpacity>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {validItems.slice(0, 10).map((item, index) => (
          <ContentCard
            key={item.id || item.imdb_id || index}
            item={item}
            onPress={() => onItemPress(item)}
          />
        ))}
      </ScrollView>
    </View>
  );
};

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
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
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
    color: '#8B5CF6',
    fontSize: 14,
    fontWeight: '500',
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
});
