import React, { useEffect, useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  FlatList,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useContentStore } from '../../src/store/contentStore';
import { ServiceRow } from '../../src/components/ServiceRow';
import { ContentItem, api, WatchProgress } from '../../src/api/client';

export default function DiscoverScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;
  
  const { discoverData, isLoadingDiscover, fetchDiscover, fetchAddons, addons } = useContentStore();
  const [refreshing, setRefreshing] = useState(false);
  const [continueWatching, setContinueWatching] = useState<WatchProgress[]>([]);
  const [isLoadingProgress, setIsLoadingProgress] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);

  // Calculate poster dimensions
  const POSTER_WIDTH = isTV 
    ? Math.min((width - 100) / 5, 180) 
    : (Math.min(width, 500) - 48) / 3;
  const POSTER_HEIGHT = POSTER_WIDTH * 1.5;

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
    const encodedId = encodeURIComponent(id);
    router.push({
      pathname: `/details/${item.type}/${encodedId}`,
      params: {
        name: item.name || '',
        poster: item.poster || '',
      }
    });
  };

  // Handle continue watching item press
  const handleContinueWatchingPress = (item: WatchProgress) => {
    if (item.stream_info_hash || item.stream_url) {
      router.push({
        pathname: '/player',
        params: {
          infoHash: item.stream_info_hash || '',
          directUrl: item.stream_url || '',
          fileIdx: item.stream_file_idx != null ? String(item.stream_file_idx) : '',
          filename: item.stream_filename || '',
          title: item.title || '',
          contentType: item.content_type,
          contentId: item.content_id,
          poster: item.poster || '',
          backdrop: item.backdrop || '',
          logo: item.logo || '',
          resumePosition: String(item.progress || 0),
          season: item.season != null ? String(item.season) : '',
          episode: item.episode != null ? String(item.episode) : '',
          seriesId: item.series_id || '',
        },
      });
      return;
    }
    
    let targetId = item.content_id;
    let targetType = item.content_type;
    
    if (item.series_id) {
      targetId = item.series_id;
      targetType = 'series';
    } else if (item.content_type === 'series' && item.content_id.includes(':')) {
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
        resumeEpisodeId: item.content_type === 'series' ? item.content_id : '',
        resumePosition: String(item.progress || 0),
        resumeSeason: item.season !== undefined ? String(item.season) : '',
        resumeEpisode: item.episode !== undefined ? String(item.episode) : '',
      },
    });
  };

  // Handle removing item from continue watching
  const handleRemoveFromContinueWatching = async (item: WatchProgress) => {
    try {
      await api.watchProgress.delete(item.content_id);
      setContinueWatching(prev => prev.filter(i => i.content_id !== item.content_id));
    } catch (err) {
      console.log('[Discover] Error removing from continue watching:', err);
    }
  };

  // Render a continue watching item with progress bar and remove button
  const renderContinueWatchingItem = ({ item }: { item: WatchProgress }) => {
    const percentWatched = item.percent_watched || 0;
    const [isFocused, setIsFocused] = useState(false);
    const [removeButtonFocused, setRemoveButtonFocused] = useState(false);
    
    return (
      <View style={styles.continueItemWrapper}>
        <Pressable
          style={[
            styles.continueItem,
            { width: POSTER_WIDTH },
            isFocused && styles.continueItemFocused,
          ]}
          onPress={() => handleContinueWatchingPress(item)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        >
          <View style={[
            styles.continueImageContainer,
            { width: POSTER_WIDTH, height: POSTER_HEIGHT },
            isFocused && styles.continueImageContainerFocused,
          ]}>
            <Image
              source={{ uri: item.poster || item.backdrop || '' }}
              style={styles.continueImage}
              contentFit="cover"
            />
            {/* Play icon overlay */}
            <View style={styles.playOverlay}>
              <Ionicons name="play-circle" size={isTV ? 48 : 32} color="rgba(255,255,255,0.9)" />
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
            {/* Focus border */}
            {isFocused && <View style={styles.focusBorderOverlay} />}
          </View>
        </Pressable>
        {/* Remove button */}
        <Pressable
          style={[
            styles.removeButton,
            removeButtonFocused && styles.removeButtonFocused,
          ]}
          onPress={() => handleRemoveFromContinueWatching(item)}
          onFocus={() => setRemoveButtonFocused(true)}
          onBlur={() => setRemoveButtonFocused(false)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close-circle" size={20} color="rgba(255,255,255,0.8)" />
        </Pressable>
      </View>
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
      <View style={[styles.header, isTV && styles.headerTV]}>
        <Image
          source={require('../../assets/images/logo_launcher.png')}
          style={[styles.headerLogo, isTV && styles.headerLogoTV]}
          contentFit="contain"
        />
        <Text style={[styles.headerTitle, isTV && styles.headerTitleTV]}>Privastream Cinema</Text>
        <Pressable 
          style={[
            styles.searchButton,
            isTV && styles.searchButtonTV,
            searchFocused && styles.searchButtonFocused,
          ]}
          onPress={() => router.push('/(tabs)/search')}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
        >
          <Ionicons name="search" size={isTV ? 28 : 22} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Welcome Screen - No Addons and No Continue Watching */}
      {!hasContent && continueWatching.length === 0 && !isLoadingDiscover ? (
        <View style={styles.welcomeContainer}>
          <Text style={[styles.welcomeText, isTV && styles.welcomeTextTV]}>Welcome To</Text>
          <Image
            source={require('../../assets/images/logo_splash.png')}
            style={[styles.welcomeLogo, isTV && styles.welcomeLogoTV]}
            contentFit="contain"
          />
          <Text style={[styles.welcomeSubtext, isTV && styles.welcomeSubtextTV]}>
            Go to the Addons tab to get started
          </Text>
          <GoToAddonsButton router={router} isTV={isTV} />
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
                <Ionicons name="play-circle" size={isTV ? 24 : 20} color="#B8A05C" />
                <Text style={[styles.sectionTitle, isTV && styles.sectionTitleTV]}>Continue Watching</Text>
              </View>
              <FlatList
                data={continueWatching}
                renderItem={renderContinueWatchingItem}
                keyExtractor={(item) => item.content_id}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.continueList, isTV && styles.continueListTV]}
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

// Separate component for Go To Addons button with focus support
function GoToAddonsButton({ router, isTV }: { router: any; isTV: boolean }) {
  const [isFocused, setIsFocused] = useState(false);
  
  return (
    <Pressable 
      style={[
        styles.goToAddonsButton,
        isTV && styles.goToAddonsButtonTV,
        isFocused && styles.goToAddonsButtonFocused,
      ]}
      onPress={() => router.push('/(tabs)/addons')}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      <Ionicons name="extension-puzzle-outline" size={isTV ? 24 : 20} color="#FFFFFF" />
      <Text style={[styles.goToAddonsText, isTV && styles.goToAddonsTextTV]}>Go to Addons</Text>
    </Pressable>
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
  headerTV: {
    paddingHorizontal: 32,
    paddingVertical: 16,
  },
  headerLogo: {
    width: 38,
    height: 38,
    borderRadius: 8,
  },
  headerLogoTV: {
    width: 50,
    height: 50,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    fontFamily: 'System',
    letterSpacing: 0.5,
  },
  headerTitleTV: {
    fontSize: 28,
  },
  searchButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  searchButtonTV: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  searchButtonFocused: {
    borderColor: '#FFD700',
    backgroundColor: '#2a2a2a',
    transform: [{ scale: 1.1 }],
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
  welcomeTextTV: {
    fontSize: 28,
  },
  welcomeLogo: {
    width: 300,
    height: 130,
    marginBottom: 40,
  },
  welcomeLogoTV: {
    width: 400,
    height: 170,
  },
  welcomeSubtext: {
    color: '#666666',
    fontSize: 17,
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 32,
  },
  welcomeSubtextTV: {
    fontSize: 22,
    lineHeight: 32,
  },
  goToAddonsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#B8A05C',
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  goToAddonsButtonTV: {
    paddingHorizontal: 36,
    paddingVertical: 20,
  },
  goToAddonsButtonFocused: {
    borderColor: '#FFD700',
    transform: [{ scale: 1.05 }],
  },
  goToAddonsText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  goToAddonsTextTV: {
    fontSize: 22,
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
  sectionTitleTV: {
    fontSize: 22,
  },
  continueList: {
    paddingHorizontal: 16,
    gap: 12,
  },
  continueListTV: {
    paddingHorizontal: 24,
    gap: 16,
  },
  continueItemWrapper: {
    position: 'relative',
    marginRight: 12,
  },
  continueItem: {
  },
  continueItemFocused: {
    transform: [{ scale: 1.1 }],
    zIndex: 100,
  },
  continueImageContainer: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    position: 'relative',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  continueImageContainerFocused: {
    borderColor: '#FFD700',
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
  focusBorderOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 4,
    borderColor: '#FFD700',
    borderRadius: 5,
  },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    padding: 2,
    zIndex: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  removeButtonFocused: {
    borderColor: '#FFD700',
    backgroundColor: 'rgba(255,0,0,0.8)',
  },
});
