import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useContentStore } from '../../src/store/contentStore';
import { ContentCard, getCardWidth } from '../../src/components/ContentCard';
import { ContentItem } from '../../src/api/client';
import { colors } from '../../src/styles/colors';

type FilterType = 'movies' | 'series' | 'tv';

export default function LibraryScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;
  
  const { library, isLoadingLibrary, fetchLibrary } = useContentStore();
  const [filter, setFilter] = useState<FilterType>('movies');
  const [refreshing, setRefreshing] = useState(false);
  const [focusedFilter, setFocusedFilter] = useState<FilterType | null>(null);

  const cardWidth = getCardWidth(width, isTV, 'medium');

  useEffect(() => {
    fetchLibrary();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchLibrary(true);
    setRefreshing(false);
  }, []);

  const handleItemPress = (item: ContentItem) => {
    const id = item.imdb_id || item.id;
    router.push(`/details/${item.type}/${id}`);
  };

  const getFilteredContent = (): ContentItem[] => {
    if (!library) return [];
    switch (filter) {
      case 'movies':
        return library.movies || [];
      case 'series':
        return library.series || [];
      case 'tv':
        return library.channels || [];
      default:
        return library.movies || [];
    }
  };

  const filteredContent = getFilteredContent();

  const renderFilterButton = (type: FilterType, label: string) => (
    <Pressable
      style={[
        styles.filterButton, 
        filter === type && styles.filterButtonActive,
        focusedFilter === type && styles.filterButtonFocused,
      ]}
      onPress={() => setFilter(type)}
      onFocus={() => setFocusedFilter(type)}
      onBlur={() => setFocusedFilter(null)}
    >
      <Text style={[
        styles.filterText, 
        filter === type && styles.filterTextActive,
        focusedFilter === type && styles.filterTextFocused,
      ]}>
        {label}
      </Text>
    </Pressable>
  );

  const renderItem = ({ item }: { item: ContentItem }) => (
    <View style={[styles.cardWrapper, { width: cardWidth + 16 }]}>
      <ContentCard
        item={item}
        onPress={() => handleItemPress(item)}
        size="medium"
        onLibraryChange={() => fetchLibrary(true)}
      />
    </View>
  );

  if (isLoadingLibrary && !library) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, isTV && styles.headerTitleTV]}>Library</Text>
      </View>

      <View style={styles.filterContainer}>
        {renderFilterButton('movies', 'Movies')}
        {renderFilterButton('series', 'Series')}
        {renderFilterButton('tv', 'TV Channels')}
      </View>

      {filteredContent.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="bookmark-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyText}>Your library is empty</Text>
          <Text style={styles.emptySubtext}>Long-press on any poster to add it to your library</Text>
        </View>
      ) : (
        <FlatList
          data={filteredContent}
          renderItem={renderItem}
          keyExtractor={(item) => item.imdb_id || item.id}
          numColumns={isTV ? 6 : 3}
          key={isTV ? 'tv-grid' : 'mobile-grid'}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.row}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  headerTitleTV: {
    fontSize: 32,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.backgroundLight,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  filterButtonActive: {
    backgroundColor: colors.primary,
  },
  filterButtonFocused: {
    borderColor: colors.primary,
  },
  filterText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  filterTextActive: {
    color: colors.textPrimary,
  },
  filterTextFocused: {
    color: colors.textPrimary,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtext: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  listContent: {
    // Extra padding at top to prevent focus border clipping
    paddingTop: 12,
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  row: {
    justifyContent: 'flex-start',
  },
  cardWrapper: {
    // Padding around each card to prevent focus clipping
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
});