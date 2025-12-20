import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Dimensions,
  TouchableOpacity,
  SectionList,
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
  const { q: queryParam, type: searchType } = useLocalSearchParams<{ q?: string; type?: string }>();
  const { searchResults, isLoadingSearch, search, clearSearch } = useContentStore();
  const [hasSearched, setHasSearched] = useState(false);
  const [currentQuery, setCurrentQuery] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'movie' | 'series'>('all');
  const hasTriggeredInitialSearch = useRef(false);

  // Separate results by type
  const { movies, series, filteredResults } = useMemo(() => {
    const movieResults = searchResults.filter(r => r.type === 'movie');
    const seriesResults = searchResults.filter(r => r.type === 'series');
    
    let filtered = searchResults;
    if (activeFilter === 'movie') {
      filtered = movieResults;
    } else if (activeFilter === 'series') {
      filtered = seriesResults;
    }
    
    return {
      movies: movieResults,
      series: seriesResults,
      filteredResults: filtered,
    };
  }, [searchResults, activeFilter]);

  // Auto-trigger search when navigated to with a query parameter (from genre/cast/director tags)
  useEffect(() => {
    if (queryParam && !hasTriggeredInitialSearch.current) {
      hasTriggeredInitialSearch.current = true;
      const decodedQuery = decodeURIComponent(queryParam);
      setCurrentQuery(decodedQuery);
      setHasSearched(true);
      // Set filter type if passed
      if (searchType === 'movie' || searchType === 'series') {
        setActiveFilter(searchType);
      }
      search(decodedQuery);
    }
  }, [queryParam, searchType, search]);

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
    setActiveFilter('all');
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

  const renderSectionHeader = ({ section }: { section: { title: string; data: SearchResult[] } }) => (
    <View style={styles.sectionHeader}>
      <Ionicons 
        name={section.title === 'Movies' ? 'film-outline' : 'tv-outline'} 
        size={20} 
        color="#B8A05C" 
      />
      <Text style={styles.sectionTitle}>{section.title}</Text>
      <Text style={styles.sectionCount}>({section.data.length})</Text>
    </View>
  );

  // Prepare section data
  const sections = useMemo(() => {
    const result = [];
    if (activeFilter === 'all') {
      if (movies.length > 0) {
        result.push({ title: 'Movies', data: movies });
      }
      if (series.length > 0) {
        result.push({ title: 'Series', data: series });
      }
    } else if (activeFilter === 'movie' && movies.length > 0) {
      result.push({ title: 'Movies', data: movies });
    } else if (activeFilter === 'series' && series.length > 0) {
      result.push({ title: 'Series', data: series });
    }
    return result;
  }, [movies, series, activeFilter]);

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

      {/* Filter Tabs */}
      {hasSearched && searchResults.length > 0 && (
        <View style={styles.filterContainer}>
          <TouchableOpacity 
            style={[styles.filterTab, activeFilter === 'all' && styles.filterTabActive]}
            onPress={() => setActiveFilter('all')}
          >
            <Text style={[styles.filterText, activeFilter === 'all' && styles.filterTextActive]}>
              All ({searchResults.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.filterTab, activeFilter === 'movie' && styles.filterTabActive]}
            onPress={() => setActiveFilter('movie')}
          >
            <Ionicons 
              name="film-outline" 
              size={16} 
              color={activeFilter === 'movie' ? '#B8A05C' : '#888'} 
            />
            <Text style={[styles.filterText, activeFilter === 'movie' && styles.filterTextActive]}>
              Movies ({movies.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.filterTab, activeFilter === 'series' && styles.filterTabActive]}
            onPress={() => setActiveFilter('series')}
          >
            <Ionicons 
              name="tv-outline" 
              size={16} 
              color={activeFilter === 'series' ? '#B8A05C' : '#888'} 
            />
            <Text style={[styles.filterText, activeFilter === 'series' && styles.filterTextActive]}>
              Series ({series.length})
            </Text>
          </TouchableOpacity>
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
      ) : activeFilter === 'all' ? (
        /* Sectioned List for All view */
        <SectionList
          sections={sections}
          renderItem={({ item, index, section }) => {
            // Render items in rows of 3
            if (index % 3 !== 0) return null;
            const items = section.data.slice(index, index + 3);
            return (
              <View style={styles.row}>
                {items.map((rowItem) => (
                  <View key={rowItem.id} style={styles.cardWrapper}>
                    <ContentCard
                      item={rowItem}
                      onPress={() => handleItemPress(rowItem)}
                      size="medium"
                    />
                  </View>
                ))}
              </View>
            );
          }}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      ) : (
        /* Flat List for filtered view */
        <FlatList
          data={filteredResults}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.row}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.sectionHeader}>
              <Ionicons 
                name={activeFilter === 'movie' ? 'film-outline' : 'tv-outline'} 
                size={20} 
                color="#B8A05C" 
              />
              <Text style={styles.sectionTitle}>
                {activeFilter === 'movie' ? 'Movies' : 'Series'}
              </Text>
              <Text style={styles.sectionCount}>({filteredResults.length})</Text>
            </View>
          }
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
  searchTagContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
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
    padding: 2,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    gap: 6,
  },
  filterTabActive: {
    backgroundColor: 'rgba(184, 160, 92, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(184, 160, 92, 0.4)',
  },
  filterText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '500',
  },
  filterTextActive: {
    color: '#B8A05C',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  sectionCount: {
    color: '#888',
    fontSize: 14,
    fontWeight: '500',
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
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    justifyContent: 'flex-start',
  },
  cardWrapper: {
    width: CARD_WIDTH,
  },
});
