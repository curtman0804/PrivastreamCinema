import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Dimensions,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useContentStore } from '../src/store/contentStore';
import { ContentItem } from '../src/api/client';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const isTV = screenWidth > screenHeight || screenWidth > 800;

// TV-optimized sizing: 6 columns on TV, 3 on mobile
const NUM_COLUMNS = isTV ? 6 : 3;
const HORIZONTAL_PADDING = isTV ? 32 : 16;
const ITEM_SPACING = isTV ? 16 : 8;
const ITEM_WIDTH = (screenWidth - (HORIZONTAL_PADDING * 2) - (ITEM_SPACING * (NUM_COLUMNS - 1))) / NUM_COLUMNS;
const ITEM_HEIGHT = ITEM_WIDTH * 1.5;

// Focusable Search Result Item
function FocusableResultItem({ 
  item, 
  onPress,
}: { 
  item: ContentItem;
  onPress: () => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  
  return (
    <Pressable 
      style={[
        styles.itemContainer, 
        isFocused && styles.itemContainerFocused
      ]}
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      <Image
        source={{ uri: item.poster }}
        style={[styles.poster, isFocused && styles.posterFocused]}
        contentFit="cover"
        placeholder={require('../assets/images/icon.png')}
        placeholderContentFit="contain"
      />
      <Text style={styles.itemTitle} numberOfLines={2}>{item.name}</Text>
    </Pressable>
  );
}

// Focusable Button Component
function FocusableButton({ 
  onPress, 
  style, 
  focusedStyle,
  children,
}: {
  onPress: () => void;
  style: any;
  focusedStyle?: any;
  children: React.ReactNode;
}) {
  const [isFocused, setIsFocused] = useState(false);
  
  return (
    <Pressable
      style={[style, isFocused && (focusedStyle || styles.defaultFocused)]}
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      {children}
    </Pressable>
  );
}

export default function SearchScreen() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  const router = useRouter();
  const { searchResults, isLoadingSearch, search, clearSearch } = useContentStore();
  const [searchQuery, setSearchQuery] = useState(q || '');
  const flatListRef = useRef<FlatList>(null);

  // Auto-search when query param exists
  useEffect(() => {
    if (q) {
      setSearchQuery(q);
      const timer = setTimeout(() => {
        search(q);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [q]);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      search(searchQuery.trim());
    }
  };

  const handleItemPress = (item: ContentItem) => {
    const id = item.imdb_id || item.id;
    const encodedId = encodeURIComponent(id);
    router.push({
      pathname: `/details/${item.type}/${encodedId}`,
      params: {
        name: item.name || '',
        poster: item.poster || '',
      }
    });
  };

  // Deduplicate results based on imdb_id or id
  const deduplicatedResults = React.useMemo(() => {
    const seen = new Set<string>();
    return searchResults.filter(item => {
      const key = item.imdb_id || item.id;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [searchResults]);

  const renderItem = ({ item, index }: { item: ContentItem; index: number }) => (
    <FocusableResultItem
      item={item}
      onPress={() => handleItemPress(item)}
    />
  );

  const getItemLayout = (_: any, index: number) => ({
    length: ITEM_HEIGHT + 40, // poster height + title + margin
    offset: (ITEM_HEIGHT + 40) * Math.floor(index / NUM_COLUMNS),
    index,
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <FocusableButton 
          onPress={() => router.back()} 
          style={styles.backButton}
          focusedStyle={styles.backButtonFocused}
        >
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </FocusableButton>
        <View style={styles.searchInputContainer}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            placeholder="Search movies, series, actors..."
            placeholderTextColor="#666"
            returnKeyType="search"
            autoFocus={!q}
          />
          <FocusableButton 
            onPress={handleSearch} 
            style={styles.searchButton}
            focusedStyle={styles.searchButtonFocused}
          >
            <Ionicons name="search" size={20} color="#B8A05C" />
          </FocusableButton>
        </View>
      </View>

      {/* Results */}
      {isLoadingSearch ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#B8A05C" />
          <Text style={styles.searchingText}>Searching...</Text>
        </View>
      ) : deduplicatedResults.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="search-outline" size={48} color="#444" />
          <Text style={styles.noResultsText}>
            {q ? `No results for "${q}"` : 'Search for movies, series, or actors'}
          </Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={deduplicatedResults}
          renderItem={renderItem}
          keyExtractor={(item, index) => `${item.imdb_id || item.id}-${index}`}
          numColumns={NUM_COLUMNS}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          getItemLayout={getItemLayout}
          initialNumToRender={NUM_COLUMNS * 3}
          maxToRenderPerBatch={NUM_COLUMNS * 2}
          windowSize={5}
          ListHeaderComponent={
            <Text style={styles.resultsCount}>
              {deduplicatedResults.length} results for "{searchQuery}"
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f11',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1d',
    gap: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  backButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1d',
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    paddingVertical: 12,
  },
  searchButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  searchButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchingText: {
    color: '#999',
    marginTop: 12,
    fontSize: 14,
  },
  noResultsText: {
    color: '#666',
    marginTop: 12,
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  resultsCount: {
    color: '#888',
    fontSize: 14,
    paddingBottom: 16,
  },
  gridContent: {
    padding: HORIZONTAL_PADDING,
  },
  itemContainer: {
    width: ITEM_WIDTH,
    marginBottom: 16,
    marginRight: ITEM_SPACING,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: 4,
  },
  itemContainerFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.15)',
    transform: [{ scale: 1.02 }],
  },
  poster: {
    width: '100%',
    height: ITEM_HEIGHT,
    borderRadius: 6,
    backgroundColor: '#1a1a1d',
  },
  posterFocused: {
    // Additional poster styling when focused
  },
  itemTitle: {
    color: '#FFFFFF',
    fontSize: isTV ? 13 : 12,
    marginTop: 6,
    textAlign: 'center',
  },
  defaultFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
  },
});
