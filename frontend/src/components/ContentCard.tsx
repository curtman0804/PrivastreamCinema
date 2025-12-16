import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { ContentItem, SearchResult } from '../api/client';

interface ContentCardProps {
  item: ContentItem | SearchResult;
  onPress: () => void;
  size?: 'small' | 'medium' | 'large';
  showRating?: boolean;
}

export const ContentCard: React.FC<ContentCardProps> = ({
  item,
  onPress,
  size = 'medium',
  showRating = true,
}) => {
  const { width } = useWindowDimensions();
  const baseWidth = Math.min(width, 500); // Cap max width for web
  const CARD_WIDTH = (baseWidth - 48) / 3;
  
  const cardWidth = size === 'small' ? CARD_WIDTH * 0.8 : size === 'large' ? CARD_WIDTH * 1.2 : CARD_WIDTH;
  const cardHeight = cardWidth * 1.5;

  const rating = typeof item.imdbRating === 'string' 
    ? parseFloat(item.imdbRating) 
    : item.imdbRating;

  return (
    <TouchableOpacity
      style={[styles.container, { width: cardWidth }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[styles.imageContainer, { height: cardHeight }]}>
        <Image
          source={{ uri: item.poster }}
          style={styles.image}
          contentFit="cover"
          transition={200}
        />
        {showRating && rating && rating > 0 && (
          <View style={styles.ratingBadge}>
            <Ionicons name="star" size={10} color="#FFD700" />
            <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
          </View>
        )}
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {item.name}
      </Text>
      {item.year && (
        <Text style={styles.year}>{item.year}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    marginRight: 12,
    marginBottom: 16,
  },
  imageContainer: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  ratingBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  ratingText: {
    color: '#FFD700',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 3,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 8,
    lineHeight: 18,
  },
  year: {
    color: '#888888',
    fontSize: 11,
    marginTop: 2,
  },
});
