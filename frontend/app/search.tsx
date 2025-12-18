import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
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

const { width } = Dimensions.get('window');
const ITEM_WIDTH = (width - 48) / 3;
const ITEM_HEIGHT = ITEM_WIDTH * 1.5;

export default function SearchScreen() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  const router = useRouter();
  const { searchResults, isLoadingSearch, search, clearSearch } = useContentStore();
  const [searchQuery, setSearchQuery] = useState(q || '');
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    if (q && !hasSearched) {
      setSearchQuery(q);
      setHasSearched(true);
      search(q);
    }
  }, [q, search, hasSearched]);

  // Reset search state when leaving
  useEffect(() => {
    return () => {
      setHasSearched(false);
    };
  }, []);

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

  const renderItem = ({ item }: { item: ContentItem }) => (
    <TouchableOpacity 
      style={styles.itemContainer}
      onPress={() => handleItemPress(item)}
      activeOpacity={0.7}
    >
      <Image
        source={{ uri: item.poster }}
        style={styles.poster}
        contentFit="cover"
        placeholder={require('../assets/images/icon.png')}
        placeholderContentFit="contain"
      />
      <Text style={styles.itemTitle} numberOfLines={2}>{item.name}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
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
          <TouchableOpacity onPress={handleSearch} style={styles.searchButton}>
            <Ionicons name="search" size={20} color="#B8A05C" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Results */}
      {isLoadingSearch ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#B8A05C" />
          <Text style={styles.searchingText}>Searching...</Text>
        </View>
      ) : searchResults.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="search-outline" size={48} color="#444" />
          <Text style={styles.noResultsText}>
            {q ? `No results for "${q}"` : 'Search for movies, series, or actors'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={searchResults}
          renderItem={renderItem}
          keyExtractor={(item, index) => `${item.id || item.imdb_id || ''}-${index}`}
          numColumns={3}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Text style={styles.resultsCount}>{searchResults.length} results for "{searchQuery}"</Text>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1d',
    gap: 12,
  },
  backButton: {
    padding: 8,
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
    padding: 8,
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
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  gridContent: {
    padding: 16,
  },
  itemContainer: {
    width: ITEM_WIDTH,
    marginBottom: 16,
    marginHorizontal: 4,
  },
  poster: {
    width: '100%',
    height: ITEM_HEIGHT,
    borderRadius: 8,
    backgroundColor: '#1a1a1d',
  },
  itemTitle: {
    color: '#FFFFFF',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
});
