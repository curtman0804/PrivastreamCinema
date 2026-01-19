import React, { memo, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  useWindowDimensions,
  Text,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { ContentItem, SearchResult, api } from '../api/client';

interface ContentCardProps {
  item: ContentItem | SearchResult;
  onPress: () => void;
  size?: 'small' | 'medium' | 'large';
  showRating?: boolean;
  inLibrary?: boolean;
  onLibraryChange?: () => void;
}

const POSTER_ASPECT_RATIO = 1.5;

export const getCardWidth = (screenWidth: number, isTV: boolean, size: string = 'medium') => {
  if (isTV) {
    const numCards = 7;
    const horizontalPadding = 48;
    const gapsBetweenCards = (numCards - 1) * 12;
    let cardWidth = (screenWidth - horizontalPadding - gapsBetweenCards) / numCards;
    return Math.min(cardWidth, 160);
  } else {
    const baseWidth = Math.min(screenWidth, 500);
    const CARD_WIDTH = (baseWidth - 48) / 3;
    return size === 'small' ? CARD_WIDTH * 0.8 : size === 'large' ? CARD_WIDTH * 1.2 : CARD_WIDTH;
  }
};

const ContentCardComponent: React.FC<ContentCardProps> = ({
  item,
  onPress,
  size = 'medium',
  showRating = false,
  inLibrary = false,
  onLibraryChange,
}) => {
  const { width, height } = useWindowDimensions();
  const [isFocused, setIsFocused] = useState(false);
  const [isInLibrary, setIsInLibrary] = useState(inLibrary);
  
  const isTV = width > height || width > 800;
  const cardWidth = getCardWidth(width, isTV, size);
  const cardHeight = cardWidth * POSTER_ASPECT_RATIO;

  const handleLongPress = useCallback(async () => {
    const contentId = item.imdb_id || item.id;
    const contentName = item.name || item.title || 'this item';
    
    Alert.alert(
      isInLibrary ? 'Remove from Library?' : 'Add to Library?',
      isInLibrary 
        ? `Remove "${contentName}" from your library?`
        : `Add "${contentName}" to your library?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isInLibrary ? 'Remove' : 'Add',
          style: isInLibrary ? 'destructive' : 'default',
          onPress: async () => {
            try {
              if (isInLibrary) {
                await api.library.remove(contentId);
                setIsInLibrary(false);
              } else {
                await api.library.add({
                  content_id: contentId,
                  content_type: item.type || 'movie',
                  name: contentName,
                  poster: item.poster || '',
                });
                setIsInLibrary(true);
              }
              onLibraryChange?.();
            } catch (error) {
              console.log('Library error:', error);
              Alert.alert('Error', 'Failed to update library');
            }
          },
        },
      ]
    );
  }, [item, isInLibrary, onLibraryChange]);

  if (!item) {
    return null;
  }

  return (
    <Pressable
      onPress={onPress}
      onLongPress={handleLongPress}
      delayLongPress={500}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={({ pressed, focused }) => [
        styles.container,
        { width: cardWidth },
        (focused || isFocused) && styles.focused,
      ]}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={item.name || item.title || 'Content'}
      accessibilityHint="Long press to add or remove from library"
    >
      {({ pressed, focused }) => (
        <>
          <View style={[
            styles.imageContainer, 
            { height: cardHeight },
            (focused || isFocused) && styles.imageContainerFocused,
          ]}>
            <Image
              source={{ uri: item.poster }}
              style={styles.image}
              contentFit="cover"
              transition={100}
              recyclingKey={item.id || item.imdb_id}
              cachePolicy="memory-disk"
            />
            {/* Library indicator */}
            {isInLibrary && (
              <View style={styles.libraryIndicator}>
                <Text style={styles.libraryIndicatorText}>★</Text>
              </View>
            )}
          </View>
          {isTV && (focused || isFocused) && (item.name || item.title) && (
            <Text style={styles.focusedTitle} numberOfLines={2}>
              {item.name || item.title}
            </Text>
          )}
        </>
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
    transform: [{ scale: 1.08 }],
    zIndex: 100,
  },
  imageContainer: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    borderWidth: 4,
    borderColor: 'transparent',
  },
  imageContainerFocused: {
    borderColor: '#FFD700',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  libraryIndicator: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(184, 160, 92, 0.9)',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  libraryIndicatorText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
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
