import React, { memo, useState, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  Platform,
  Text,
  TVFocusGuideView,
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
  
  // Detect TV/landscape mode
  const isTV = width > height || width > 800;
  
  // Calculate card width based on screen size and mode
  // Show 7 cards on TV for a Stremio-like layout
  let cardWidth: number;
  if (isTV) {
    const numCards = 7;
    const horizontalPadding = 48; // 24px padding on each side
    const gapsBetweenCards = (numCards - 1) * 12; // 12px gap between cards
    cardWidth = (width - horizontalPadding - gapsBetweenCards) / numCards;
    // Cap the max width
    cardWidth = Math.min(cardWidth, 160);
  } else {
    // Mobile mode
    const baseWidth = Math.min(width, 500);
    const CARD_WIDTH = (baseWidth - 48) / 3;
    cardWidth = size === 'small' ? CARD_WIDTH * 0.8 : size === 'large' ? CARD_WIDTH * 1.2 : CARD_WIDTH;
  }
  
  // Fixed height based on aspect ratio
  const cardHeight = cardWidth * POSTER_ASPECT_RATIO;

  const handleFocus = useCallback(() => {
    setIsFocused(true);
  }, []);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
  }, []);

  if (!item) {
    return null;
  }

  return (
    <TouchableOpacity
      style={[
        styles.container, 
        { width: cardWidth },
        isFocused && styles.focused,
      ]}
      onPress={onPress}
      onFocus={handleFocus}
      onBlur={handleBlur}
      activeOpacity={0.8}
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
        {/* Visible focus indicator - always rendered but only visible when focused */}
        <View style={[
          styles.focusIndicator,
          isFocused && styles.focusIndicatorVisible,
        ]} />
      </View>
      {/* Show title on TV when focused */}
      {isTV && isFocused && (item.name || item.title) && (
        <Text style={styles.focusedTitle} numberOfLines={2}>
          {item.name || item.title}
        </Text>
      )}
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
    transform: [{ scale: 1.08 }],
    zIndex: 100,
  },
  imageContainer: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  imageContainerFocused: {
    // Shadow for depth
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
    elevation: 20,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  focusIndicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 4,
    borderColor: 'transparent',
    borderRadius: 8,
  },
  focusIndicatorVisible: {
    borderColor: '#FFD700',
  },
  focusedTitle: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 2,
  },
});
