import React, { memo, useState } from 'react';
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

const POSTER_ASPECT_RATIO = 1.5;

const ContentCardComponent: React.FC<ContentCardProps> = ({
  item,
  onPress,
  size = 'medium',
  showRating = false,
}) => {
  const { width, height } = useWindowDimensions();
  const [isFocused, setIsFocused] = useState(false);
  
  // Better TV detection - landscape orientation OR wide screen
  const isLandscape = width > height;
  const isTV = isLandscape || width > 800;
  const isTablet = !isTV && width > 600;
  
  // More posters per row on TV (7 like Stremio)
  const getNumColumns = () => {
    if (isTV) return 7;
    if (isTablet) return 5;
    return 3;
  };
  
  const numColumns = getNumColumns();
  const horizontalPadding = isTV ? 40 : isTablet ? 32 : 16;
  const gap = isTV ? 14 : 10;
  
  const cardWidth = (width - (horizontalPadding * 2) - (gap * (numColumns - 1))) / numColumns;
  const cardHeight = cardWidth * POSTER_ASPECT_RATIO;

  if (!item) {
    return null;
  }

  return (
    <TouchableOpacity
      style={[
        styles.container, 
        { width: cardWidth, marginRight: gap, marginBottom: gap },
        isFocused && styles.containerFocused,
      ]}
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      activeOpacity={0.9}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={item.name || item.title || 'Content'}
    >
      <View style={[
        styles.imageContainer, 
        { height: cardHeight },
        isFocused && styles.imageContainerFocused,
      ]}>
        <Image
          source={{ uri: item.poster }}
          style={styles.image}
          contentFit="cover"
          transition={100}
          recyclingKey={item.id || item.imdb_id}
          cachePolicy="memory-disk"
        />
        {isFocused && <View style={styles.focusOverlay} />}
      </View>
    </TouchableOpacity>
  );
};

export const ContentCard = memo(ContentCardComponent);

const styles = StyleSheet.create({
  container: {
  },
  containerFocused: {
    transform: [{ scale: 1.08 }],
    zIndex: 100,
  },
  imageContainer: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  imageContainerFocused: {
    borderColor: '#B8A05C',
    borderWidth: 4,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  focusOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 4,
    borderColor: '#B8A05C',
    borderRadius: 5,
  },
});