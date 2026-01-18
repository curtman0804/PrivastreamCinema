import React, { useEffect, useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
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
  
  // Responsive: detect TV/landscape
  const isTV = width > 1000;
  const isTablet = width > 600 && width <= 1000;
  
  const { discoverData, isLoadingDiscover, fetchDiscover, fetchAddons } = useContentStore();
  const [refreshing, setRefreshing] = useState(false);
  const [continueWatching, setContinueWatching] = useState<WatchProgress[]>([]);

  // Calculate poster dimensions
  const numColumns = isTV ? 8 : isTablet ? 5 : 3;
  const horizontalPadding = isTV ? 48 : isTablet ? 32 : 16;
  const gap = isTV ? 12 : 10;
  const POSTER_WIDTH = (width - (horizontalPadding * 2) - (gap * (numColumns - 1))) / numColumns;
  const POSTER_HEIGHT = POSTER_WIDTH * 1.5;

  const fetchContinueWatching = useCallback(async () => {
    try {
      const response = await api.watchProgress.getAll();
      setContinueWatching(response.continueWatching || []);
    } catch (err) {
      console.log('[Discover] Error fetching continue watching:', err);
    }
  }, []);

  useEffect(() => {
    fetchAddons();
    fetchDiscover();
    fetchContinueWatching();
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchContinueWatching();
    }, [fetchContinueWatching])
  );

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
      },
    });
  };

  const handleRemoveFromContinueWatching = async (item: WatchProgress) => {
    try {
      await api.watchProgress.delete(item.content_id);
      setContinueWatching(prev => prev.filter(i => i.content_id !== item.content_id));
    } catch (err) {
      console.log('[Discover] Error removing from continue watching:', err);
    }
  };

  const renderContinueWatchingItem = ({ item }: { item: WatchProgress }) => {
    const percentWatched = item.percent_watched || 0;
    
    return (
      <View style={[styles.continueItemWrapper, { marginRight: gap }]}>
        <TouchableOpacity
          style={[styles.continueItem, { width: POSTER_WIDTH }]}
          onPress={() => handleContinueWatchingPress(item)}
          activeOpacity={0.7}
        >
          <View style={[styles.continueImageContainer, { width: POSTER_WIDTH, height: POSTER_HEIGHT }]}>
            <Image
              source={{ uri: item.poster || item.backdrop || '' }}
              style={styles.continueImage}
              contentFit="cover"
            />
            <View style={styles.playOverlay}>
              <Ionicons name="play-circle" size={isTV ? 36 : 28} color="rgba(255,255,255,0.9)" />
            </View>
            <View style={styles.progressBarContainer}>
              <View style={[styles.progressBarFill, { width: `${Math.min(percentWatched, 100)}%` }]} />
            </View>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.removeButton}
          onPress={() => handleRemoveFromContinueWatching(item)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close-circle" size={18} color="rgba(255,255,255,0.8)" />
        </TouchableOpacity>
      </View>
    );
  };

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
      <View style={[styles.header, { paddingHorizontal: horizontalPadding }]}>
        <Image
          source={require('../../assets/images/logo_launcher.png')}
          style={[styles.headerLogo, isTV && styles.headerLogoTV]}
          contentFit="contain"
        />
        <Text style={[styles.headerTitle, isTV && styles.headerTitleTV]}>Privastream Cinema</Text>
        <TouchableOpacity 
          style={[styles.searchButton, isTV && styles.searchButtonTV]}
          onPress={() => router.push('/(tabs)/search')}
          activeOpacity={0.7}
        >
          <Ionicons name="search" size={isTV ? 24 : 20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Welcome Screen - No Addons */}
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
          <TouchableOpacity 
            style={[styles.goToAddonsButton, isTV && styles.goToAddonsButtonTV]}
            onPress={() => router.push('/(tabs)/addons')}
            activeOpacity={0.7}
          >
            <Ionicons name="extension-puzzle-outline" size={isTV ? 22 : 18} color="#FFFFFF" />
            <Text style={[styles.goToAddonsText, isTV && styles.goToAddonsTextTV]}>Go to Addons</Text>
          </TouchableOpacity>
        </View>
      ) : (
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
              <View style={[styles.sectionHeader, { paddingHorizontal: horizontalPadding }]}>
                <Ionicons name="play-circle" size={isTV ? 20 : 16} color="#B8A05C" />
                <Text style={[styles.sectionTitle, isTV && styles.sectionTitleTV]}>Continue Watching</Text>
              </View>
              <FlatList
                data={continueWatching}
                renderItem={renderContinueWatchingItem}
                keyExtractor={(item) => item.content_id}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: horizontalPadding }}
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
    paddingVertical: 12,
    gap: 10,
  },
  headerLogo: {
    width: 38,
    height: 38,
    borderRadius: 8,
  },
  headerLogoTV: {
    width: 44,
    height: 44,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  headerTitleTV: {
    fontSize: 24,
  },
  searchButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchButtonTV: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  scrollView: {
    flex: 1,
  },
  bottomPadding: {
    height: 80,
  },
  // Welcome Screen
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  welcomeText: {
    color: '#888888',
    fontSize: 18,
    fontWeight: '500',
    marginBottom: 10,
  },
  welcomeTextTV: {
    fontSize: 24,
  },
  welcomeLogo: {
    width: 250,
    height: 110,
    marginBottom: 30,
  },
  welcomeLogoTV: {
    width: 350,
    height: 150,
  },
  welcomeSubtext: {
    color: '#666666',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  welcomeSubtextTV: {
    fontSize: 18,
    lineHeight: 26,
  },
  goToAddonsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#B8A05C',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
  },
  goToAddonsButtonTV: {
    paddingHorizontal: 30,
    paddingVertical: 16,
  },
  goToAddonsText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  goToAddonsTextTV: {
    fontSize: 18,
  },
  // Continue Watching
  continueWatchingSection: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 6,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  sectionTitleTV: {
    fontSize: 20,
  },
  continueItemWrapper: {
    position: 'relative',
  },
  continueItem: {
  },
  continueImageContainer: {
    borderRadius: 6,
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
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#B8A05C',
  },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
    padding: 2,
    zIndex: 10,
  },
});
