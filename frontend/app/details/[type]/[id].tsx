import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Alert,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useContentStore } from '../../../src/store/contentStore';
import { api, ContentItem, Stream, Episode } from '../../../src/api/client';

const { width, height } = Dimensions.get('window');

export default function DetailsScreen() {
  const { type, id } = useLocalSearchParams<{ type: string; id: string }>();
  const router = useRouter();
  const { 
    discoverData, 
    streams, 
    isLoadingStreams, 
    fetchStreams, 
    addToLibrary,
    library,
    fetchLibrary,
  } = useContentStore();
  
  const [content, setContent] = useState<ContentItem | null>(null);
  const [isLoadingContent, setIsLoadingContent] = useState(true);
  const [inLibrary, setInLibrary] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);

  // Get seasons from episodes
  const seasons = useMemo(() => {
    if (!content?.videos) return [];
    const seasonSet = new Set(content.videos.map(ep => ep.season).filter(s => s > 0));
    return Array.from(seasonSet).sort((a, b) => a - b);
  }, [content?.videos]);

  // Get episodes for selected season
  const episodesForSeason = useMemo(() => {
    if (!content?.videos) return [];
    return content.videos
      .filter(ep => ep.season === selectedSeason)
      .sort((a, b) => a.episode - b.episode);
  }, [content?.videos, selectedSeason]);

  // Load content and streams immediately
  useEffect(() => {
    loadContent();
    fetchLibrary();
    // Auto-fetch streams when page loads (for movies)
    if (type && id && type === 'movie') {
      fetchStreams(type, id);
    }
  }, [id, type]);

  // When episode is selected, fetch streams for that episode
  useEffect(() => {
    if (selectedEpisode && type === 'series') {
      const episodeId = `${id}:${selectedEpisode.season}:${selectedEpisode.episode}`;
      fetchStreams(type, episodeId);
    }
  }, [selectedEpisode]);

  useEffect(() => {
    if (content && library) {
      const contentList = type === 'movie' ? library.movies : library.series;
      const found = contentList?.some(
        (item) => item.id === content.id || item.imdb_id === content.id
      );
      setInLibrary(!!found);
    }
  }, [content, library]);

  const loadContent = async () => {
    setIsLoadingContent(true);
    
    // First try to find in discover data
    if (discoverData?.services) {
      for (const service of Object.values(discoverData.services)) {
        const items = type === 'movie' ? service.movies : service.series;
        const found = items?.find((item) => 
          item.id === id || item.imdb_id === id
        );
        if (found) {
          setContent(found);
          setIsLoadingContent(false);
          return;
        }
      }
    }

    // If not found, fetch from API
    try {
      const data = await api.content.getMeta(type!, id!);
      setContent(data);
    } catch (error) {
      console.log('Failed to fetch meta:', error);
      setContent({
        id: id!,
        imdb_id: id,
        name: 'Unknown Title',
        type: type as 'movie' | 'series',
        poster: '',
      });
    }
    setIsLoadingContent(false);
  };

  const handleStreamSelect = async (stream: Stream) => {
    if (stream.url) {
      // Direct HTTP stream - play in app
      router.push({
        pathname: '/player',
        params: { 
          url: stream.url,
          title: content?.name || 'Video',
        },
      });
    } else if (stream.infoHash) {
      // Torrent stream - use backend libtorrent streaming (like Stremio)
      router.push({
        pathname: '/player',
        params: { 
          infoHash: stream.infoHash,
          title: content?.name || 'Video',
        },
      });
    } else {
      Alert.alert('Error', 'This stream cannot be played');
    }
  };

  const handleAddToLibrary = async () => {
    if (!content) return;
    try {
      await addToLibrary(content);
      setInLibrary(true);
      Alert.alert('Success', 'Added to library');
    } catch (error) {
      Alert.alert('Error', 'Failed to add to library');
    }
  };

  // Parse stream info for display
  const parseStreamInfo = (stream: Stream) => {
    const title = stream.title || stream.name || 'Unknown Stream';
    const lines = title.split('\n');
    return {
      source: lines[0] || 'Stream',
      details: lines[1] || '',
    };
  };

  if (isLoadingContent) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#8B5CF6" />
        </View>
      </SafeAreaView>
    );
  }

  const rating = typeof content?.imdbRating === 'string' 
    ? parseFloat(content.imdbRating) 
    : content?.imdbRating;

  return (
    <View style={styles.container}>
      {/* Hero Background with Title Overlay */}
      <View style={styles.heroContainer}>
        <Image
          source={{ uri: content?.background || content?.poster }}
          style={styles.heroImage}
          contentFit="cover"
        />
        <LinearGradient
          colors={['transparent', 'rgba(12, 12, 12, 0.6)', '#0c0c0c']}
          style={styles.heroGradient}
        />
        
        {/* Back Button */}
        <SafeAreaView style={styles.headerOverlay}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          
          {/* Library Button */}
          <TouchableOpacity
            style={[styles.libraryButton, inLibrary && styles.libraryButtonActive]}
            onPress={handleAddToLibrary}
            disabled={inLibrary}
          >
            <Ionicons
              name={inLibrary ? 'bookmark' : 'bookmark-outline'}
              size={22}
              color={inLibrary ? '#8B5CF6' : '#FFFFFF'}
            />
          </TouchableOpacity>
        </SafeAreaView>

        {/* Title Overlay on Hero */}
        <View style={styles.titleOverlay}>
          {content?.logo ? (
            <Image
              source={{ uri: content.logo }}
              style={styles.logoImage}
              contentFit="contain"
            />
          ) : (
            <Text style={styles.heroTitle}>{content?.name}</Text>
          )}
          
          {/* Meta info */}
          <View style={styles.metaRow}>
            {rating && rating > 0 && (
              <View style={styles.ratingBadge}>
                <Ionicons name="star" size={12} color="#FFD700" />
                <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
              </View>
            )}
            {content?.year && (
              <Text style={styles.metaText}>{content.year}</Text>
            )}
            {content?.runtime && (
              <Text style={styles.metaText}>{content.runtime}</Text>
            )}
          </View>

          {/* Genres */}
          {content?.genre && content.genre.length > 0 && (
            <View style={styles.genreRow}>
              {content.genre.slice(0, 3).map((g, i) => (
                <View key={i} style={styles.genreBadge}>
                  <Text style={styles.genreText}>{g}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Description */}
        {content?.description && (
          <View style={styles.section}>
            <Text style={styles.description} numberOfLines={4}>
              {content.description}
            </Text>
          </View>
        )}

        {/* Cast & Crew */}
        {(content?.cast?.length > 0 || content?.director?.length > 0) && (
          <View style={styles.section}>
            {content?.director && content.director.length > 0 && (
              <Text style={styles.crewText}>
                <Text style={styles.crewLabel}>Director: </Text>
                {content.director.join(', ')}
              </Text>
            )}
            {content?.cast && content.cast.length > 0 && (
              <Text style={styles.crewText}>
                <Text style={styles.crewLabel}>Cast: </Text>
                {content.cast.slice(0, 5).join(', ')}
              </Text>
            )}
          </View>
        )}

        {/* Season/Episode Selection for Series */}
        {type === 'series' && seasons.length > 0 && (
          <View style={styles.episodeSection}>
            {/* Season Selector */}
            <View style={styles.seasonSelector}>
              <Text style={styles.sectionTitle}>Seasons</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.seasonScroll}>
                {seasons.map((season) => (
                  <TouchableOpacity
                    key={season}
                    style={[
                      styles.seasonButton,
                      selectedSeason === season && styles.seasonButtonActive,
                    ]}
                    onPress={() => {
                      setSelectedSeason(season);
                      setSelectedEpisode(null);
                    }}
                  >
                    <Text
                      style={[
                        styles.seasonButtonText,
                        selectedSeason === season && styles.seasonButtonTextActive,
                      ]}
                    >
                      S{season}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Episode List */}
            <View style={styles.episodeList}>
              <Text style={styles.sectionTitle}>
                Episodes - Season {selectedSeason}
              </Text>
              {episodesForSeason.map((episode) => (
                <TouchableOpacity
                  key={`${episode.season}-${episode.episode}`}
                  style={[
                    styles.episodeItem,
                    selectedEpisode?.id === episode.id && styles.episodeItemSelected,
                  ]}
                  onPress={() => setSelectedEpisode(episode)}
                >
                  <Image
                    source={{ uri: episode.thumbnail || content?.poster }}
                    style={styles.episodeThumbnail}
                    contentFit="cover"
                  />
                  <View style={styles.episodeInfo}>
                    <Text style={styles.episodeNumber}>
                      E{episode.episode}
                    </Text>
                    <Text style={styles.episodeTitle} numberOfLines={1}>
                      {episode.name || `Episode ${episode.episode}`}
                    </Text>
                    {episode.overview && (
                      <Text style={styles.episodeOverview} numberOfLines={2}>
                        {episode.overview}
                      </Text>
                    )}
                  </View>
                  {selectedEpisode?.id === episode.id && (
                    <Ionicons name="checkmark-circle" size={24} color="#8B5CF6" />
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {/* Prompt to select episode */}
            {!selectedEpisode && (
              <View style={styles.selectEpisodePrompt}>
                <Ionicons name="information-circle-outline" size={20} color="#888" />
                <Text style={styles.selectEpisodeText}>
                  Select an episode to see available streams
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Streams Section */}
        <View style={styles.streamsSection}>
          <View style={styles.streamHeader}>
            <Ionicons name="play-circle" size={20} color="#8B5CF6" />
            <Text style={styles.streamHeaderText}>Available Streams</Text>
            {!isLoadingStreams && streams.length > 0 && (
              <Text style={styles.streamCount}>({streams.length})</Text>
            )}
          </View>

          {isLoadingStreams ? (
            <View style={styles.streamLoading}>
              <ActivityIndicator size="small" color="#8B5CF6" />
              <Text style={styles.streamLoadingText}>Finding streams...</Text>
            </View>
          ) : streams.length === 0 ? (
            <View style={styles.noStreams}>
              <Ionicons name="cloud-offline-outline" size={32} color="#666" />
              <Text style={styles.noStreamsText}>No streams found</Text>
              <Text style={styles.noStreamsSubtext}>Try installing more addons</Text>
            </View>
          ) : (
            <View style={styles.streamList}>
              {streams.map((stream, index) => {
                const { source, details } = parseStreamInfo(stream);
                return (
                  <TouchableOpacity
                    key={index}
                    style={styles.streamItem}
                    onPress={() => handleStreamSelect(stream)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.streamIcon}>
                      <Ionicons name="play" size={18} color="#8B5CF6" />
                    </View>
                    <View style={styles.streamInfo}>
                      <Text style={styles.streamSource} numberOfLines={1}>{source}</Text>
                      {details && (
                        <Text style={styles.streamDetails} numberOfLines={1}>{details}</Text>
                      )}
                    </View>
                    <Ionicons name="open-outline" size={18} color="#666" />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Player Instructions */}
          {streams.length > 0 && (
            <View style={styles.playerInfo}>
              <Ionicons name="information-circle-outline" size={16} color="#888" />
              <Text style={styles.playerInfoText}>
                Tap a stream to play in VLC or MX Player
              </Text>
            </View>
          )}
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </View>
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
  heroContainer: {
    height: height * 0.45,
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '70%',
  },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  libraryButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  libraryButtonActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.3)',
  },
  titleOverlay: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
  },
  logoImage: {
    width: width * 0.6,
    height: 60,
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    gap: 4,
  },
  ratingText: {
    color: '#FFD700',
    fontSize: 13,
    fontWeight: '700',
  },
  metaText: {
    color: '#CCCCCC',
    fontSize: 13,
  },
  genreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  genreBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  genreText: {
    color: '#DDDDDD',
    fontSize: 11,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  description: {
    fontSize: 14,
    color: '#AAAAAA',
    lineHeight: 21,
  },
  crewText: {
    fontSize: 13,
    color: '#888888',
    marginBottom: 4,
  },
  crewLabel: {
    color: '#AAAAAA',
    fontWeight: '600',
  },
  streamsSection: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  streamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  streamHeaderText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  streamCount: {
    fontSize: 14,
    color: '#888888',
  },
  streamLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  streamLoadingText: {
    color: '#AAAAAA',
    fontSize: 14,
  },
  noStreams: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  noStreamsText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 8,
  },
  noStreamsSubtext: {
    color: '#666666',
    fontSize: 13,
    marginTop: 4,
  },
  streamList: {
    gap: 8,
  },
  streamItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 12,
    gap: 10,
  },
  streamIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  streamInfo: {
    flex: 1,
  },
  streamSource: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  streamDetails: {
    fontSize: 11,
    color: '#888888',
    marginTop: 2,
  },
  playerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    paddingVertical: 8,
  },
  playerInfoText: {
    fontSize: 12,
    color: '#888888',
  },
  bottomPadding: {
    height: 100,
  },
  // Episode Section Styles
  episodeSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  seasonSelector: {
    marginBottom: 16,
  },
  seasonScroll: {
    marginTop: 8,
  },
  seasonButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#333',
  },
  seasonButtonActive: {
    backgroundColor: '#8B5CF6',
    borderColor: '#8B5CF6',
  },
  seasonButtonText: {
    color: '#AAAAAA',
    fontSize: 14,
    fontWeight: '600',
  },
  seasonButtonTextActive: {
    color: '#FFFFFF',
  },
  episodeList: {
    marginTop: 8,
  },
  episodeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    marginBottom: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#222',
  },
  episodeItemSelected: {
    borderColor: '#8B5CF6',
    backgroundColor: '#1f1a2e',
  },
  episodeThumbnail: {
    width: 120,
    height: 68,
    borderRadius: 6,
    backgroundColor: '#333',
  },
  episodeInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  episodeNumber: {
    fontSize: 12,
    color: '#8B5CF6',
    fontWeight: '700',
    marginBottom: 2,
  },
  episodeTitle: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '600',
    marginBottom: 4,
  },
  episodeOverview: {
    fontSize: 12,
    color: '#888888',
    lineHeight: 16,
  },
  selectEpisodePrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    marginTop: 8,
  },
  selectEpisodeText: {
    fontSize: 14,
    color: '#888888',
  },
});
