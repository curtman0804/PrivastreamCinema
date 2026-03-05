import React, { useEffect, useCallback, useState, useMemo, useRef } from 'react';
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
  findNodeHandle,
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
  
  const { discoverData, isLoadingDiscover, fetchDiscover, fetchAddons, addons } = useContentStore();
  const [refreshing, setRefreshing] = useState(false);
  const [continueWatching, setContinueWatching] = useState<WatchProgress[]>([]);
  const [isLoadingProgress, setIsLoadingProgress] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const sectionPositions = useRef<Record<string, number>>({});
  const lastFocusedSection = useRef<string>('');

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

  // Handle section focus - scroll parent to show category title
  const handleSectionFocus = useCallback((sectionKey: string) => {
    if (lastFocusedSection.current === sectionKey) return;
    lastFocusedSection.current = sectionKey;
    
    const sectionY = sectionPositions.current[sectionKey];
    if (sectionY !== undefined && scrollViewRef.current) {
      // Small delay to override Android TV's auto-scroll (which only shows the card, not the title)
      setTimeout(() => {
        scrollViewRef.current?.scrollTo({ y: Math.max(0, sectionY - 10), animated: true });
      }, 50);
    }
  }, []);

  // Item width for snap scrolling
  const itemWidth = POSTER_WIDTH + 16;

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

  // Render a continue watching item (Stremio style)
  const renderContinueWatchingItem = ({ item }: { item: WatchProgress }) => (
    <ContinueWatchingItem
      item={item}
      posterWidth={POSTER_WIDTH}
      posterHeight={POSTER_HEIGHT}
      isTV={isTV}
      onPress={() => handleContinueWatchingPress(item)}
      onRemove={() => handleRemoveFromContinueWatching(item)}
      onSectionFocus={() => handleSectionFocus('continue-watching')}
    />
  );

  // Show loading only on initial load
  if (isLoadingDiscover && !discoverData) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

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
        /* Content ScrollView - Stremio Board style */
        <ScrollView
          ref={scrollViewRef}
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
          {/* Continue Watching Section - Stremio style */}
          {continueWatching.length > 0 && (
            <View 
              style={styles.section}
              onLayout={(e) => { sectionPositions.current['continue-watching'] = e.nativeEvent.layout.y; }}
            >
              <View style={[styles.sectionHeader, isTV && styles.sectionHeaderTV]}>
                <Text style={[styles.sectionTitle, isTV && styles.sectionTitleTV]}>
                  Continue Watching
                </Text>
              </View>
              <FlatList
                data={continueWatching}
                renderItem={renderContinueWatchingItem}
                keyExtractor={(item) => item.content_id}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.rowContent, isTV && styles.rowContentTV]}
                removeClippedSubviews={false}
                windowSize={21}
                initialNumToRender={10}
              />
            </View>
          )}
          
          {/* Content Rows from Addons */}
          {(() => {
            let firstRowRendered = false;
            return Object.entries(discoverData?.services || {}).map(([serviceName, content]) => {
            // Avoid duplicate labels - service names like "Popular Movies" already contain the type
            const hasMoviesInName = serviceName.toLowerCase().includes('movie');
            const hasSeriesInName = serviceName.toLowerCase().includes('series');
            const hasChannelsInName = serviceName.toLowerCase().includes('channel');
            
            return (
            <React.Fragment key={serviceName}>
              {content?.movies && content.movies.length > 0 && (() => {
                const isFirst = !firstRowRendered && continueWatching.length === 0;
                if (isFirst) firstRowRendered = true;
                return (
                <View
                  onLayout={(e) => { sectionPositions.current[`${serviceName}-movies`] = e.nativeEvent.layout.y; }}
                >
                  <ServiceRow
                    title={hasMoviesInName ? serviceName : `${serviceName} Movies`}
                    serviceName={serviceName}
                    contentType="movies"
                    items={content.movies}
                    onItemPress={handleItemPress}
                    onSectionFocus={() => handleSectionFocus(`${serviceName}-movies`)}
                    isFirstRow={isFirst}
                  />
                </View>
                );
              })()}
              {content?.series && content.series.length > 0 && (() => {
                const isFirst = !firstRowRendered && continueWatching.length === 0;
                if (isFirst) firstRowRendered = true;
                return (
                <View
                  onLayout={(e) => { sectionPositions.current[`${serviceName}-series`] = e.nativeEvent.layout.y; }}
                >
                  <ServiceRow
                    title={hasSeriesInName ? serviceName : `${serviceName} Series`}
                    serviceName={serviceName}
                    contentType="series"
                    items={content.series}
                    onItemPress={handleItemPress}
                    onSectionFocus={() => handleSectionFocus(`${serviceName}-series`)}
                    isFirstRow={isFirst}
                  />
                </View>
                );
              })()}
              {content?.channels && content.channels.length > 0 && (() => {
                const isFirst = !firstRowRendered && continueWatching.length === 0;
                if (isFirst) firstRowRendered = true;
                return (
                <View
                  onLayout={(e) => { sectionPositions.current[`${serviceName}-channels`] = e.nativeEvent.layout.y; }}
                >
                  <ServiceRow
                    title={hasChannelsInName ? serviceName : `${serviceName} Channels`}
                    serviceName={serviceName}
                    contentType="channels"
                    items={content.channels.map((ch: any) => ({
                      ...ch,
                      type: 'tv' as const,
                    }))}
                    onItemPress={handleItemPress}
                    onSectionFocus={() => handleSectionFocus(`${serviceName}-channels`)}
                    isFirstRow={isFirst}
                  />
                </View>
                );
              })()}
            </React.Fragment>
          );
          });
          })()}
          <View style={styles.bottomPadding} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// Go To Addons Button (Stremio style)
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

// Continue Watching Item (Stremio style with play overlay and X on poster)
function ContinueWatchingItem({ 
  item, 
  posterWidth, 
  posterHeight, 
  isTV, 
  onPress, 
  onRemove,
  onSectionFocus,
}: { 
  item: WatchProgress; 
  posterWidth: number; 
  posterHeight: number; 
  isTV: boolean;
  onPress: () => void;
  onRemove: () => void;
  onSectionFocus?: () => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const [xFocused, setXFocused] = useState(false);
  const percentWatched = item.percent_watched || 0;

  // Refs for explicit focus navigation between poster and X button
  const posterRef = useRef<View>(null);
  const xButtonRef = useRef<View>(null);
  const [posterTag, setPosterTag] = useState<number | undefined>(undefined);
  const [xButtonTag, setXButtonTag] = useState<number | undefined>(undefined);

  useEffect(() => {
    // Get native node handles after mount for nextFocusUp/Down wiring
    const pTag = posterRef.current ? findNodeHandle(posterRef.current) : null;
    const xTag = xButtonRef.current ? findNodeHandle(xButtonRef.current) : null;
    if (pTag) setPosterTag(pTag);
    if (xTag) setXButtonTag(xTag);
  }, []);

  const handleFocus = () => {
    setIsFocused(true);
    onSectionFocus?.();
  };

  const handleXFocus = () => {
    setXFocused(true);
    onSectionFocus?.();
  };

  const xButtonSize = isTV ? 30 : 24;
  // Total height of the X row = button size + top padding (8px)
  const xRowHeight = xButtonSize + 8;
  
  return (
    <View style={[styles.continueItem, { width: posterWidth }]}>
      {/* X button row - in normal flow ABOVE poster, right-aligned, overlaps via negative margin */}
      <View style={[styles.xButtonRow, { paddingTop: 8 }]}>
        <Pressable
          ref={xButtonRef}
          onPress={onRemove}
          onFocus={handleXFocus}
          onBlur={() => setXFocused(false)}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${item.title} from Continue Watching`}
          android_ripple={null}
          nextFocusDown={posterTag}
          style={[
            styles.removeButtonOverlay,
            { width: xButtonSize, height: xButtonSize, borderRadius: xButtonSize / 2 },
            xFocused && styles.removeButtonOverlayFocused,
          ]}
        >
          <Ionicons
            name="close"
            size={isTV ? 16 : 12}
            color={xFocused ? '#fff' : 'rgba(255,255,255,0.9)'}
          />
        </Pressable>
      </View>

      {/* Main poster - pulled up fully to overlap X button row, so X appears inside poster corner */}
      <Pressable
        ref={posterRef}
        onPress={onPress}
        onFocus={handleFocus}
        onBlur={() => setIsFocused(false)}
        android_ripple={null}
        nextFocusUp={xButtonTag}
        style={[
          styles.continueImageWrapper,
          { marginTop: -xRowHeight },
          isFocused && styles.continueImageWrapperFocused,
        ]}
      >
        <View style={[styles.continueImageContainer, { height: posterHeight }]}>
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
          
          {/* Progress bar */}
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { width: `${Math.min(percentWatched, 100)}%` }]} />
          </View>
        </View>
      </Pressable>

      {/* Title below poster */}
      <View style={styles.continueTitleContent}>
        <Text style={styles.continueTitleText} numberOfLines={2}>
          {item.title}
        </Text>
        {item.season != null && item.episode != null && item.season > 0 && item.episode > 0 && (
          <Text style={styles.continueEpisode}>
            S{item.season} E{item.episode}
          </Text>
        )}
      </View>
    </View>
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
    overflow: 'visible',
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
    marginBottom: 32,
    overflow: 'visible',
  },
  sectionHeader: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  sectionHeaderTV: {
    paddingHorizontal: 48,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
  },
  sectionTitleTV: {
    fontSize: 22,
  },
  rowContent: {
    paddingHorizontal: 16,
  },
  rowContentTV: {
    paddingLeft: 48,
    paddingRight: 108,
  },
  // Continue watching item - Stremio style
  continueItem: {
    marginRight: 16,
  },
  // X button row - sits above poster, right-aligned
  xButtonRow: {
    alignItems: 'flex-end',
    zIndex: 10,
    paddingRight: 8,
  },
  continueImageWrapper: {
    borderRadius: 6,
    borderWidth: 3,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  continueImageWrapperFocused: {
    borderColor: colors.primary,
  },
  continueImageContainer: {
    backgroundColor: colors.backgroundLight,
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
  continueTitleText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  continueEpisode: {
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
  },
  continueTitleContent: {
    paddingTop: 6,
  },
  // X button overlaid on top-right of poster
  removeButtonOverlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  removeButtonOverlayFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(184, 160, 92, 0.5)',
    transform: [{ scale: 1.2 }],
  },
});
