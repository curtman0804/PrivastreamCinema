import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  InteractionManager, /* V119B_FIX_IMPORT */
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
  // V112_SEARCH_NAV: pagination + row-snap nav (parity with Discover screen)
  const loadMoreSearch = useContentStore(s => s.loadMoreSearch);
  const searchHasMore = useContentStore(s => s.searchHasMore);
  const isLoadingMoreSearch = useContentStore(s => s.isLoadingMoreSearch);
  const scrollViewRef = useRef<ScrollView>(null);
  const sectionPositions = useRef<Record<string, number>>({});
  const lastFocusedSection = useRef<string>('');
  const pagesLoaded = useRef<number>(0);

  // Auto-trigger search when navigated to with a query parameter
  useEffect(() => {
    if (queryParam && !hasTriggeredInitialSearch.current) {
      hasTriggeredInitialSearch.current = true;
      const decodedQuery = decodeURIComponent(queryParam);
      setCurrentQuery(decodedQuery);
      setHasSearched(true);
      // V119: defer the network call until the screen has painted
      InteractionManager.runAfterInteractions(() => {
        search(decodedQuery);
      });
    }
  }, [queryParam, search]);

  // Reset when component unmounts
  useEffect(() => {
    return () => {
      hasTriggeredInitialSearch.current = false;
    };
  }, [queryParam]);

  // V119_TRANSITION_LAG: defer auto-paging until AFTER nav transition completes
  // so the Discover->Search animation doesn't stutter on the JS thread.
  // v238 — also IGNORE backend's `searchHasMore=false` after the first
  // page if we got a full page of results.  The backend's hasMore flag
  // mis-fires on genre + multi-word queries and was capping results at
  // 30.  We keep paginating until we get a partial/empty page back.
  useEffect(() => {
    if (!hasSearched) return;
    if (isLoadingSearch || isLoadingMoreSearch) return;
    const totalSoFar = searchMovies.length + searchSeries.length;
    // Trust hasMore for stop-condition only if we got fewer than 30 the
    // last time around (real end of stream).  Otherwise keep pulling.
    const looksTruncated = !searchHasMore && totalSoFar > 0 && totalSoFar % 30 === 0;
    if (!searchHasMore && !looksTruncated) return;
    if (pagesLoaded.current >= 15) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      pagesLoaded.current += 1;
      loadMoreSearch();
    });
    return () => handle.cancel();
  }, [hasSearched, isLoadingSearch, isLoadingMoreSearch, searchHasMore, loadMoreSearch, searchMovies.length, searchSeries.length]);

  // Reset paging + focus state when query changes
  useEffect(() => {
    pagesLoaded.current = 0;
    lastFocusedSection.current = '';
  }, [currentQuery]);

  // V112: row-snap — scroll parent ScrollView to bring focused row's title into view
  const handleSectionFocus = useCallback((sectionKey: string) => {
    if (lastFocusedSection.current === sectionKey) return;
    lastFocusedSection.current = sectionKey;
    const y = sectionPositions.current[sectionKey];
    if (y !== undefined && scrollViewRef.current) {
      scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 10), animated: true });
    }
  }, []);

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
    // v238 — if a multi-word query returned ZERO movies AND ZERO series,
    // retry once with a more lenient form (drop short stop-words like
    // "of", "the", "a", "an" — addons that index titles literally will
    // miss "pirates of the caribbean" but match "pirates caribbean").
    const { searchMovies: m2, searchSeries: s2 } = useContentStore.getState();
    if (m2.length === 0 && s2.length === 0 && /\s/.test(query.trim())) {
      const lean = query
        .trim()
        .split(/\s+/)
        .filter(w => !/^(of|the|a|an|and|in|on|at|to|for|with|de|la|el)$/i.test(w))
        .join(' ');
      if (lean && lean !== query.trim()) {
        console.log('[search v238] retrying with stripped query:', lean);
        await search(lean);
      }
    }
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
          <Text style={styles.emptyText}>You can search for anything...</Text>
          <Text style={styles.emptySubtext}>Find your favorite content</Text>
        </View>
      ) : (
        <ScrollView 
          ref={scrollViewRef}
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          /* V112B_LOCK_BOTTOM: hard-stop at last row, no overscroll past content */
          bounces={false}
          overScrollMode="never"
          alwaysBounceVertical={false}
          /* V119_TRANSITION_LAG: drop offscreen rows from native view tree */
          removeClippedSubviews={true}
        >
          {/* Movies Row */}
          {searchMovies.length > 0 && (
            <View onLayout={(e) => { sectionPositions.current['movies'] = e.nativeEvent.layout.y; }}>
              <ServiceRow
                title={`Movies (${searchMovies.length})`}
                items={searchMovies}
                onItemPress={handleItemPress}
                onSectionFocus={() => handleSectionFocus('movies')}
              />
            </View>
          )}

          {/* Series Row */}
          {searchSeries.length > 0 && (
            <View onLayout={(e) => { sectionPositions.current['series'] = e.nativeEvent.layout.y; }}>
              <ServiceRow
                title={`Series (${searchSeries.length})`}
                items={searchSeries}
                onItemPress={handleItemPress}
                onSectionFocus={() => handleSectionFocus('series')}
              />
            </View>
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
    height: 8, // V112B: minimal padding so last row ends flush with screen
  },
});
