import React, { memo, useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  useWindowDimensions,
  Platform,
  Text,
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
  let cardWidth: number;
  if (isTV) {
    // TV mode: show more cards, appropriate size for 10-foot UI
    const numCards = size === 'small' ? 7 : size === 'large' ? 4 : 5;
    cardWidth = Math.min((width - 100) / numCards, 180);
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
    <Pressable
      style={[
        styles.container, 
        { width: cardWidth },
        isFocused && styles.focused,
      ]}
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
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
        {/* Gold focus border overlay */}
        {isFocused && (
          <View style={styles.focusBorder} />
        )}
      </View>
      {/* Optional: Show title on TV when focused */}
      {isTV && isFocused && (item.name || item.title) && (
        <Text style={styles.focusedTitle} numberOfLines={2}>
          {item.name || item.title}
        </Text>
      )}
    </Pressable>
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
    borderColor: '#FFD700',
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 15,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  focusBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 4,
    borderColor: '#FFD700',
    borderRadius: 5,
  },
  focusedTitle: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 2,
  },
});
