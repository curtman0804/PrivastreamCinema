import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useContentStore } from '../../src/store/contentStore';
import { SearchBar } from '../../src/components/SearchBar';
import { ServiceRow } from '../../src/components/ServiceRow';
import { SearchResult } from '../../src/api/client';

export default function SearchScreen() {
  const router = useRouter();
  const { q: queryParam } = useLocalSearchParams<{ q?: string }>();
  const searchResults = useContentStore(s => s.searchResults);
  const searchMovies = useContentStore(s => s.searchMovies);
  const searchSeries = useContentStore(s => s.searchSeries);
  const isLoadingSearch = useContentStore(s => s.isLoadingSearch);
  const search = useContentStore(s => s.search);
  const clearSearch = useContentStore(s => s.clearSearch);
  const [hasSearched, setHasSearched] = useState(false);
  const [currentQuery, setCurrentQuery] = useState<string>('');
  const hasTriggeredInitialSearch = useRef(false);

  // Auto-trigger search when navigated to with a query parameter
  useEffect(() => {
    if (queryParam && !hasTriggeredInitialSearch.current) {
      hasTriggeredInitialSearch.current = true;
      const decodedQuery = decodeURIComponent(queryParam);
      setCurrentQuery(decodedQuery);
      setHasSearched(true);
      search(decodedQuery);
    }
  }, [queryParam, search]);

  // Reset when component unmounts
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
        name: item.name || '',
        poster: item.poster || '',
        year: item.year ? String(item.year) : '',
        imdbRating: item.imdbRating ? String(item.imdbRating) : '',
      },
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Search</Text>
      </View>

      <SearchBar onSearch={handleSearch} initialValue={currentQuery} />

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
        <ScrollView 
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Movies Row */}
          {searchMovies.length > 0 && (
            <ServiceRow
              title={`Movies (${searchMovies.length})`}
              items={searchMovies}
              onItemPress={handleItemPress}
            />
          )}

          {/* Series Row */}
          {searchSeries.length > 0 && (
            <ServiceRow
              title={`Series (${searchSeries.length})`}
              items={searchSeries}
              onItemPress={handleItemPress}
            />
          )}

          {/* Show summary at bottom if both exist */}
          {searchMovies.length > 0 && searchSeries.length > 0 && (
            <View style={styles.resultsSummary}>
              <Text style={styles.resultsSummaryText}>
                {searchMovies.length} Movies  •  {searchSeries.length} Series
              </Text>
            </View>
          )}
          
          <View style={styles.bottomPadding} />
        </ScrollView>
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
    color: '#B8A05C',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    color: '#B8A05C',
    marginTop: 12,
    fontSize: 16,
  },
  emptyText: {
    color: '#B8A05C',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtext: {
    color: '#9A8540',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 8,
  },
  resultsSummary: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  resultsSummaryText: {
    color: '#888888',
    fontSize: 13,
    fontWeight: '500',
  },
  bottomPadding: {
    height: 40,
  },
});
