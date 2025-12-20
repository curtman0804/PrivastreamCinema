import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
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
  showRating = false, // Default to false - cleaner look
}) => {
  const { width } = useWindowDimensions();
  const baseWidth = Math.min(width, 500); // Cap max width for web
  const CARD_WIDTH = (baseWidth - 48) / 3;
  const [imageError, setImageError] = useState(false);
  
  const cardWidth = size === 'small' ? CARD_WIDTH * 0.8 : size === 'large' ? CARD_WIDTH * 1.2 : CARD_WIDTH;
  const cardHeight = cardWidth * 1.5;

  // Guard against undefined/null item
  if (!item) {
    return null;
  }

  const hasValidPoster = item.poster && !imageError;

  return (
    <TouchableOpacity
      style={[styles.container, { width: cardWidth }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[styles.imageContainer, { height: cardHeight }]}>
        {hasValidPoster ? (
          <Image
            source={{ uri: item.poster }}
            style={styles.image}
            contentFit="cover"
            transition={200}
            onError={() => setImageError(true)}
          />
        ) : (
          <View style={styles.fallbackContainer}>
            <Text style={styles.fallbackTitle} numberOfLines={4}>
              {item.name || 'Unknown'}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    marginRight: 12,
    marginBottom: 8,
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
  fallbackContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 8,
    backgroundColor: '#2a2a2a',
  },
  fallbackTitle: {
    color: '#fff',
    fontSize: 11,
    textAlign: 'center',
    fontWeight: '500',
  },
});
