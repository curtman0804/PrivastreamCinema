import React, { memo } from 'react';
import {
  View,
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

// Fixed poster aspect ratio (standard movie poster is 2:3)
const POSTER_ASPECT_RATIO = 1.5;

const ContentCardComponent: React.FC<ContentCardProps> = ({
  item,
  onPress,
  size = 'medium',
  showRating = false,
}) => {
  const { width, height } = useWindowDimensions();
  
  // Responsive breakpoints
  const isTV = width > 1000;
  const isTablet = width > 600 && width <= 1000;
  
  // Calculate number of columns based on screen size
  const getNumColumns = () => {
    if (isTV) return size === 'small' ? 10 : size === 'large' ? 6 : 8;
    if (isTablet) return size === 'small' ? 6 : size === 'large' ? 4 : 5;
    return size === 'small' ? 4 : size === 'large' ? 2 : 3;
  };
  
  const numColumns = getNumColumns();
  const horizontalPadding = isTV ? 48 : isTablet ? 32 : 16;
  const gap = isTV ? 12 : 10;
  
  // Calculate card width based on screen width
  const cardWidth = (width - (horizontalPadding * 2) - (gap * (numColumns + 1))) / numColumns;
  const cardHeight = cardWidth * POSTER_ASPECT_RATIO;

  if (!item) {
    return null;
  }

  return (
    <TouchableOpacity
      style={[styles.container, { width: cardWidth, marginRight: gap, marginBottom: gap }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={item.name || item.title || 'Content'}
    >
      <View style={[styles.imageContainer, { height: cardHeight }]}>
        <Image
          source={{ uri: item.poster }}
          style={styles.image}
          contentFit="cover"
          transition={100}
          recyclingKey={item.id || item.imdb_id}
          cachePolicy="memory-disk"
        />
      </View>
    </TouchableOpacity>
  );
};

export const ContentCard = memo(ContentCardComponent);

const styles = StyleSheet.create({
  container: {
  },
  imageContainer: {
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});