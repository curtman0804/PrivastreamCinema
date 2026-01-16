import React, { memo, useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  Platform,
  findNodeHandle,
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
  const [isFocused, setIsFocused] = useState(false);
  const buttonRef = useRef<TouchableOpacity>(null);
  
  // Detect TV/landscape mode
  const isTV = width > height;
  
  // Calculate card width based on screen size and mode
  let cardWidth: number;
  if (isTV) {
    // TV mode: show more cards, smaller size
    const numCards = size === 'small' ? 8 : size === 'large' ? 5 : 6;
    cardWidth = (width - 80) / numCards;
  } else {
    // Mobile mode
    const baseWidth = Math.min(width, 500);
    const CARD_WIDTH = (baseWidth - 48) / 3;
    cardWidth = size === 'small' ? CARD_WIDTH * 0.8 : size === 'large' ? CARD_WIDTH * 1.2 : CARD_WIDTH;
  }
  
  // Fixed height based on aspect ratio
  const cardHeight = cardWidth * POSTER_ASPECT_RATIO;

  if (!item) {
    return null;
  }

  return (
    <TouchableOpacity
      ref={buttonRef}
      style={[
        styles.container, 
        { width: cardWidth },
        isFocused && styles.focused,
      ]}
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      activeOpacity={0.8}
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
        {isFocused && <View style={styles.focusOverlay} />}
      </View>
    </TouchableOpacity>
  );
};

export const ContentCard = memo(ContentCardComponent);

const styles = StyleSheet.create({
  container: {
    marginRight: 12,
    marginBottom: 8,
  },
  focused: {
    transform: [{ scale: 1.1 }],
    zIndex: 10,
  },
  imageContainer: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    borderWidth: 3,
    borderColor: 'transparent',
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
    backgroundColor: 'rgba(184, 160, 92, 0.2)',
  },
});
