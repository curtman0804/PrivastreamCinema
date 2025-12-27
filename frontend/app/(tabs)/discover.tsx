import React, { useEffect, useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Pressable,
  FlatList,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useContentStore } from '../../src/store/contentStore';
import { ServiceRow } from '../../src/components/ServiceRow';
import { ContentItem, api, WatchProgress } from '../../src/api/client';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CONTINUE_ITEM_WIDTH = (SCREEN_WIDTH - 48) / 2.5; // Show ~2.5 items

export default function DiscoverScreen() {
  const router = useRouter();
  const { discoverData, isLoadingDiscover, fetchDiscover, fetchAddons, addons } = useContentStore();
  const [refreshing, setRefreshing] = useState(false);
  const [continueWatching, setContinueWatching] = useState<WatchProgress[]>([]);
  const [isLoadingProgress, setIsLoadingProgress] = useState(false);

  // Fetch continue watching data
  const fetchContinueWatching = useCallback(async () => {
    try {
      setIsLoadingProgress(true);
      const response = await api.watchProgress.getAll();
      setContinueWatching(response.continueWatching || []);
    } catch (err) {
      console.log('[Discover] Error fetching continue watching:', err);
    } finally {
      setIsLoadingProgress(false);
    }
  }, []);

  useEffect(() => {
    fetchAddons();
    fetchDiscover();
    fetchContinueWatching();
  }, []);

  // Re-fetch continue watching when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      fetchContinueWatching();
    }, [fetchContinueWatching])
  );

  // Check if there's any content to display
  const hasContent = useMemo(() => {
    if (!discoverData?.services) return false;
    return Object.values(discoverData.services).some(
      (content: any) => 
        (content?.movies?.length > 0) || 
        (content?.series?.length > 0) || 
        (content?.channels?.length > 0)
    );
  }, [discoverData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      fetchAddons(),
      fetchDiscover(),
      fetchContinueWatching(),
    ]);
    setRefreshing(false);
  }, [fetchContinueWatching]);

  const handleItemPress = (item: ContentItem) => {
    const id = item.imdb_id || item.id;
    // Encode the ID to handle URLs and special characters in content IDs
    const encodedId = encodeURIComponent(id);
    // Pass content info for porn/external addons that don't have meta endpoints
    router.push({
      pathname: `/details/${item.type}/${encodedId}`,
      params: {
        name: item.name || '',
        poster: item.poster || '',
      }
    });
  };

  // Handle continue watching item press - navigate to details page
  const handleContinueWatchingPress = (item: WatchProgress) => {
    // For series episodes, navigate to the series details page with episode info
    // For movies, navigate to the movie details page
    // The details page will handle stream fetching and can auto-play
    
    // Determine the correct ID and type to navigate to
    let targetId = item.content_id;
    let targetType = item.content_type;
    
    // For series episodes (content_id like "tt1234567:1:5"), navigate to the series
    if (item.series_id) {
      targetId = item.series_id;
      targetType = 'series';
    } else if (item.content_type === 'series' && item.content_id.includes(':')) {
      // Extract series ID from episode ID (format: tt1234567:season:episode)
      const parts = item.content_id.split(':');
      if (parts.length >= 1) {
        targetId = parts[0];
      }
    }
    
    const encodedId = encodeURIComponent(targetId);
    router.push({
      pathname: `/details/${targetType}/${encodedId}`,
      params: {
        name: item.title || '',
        poster: item.poster || '',
        // Pass resume info so details page can show "Resume" button
        resumeEpisodeId: item.content_type === 'series' ? item.content_id : '',
        resumePosition: String(item.progress || 0),
        resumeSeason: item.season !== undefined ? String(item.season) : '',
        resumeEpisode: item.episode !== undefined ? String(item.episode) : '',
      },
    });
  };

  // Render a continue watching item with progress bar
  const renderContinueWatchingItem = ({ item }: { item: WatchProgress }) => {
    const percentWatched = item.percent_watched || 0;
    
    return (
      <TouchableOpacity
        style={styles.continueItem}
        onPress={() => handleContinueWatchingPress(item)}
        activeOpacity={0.8}
      >
        <View style={styles.continueImageContainer}>
          <Image
            source={{ uri: item.backdrop || item.poster || '' }}
            style={styles.continueImage}
            contentFit="cover"
          />
          {/* Play icon overlay */}
          <View style={styles.playOverlay}>
            <Ionicons name="play-circle" size={40} color="rgba(255,255,255,0.9)" />
          </View>
          {/* Progress bar */}
          <View style={styles.progressBarContainer}>
            <View 
              style={[
                styles.progressBarFill, 
                { width: `${Math.min(percentWatched, 100)}%` }
              ]} 
            />
          </View>
        </View>
        <Text style={styles.continueTitle} numberOfLines={1}>
          {item.title}
        </Text>
        {/* Show episode info if it's a series */}
        {item.season !== undefined && item.episode !== undefined && (
          <Text style={styles.continueEpisode} numberOfLines={1}>
            S{item.season} E{item.episode}
            {item.episode_title ? ` - ${item.episode_title}` : ''}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  // Show loading only on initial load
  if (isLoadingDiscover && !discoverData) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#B8A05C" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Image
          source={require('../../assets/images/logo_launcher.png')}
          style={styles.headerLogo}
          contentFit="contain"
        />
        <Text style={styles.headerTitle}>Privastream Cinema</Text>
        <Pressable 
          style={styles.searchButton}
          onPress={() => router.push('/(tabs)/search')}
        >
          <Ionicons name="search" size={22} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Welcome Screen - No Addons and No Continue Watching */}
      {!hasContent && continueWatching.length === 0 && !isLoadingDiscover ? (
        <View style={styles.welcomeContainer}>
          <Text style={styles.welcomeText}>Welcome To</Text>
          <Image
            source={require('../../assets/images/logo_splash.png')}
            style={styles.welcomeLogo}
            contentFit="contain"
          />
          <Text style={styles.welcomeSubtext}>
            Go to the Addons tab to get started
          </Text>
          <TouchableOpacity 
            style={styles.goToAddonsButton}
            onPress={() => router.push('/(tabs)/addons')}
          >
            <Ionicons name="extension-puzzle-outline" size={20} color="#FFFFFF" />
            <Text style={styles.goToAddonsText}>Go to Addons</Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* Content ScrollView */
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#B8A05C"
              colors={['#B8A05C']}
            />
          }
        >
          {/* Continue Watching Section */}
          {continueWatching.length > 0 && (
            <View style={styles.continueWatchingSection}>
              <View style={styles.sectionHeader}>
                <Ionicons name="play-circle" size={20} color="#B8A05C" />
                <Text style={styles.sectionTitle}>Continue Watching</Text>
              </View>
              <FlatList
                data={continueWatching}
                renderItem={renderContinueWatchingItem}
                keyExtractor={(item) => item.content_id}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.continueList}
              />
            </View>
          )}
          
          {Object.entries(discoverData?.services || {}).map(([serviceName, content]) => (
            <View key={serviceName}>
              {content?.movies && content.movies.length > 0 && (
                <ServiceRow
                  serviceName={serviceName}
                  items={content.movies.slice(0, 30)}
                  onItemPress={handleItemPress}
                  onSeeAll={content.movies.length > 10 ? () => {
                    router.push(`/category/${encodeURIComponent(serviceName)}/movies`);
                  } : undefined}
                />
              )}
              {content?.series && content.series.length > 0 && (
                <ServiceRow
                  serviceName={serviceName}
                  items={content.series.slice(0, 30)}
                  onItemPress={handleItemPress}
                  onSeeAll={content.series.length > 10 ? () => {
                    router.push(`/category/${encodeURIComponent(serviceName)}/series`);
                  } : undefined}
                />
              )}
              {content?.channels && content.channels.length > 0 && (
                <ServiceRow
                  serviceName={serviceName}
                  items={content.channels.slice(0, 30).map((ch: any) => ({
                    ...ch,
                    type: 'tv' as const,
                  }))}
                  onItemPress={handleItemPress}
                  onSeeAll={content.channels.length > 10 ? () => {
                    router.push(`/category/${encodeURIComponent(serviceName)}/channels`);
                  } : undefined}
                />
              )}
            </View>
          ))}
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  headerLogo: {
    width: 38,
    height: 38,
    borderRadius: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    fontFamily: 'System',
    letterSpacing: 0.5,
  },
  searchButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  bottomPadding: {
    height: 100,
  },
  // Welcome Screen Styles
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  welcomeText: {
    color: '#888888',
    fontSize: 20,
    fontWeight: '500',
    marginBottom: 12,
  },
  welcomeLogo: {
    width: 300,
    height: 130,
    marginBottom: 40,
  },
  welcomeSubtext: {
    color: '#666666',
    fontSize: 17,
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 32,
  },
  goToAddonsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#B8A05C',
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
  },
  goToAddonsText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  // Continue Watching Styles
  continueWatchingSection: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  continueList: {
    paddingHorizontal: 16,
    gap: 12,
  },
  continueItem: {
    width: CONTINUE_ITEM_WIDTH,
    marginRight: 12,
  },
  continueImageContainer: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    position: 'relative',
  },
  continueImage: {
    width: '100%',
    height: '100%',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  progressBarContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#B8A05C',
  },
  continueTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  continueEpisode: {
    color: '#888888',
    fontSize: 11,
    marginTop: 2,
  },
});
