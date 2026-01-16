import React, { memo, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { ContentItem, SearchResult } from '../api/client';

interface ContentCardProps {
  item: ContentItem | SearchResult;
  onPress: () => void;
  size?: 'small' | 'medium' | 'large';
  showRating?: boolean;
}

const ContentCardComponent: React.FC<ContentCardProps> = ({
  item,
  onPress,
  size = 'medium',
  showRating = false, // Default to false - cleaner look
}) => {
  const { width } = useWindowDimensions();
  const [isFocused, setIsFocused] = useState(false);
  const baseWidth = Math.min(width, 500); // Cap max width for web
  const CARD_WIDTH = (baseWidth - 48) / 3;
  
  const cardWidth = size === 'small' ? CARD_WIDTH * 0.8 : size === 'large' ? CARD_WIDTH * 1.2 : CARD_WIDTH;
  const cardHeight = cardWidth * 1.5;

  // Guard against undefined/null item
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
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      activeOpacity={0.8}
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
    marginRight: 12,
    marginBottom: 8,
  },
  focused: {
    borderWidth: 3,
    borderColor: '#B8A05C',
    borderRadius: 10,
    transform: [{ scale: 1.08 }],
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
});
