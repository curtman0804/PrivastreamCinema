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
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useContentStore } from '../../src/store/contentStore';
import { ServiceRow } from '../../src/components/ServiceRow';
import { ContentItem, api, WatchProgress } from '../../src/api/client';
import { getCardWidth } from '../../src/components/ContentCard';
import { colors } from '../../src/styles/colors';

export default function DiscoverScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;
  
  const { 
    discoverData, 
    isLoadingDiscover, 
    fetchDiscover, 
    fetchAddons, 
    loadCachedData 
  } = useContentStore();
  const [refreshing, setRefreshing] = useState(false);
  const [continueWatching, setContinueWatching] = useState<WatchProgress[]>([]);
  const [isLoadingProgress, setIsLoadingProgress] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  // Use same card width calculation as ContentCard for consistency
  const POSTER_WIDTH = getCardWidth(width, isTV, 'medium');
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

  // Load cached data first, then fetch fresh data
  useEffect(() => {
    const initializeData = async () => {
      // Load cached data first for instant display
      await loadCachedData();
      setInitialLoadDone(true);
      
      // Then fetch fresh data in background
      fetchAddons();
      fetchDiscover();
      fetchContinueWatching();
    };
    
    initializeData();
  }, []);

  // Re-fetch continue watching when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      if (initialLoadDone) {
        fetchContinueWatching();
      }
    }, [fetchContinueWatching, initialLoadDone])
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
      fetchAddons(true),
      fetchDiscover(true),
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

  // Render a continue watching item
  const renderContinueWatchingItem = ({ item }: { item: WatchProgress }) => (
    <ContinueWatchingItem
      item={item}
      posterWidth={POSTER_WIDTH}
      posterHeight={POSTER_HEIGHT}
      isTV={isTV}
      onPress={() => handleContinueWatchingPress(item)}
      onRemove={() => handleRemoveFromContinueWatching(item)}
    />
  );

  // Show loading only on initial load when no cached data
  if (isLoadingDiscover && !discoverData && !initialLoadDone) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // Item width for snap scrolling
  const itemWidth = POSTER_WIDTH + 16;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Welcome Screen - No Addons and No Continue Watching */}
      {!hasContent && continueWatching.length === 0 && !isLoadingDiscover ? (
        <View style={styles.welcomeContainer}>
          <Image
            source={require('../../assets/images/logo_splash.png')}
            style={[styles.welcomeLogo, isTV && styles.welcomeLogoTV]}
            contentFit="contain"
          />
          <Text style={[styles.welcomeText, isTV && styles.welcomeTextTV]}>
            Welcome to Privastream Cinema
          </Text>
          <Text style={[styles.welcomeSubtext, isTV && styles.welcomeSubtextTV]}>
            Install addons to start streaming
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
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {/* Continue Watching Section */}
          {continueWatching.length > 0 && (
            <View style={styles.section}>
              <View style={[styles.sectionHeader, isTV && styles.sectionHeaderTV]}>
                <Text style={[styles.sectionTitle, isTV && styles.sectionTitleTV]}>
                  Continue Watching
                </Text>
              </View>
              <View style={styles.rowContainer}>
                <FlatList
                  data={continueWatching}
                  renderItem={renderContinueWatchingItem}
                  keyExtractor={(item) => item.content_id}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={[styles.rowContent, isTV && styles.rowContentTV]}
                  snapToInterval={itemWidth}
                  decelerationRate="fast"
                  getItemLayout={(data, index) => ({
                    length: itemWidth,
                    offset: itemWidth * index,
                    index,
                  })}
                />
              </View>
            </View>
          )}
          
          {/* Content Rows from Addons */}
          {Object.entries(discoverData?.services || {}).map(([serviceName, content]) => (
            <View key={serviceName}>
              {content?.movies && content.movies.length > 0 && (
                <ServiceRow
                  title={`${serviceName} Movies`}
                  items={content.movies.slice(0, 30)}
                  onItemPress={handleItemPress}
                  onSeeAll={content.movies.length > 10 ? () => {
                    router.push(`/category/${encodeURIComponent(serviceName)}/movies`);
                  } : undefined}
                />
              )}
              {content?.series && content.series.length > 0 && (
                <ServiceRow
                  title={`${serviceName} Series`}
                  items={content.series.slice(0, 30)}
                  onItemPress={handleItemPress}
                  onSeeAll={content.series.length > 10 ? () => {
                    router.push(`/category/${encodeURIComponent(serviceName)}/series`);
                  } : undefined}
                />
              )}
              {content?.channels && content.channels.length > 0 && (
                <ServiceRow
                  title={`${serviceName} Channels`}
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

// Go To Addons Button
function GoToAddonsButton({ router, isTV }: { router: any; isTV: boolean }) {
  const [isFocused, setIsFocused] = useState(false);
  
  return (
    <Pressable 
      onPress={() => router.push('/(tabs)/addons')}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={[styles.addonsButton, isFocused && styles.addonsButtonFocused]}
    >
      <Ionicons name="extension-puzzle" size={20} color={colors.textPrimary} />
      <Text style={styles.addonsButtonText}>Install Addons</Text>
    </Pressable>
  );
}

// Continue Watching Item with play overlay
function ContinueWatchingItem({ 
  item, 
  posterWidth, 
  posterHeight, 
  isTV, 
  onPress, 
  onRemove 
}: { 
  item: WatchProgress; 
  posterWidth: number; 
  posterHeight: number; 
  isTV: boolean;
  onPress: () => void;
  onRemove: () => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const percentWatched = item.percent_watched || 0;

  const handleLongPress = () => {
    Alert.alert(
      'Remove from Continue Watching?',
      `Remove "${item.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: onRemove },
      ]
    );
  };
  
  return (
    <Pressable
      onPress={onPress}
      onLongPress={handleLongPress}
      delayLongPress={500}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={[styles.continueItem, { width: posterWidth }]}
    >
      <View style={[
        styles.continueImageContainer,
        { height: posterHeight },
        isFocused && styles.continueImageFocused,
      ]}>
        <Image
          source={{ uri: item.poster || item.backdrop || '' }}
          style={styles.continueImage}
          contentFit="cover"
        />
        
        {/* Play overlay */}
        <View style={styles.playOverlay}>
          <View style={styles.playButton}>
            <Ionicons name="play" size={isTV ? 32 : 24} color={colors.textPrimary} />
          </View>
        </View>
        
        {/* Dismiss button on focus */}
        {isFocused && (
          <Pressable style={styles.dismissButton} onPress={onRemove}>
            <Ionicons name="close" size={16} color={colors.textPrimary} />
          </Pressable>
        )}
        
        {/* Progress bar */}
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { width: `${Math.min(percentWatched, 100)}%` }]} />
        </View>
      </View>
      
      {/* Title */}
      <View style={styles.continueTitle}>
        <Text style={styles.continueTitleText} numberOfLines={2}>
          {item.title}
        </Text>
        {item.season !== undefined && item.episode !== undefined && (
          <Text style={styles.continueEpisode}>
            S{item.season} E{item.episode}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  bottomPadding: {
    height: 100,
  },
  // Welcome Screen
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  welcomeLogo: {
    width: 200,
    height: 100,
    marginBottom: 24,
  },
  welcomeLogoTV: {
    width: 280,
    height: 140,
  },
  welcomeText: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 8,
  },
  welcomeTextTV: {
    fontSize: 28,
  },
  welcomeSubtext: {
    color: colors.textSecondary,
    fontSize: 16,
    marginBottom: 32,
  },
  welcomeSubtextTV: {
    fontSize: 18,
  },
  addonsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 8,
    gap: 10,
  },
  addonsButtonFocused: {
    transform: [{ scale: 1.05 }],
    borderWidth: 2,
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 16,
    elevation: 8,
  },
  addonsButtonText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  // Section styles
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionHeaderTV: {
    paddingHorizontal: 24,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
  },
  sectionTitleTV: {
    fontSize: 22,
  },
  rowContainer: {
    // Padding to prevent focus border clipping
    paddingTop: 8,
    paddingBottom: 8,
    marginTop: -4,
  },
  rowContent: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  rowContentTV: {
    paddingHorizontal: 24,
    paddingVertical: 6,
  },
  // Continue watching item
  continueItem: {
    marginRight: 16,
  },
  continueImageContainer: {
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.backgroundLight,
    position: 'relative',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  continueImageFocused: {
    transform: [{ scale: 1.05 }],
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 8,
  },
  continueImage: {
    width: '100%',
    height: '100%',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.textPrimary,
  },
  dismissButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.textPrimary,
  },
  continueTitle: {
    paddingTop: 8,
    paddingHorizontal: 4,
  },
  continueTitleText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  continueEpisode: {
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
  },
});