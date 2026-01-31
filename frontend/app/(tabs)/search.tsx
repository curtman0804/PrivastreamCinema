import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
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
  const { 
    searchResults, 
    searchMovies,
    searchSeries,
    isLoadingSearch, 
    search, 
    clearSearch 
  } = useContentStore();
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
    router.replace('/search');
  };

  // Focusable clear button
  const [clearFocused, setClearFocused] = useState(false);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Search</Text>
      </View>

      <SearchBar onSearch={handleSearch} initialValue={currentQuery} />

      {/* Show current search query tag */}
      {currentQuery && hasSearched && (
        <View style={styles.searchTagContainer}>
          <View style={styles.searchTag}>
            <Text style={styles.searchTagText}>Results for "{currentQuery}"</Text>
            <Pressable 
              onPress={handleClearSearch} 
              style={[styles.clearButton, clearFocused && styles.clearButtonFocused]}
              onFocus={() => setClearFocused(true)}
              onBlur={() => setClearFocused(false)}
            >
              <Ionicons name="close-circle" size={18} color={clearFocused ? "#B8A05C" : "#888"} />
            </Pressable>
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
    color: '#FFFFFF',
  },
  searchTagContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(184, 160, 92, 0.2)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(184, 160, 92, 0.3)',
  },
  searchTagText: {
    color: '#D4C78A',
    fontSize: 14,
    fontWeight: '500',
  },
  clearButton: {
    marginLeft: 8,
    padding: 4,
    borderRadius: 12,
  },
  clearButtonFocused: {
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 16,
  },
  bottomPadding: {
    height: 40,
  },
});