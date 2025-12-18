import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useContentStore } from '../../src/store/contentStore';
import { SearchBar } from '../../src/components/SearchBar';
import { ContentCard } from '../../src/components/ContentCard';
import { SearchResult } from '../../src/api/client';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 64) / 3;

export default function SearchScreen() {
  const router = useRouter();
  const { q: queryParam } = useLocalSearchParams<{ q?: string }>();
  const { searchResults, isLoadingSearch, search, clearSearch } = useContentStore();
  const [hasSearched, setHasSearched] = useState(false);
  const [currentQuery, setCurrentQuery] = useState<string>('');
  const hasTriggeredInitialSearch = useRef(false);

  // Auto-trigger search when navigated to with a query parameter (from genre/cast/director tags)
  useEffect(() => {
    if (queryParam && !hasTriggeredInitialSearch.current) {
      hasTriggeredInitialSearch.current = true;
      const decodedQuery = decodeURIComponent(queryParam);
      setCurrentQuery(decodedQuery);
      setHasSearched(true);
      search(decodedQuery);
    }
  }, [queryParam, search]);

  // Reset when component unmounts or query changes
  useEffect(() => {
    return () => {
      hasTriggeredInitialSearch.current = false;
    };
  }, [queryParam]);

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      clearSearch();
      setHasSearched(false);
      setCurrentQuery('');
      return;
    }
    setCurrentQuery(query);
    setHasSearched(true);
    await search(query);
  }, [search, clearSearch]);

  const handleItemPress = (item: SearchResult) => {
    router.push({
      pathname: `/details/${item.type}/${encodeURIComponent(item.id)}`,
      params: {
        name: item.name,
        poster: item.poster,
      },
    });
  };

  const handleClearSearch = () => {
    clearSearch();
    setHasSearched(false);
    setCurrentQuery('');
    hasTriggeredInitialSearch.current = false;
    // Navigate back to search without query param
    router.replace('/search');
  };

  const renderItem = ({ item }: { item: SearchResult }) => (
    <View style={styles.cardWrapper}>
      <ContentCard
        item={item}
        onPress={() => handleItemPress(item)}
        size="medium"
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Search</Text>
      </View>

      <SearchBar onSearch={handleSearch} initialValue={currentQuery} />

      {/* Show current search query tag when searching from details page */}
      {currentQuery && hasSearched && (
        <View style={styles.searchTagContainer}>
          <View style={styles.searchTag}>
            <Text style={styles.searchTagText}>Results for "{currentQuery}"</Text>
            <TouchableOpacity onPress={handleClearSearch} style={styles.clearButton}>
              <Ionicons name="close-circle" size={18} color="#888" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {isLoadingSearch ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#B8A05C" />
          <Text style={styles.loadingText}>Searching...</Text>
        </View>
      ) : hasSearched && searchResults.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="search-outline" size={64} color="#444444" />
          <Text style={styles.emptyText}>No results found</Text>
          <Text style={styles.emptySubtext}>Try a different search term</Text>
        </View>
      ) : !hasSearched ? (
        <View style={styles.centerContainer}>
          <Ionicons name="film-outline" size={64} color="#444444" />
          <Text style={styles.emptyText}>Search for movies & TV shows</Text>
          <Text style={styles.emptySubtext}>Find your favorite content</Text>
        </View>
      ) : (
        <FlatList
          data={searchResults}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.row}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0c0c',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    color: '#FFFFFF',
    marginTop: 12,
    fontSize: 16,
  },
  emptyText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtext: {
    color: '#888888',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  row: {
    justifyContent: 'flex-start',
  },
  cardWrapper: {
    width: CARD_WIDTH,
  },
});
