import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useContentStore } from '../../../src/store/contentStore';
import { api, ContentItem, Stream, Episode } from '../../../src/api/client';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width, height } = Dimensions.get('window');

export default function DetailsScreen() {
  const { type, id: rawId, name: passedName, poster: passedPoster } = useLocalSearchParams<{ 
    type: string; 
    id: string;
    name?: string;
    poster?: string;
  }>();
  const router = useRouter();
  const { 
    streams, 
    isLoadingStreams, 
    fetchStreams, 
    library,
    fetchLibrary,
  } = useContentStore();
  
  // Decode the ID in case it contains URL-encoded characters
  const id = rawId ? decodeURIComponent(rawId) : rawId;
  
  const [content, setContent] = useState<ContentItem | null>(null);
  const [isLoadingContent, setIsLoadingContent] = useState(true);
  const [inLibrary, setInLibrary] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);

  // Check if this is an episode page (id contains season:episode)
  // Also check for porn IDs which use colons
  const isEpisodePage = id?.includes(':') && !id?.startsWith('porn') && !id?.startsWith('http');
  const baseId = isEpisodePage ? id?.split(':')[0] : id;
  const episodeSeason = isEpisodePage ? parseInt(id?.split(':')[1] || '1') : null;
  const episodeNumber = isEpisodePage ? parseInt(id?.split(':')[2] || '1') : null;

  // Get the specific episode data when on an episode page
  const currentEpisode = useMemo(() => {
    if (!isEpisodePage || !content?.videos || !episodeSeason || !episodeNumber) return null;
    return content.videos.find(
      ep => ep.season === episodeSeason && ep.episode === episodeNumber
    );
  }, [isEpisodePage, content?.videos, episodeSeason, episodeNumber]);

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

  // Load content
  useEffect(() => {
    loadContent();
    fetchLibrary();
    
    // Fetch streams for movies, episode pages, or TV channels
    if (type && id && (type === 'movie' || type === 'tv' || isEpisodePage)) {
      fetchStreams(type, id);
    }
  }, [id, type]);

  // Set first available season
  useEffect(() => {
    if (seasons.length > 0 && !seasons.includes(selectedSeason)) {
      setSelectedSeason(seasons[0]);
    }
  }, [seasons]);

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
    try {
      // Always fetch from API to get full metadata including episodes
      const contentId = isEpisodePage ? baseId : id;
      const data = await api.content.getMeta(type!, contentId!);
      setContent(data);
    } catch (error) {
      console.log('Failed to fetch meta:', error);
      // Use passed name/poster from discover page if available
      setContent({
        id: id!,
        imdb_id: id,
        name: passedName || 'Unknown Title',
        type: type as 'movie' | 'series',
        poster: passedPoster || '',
      });
    }
    setIsLoadingContent(false);
  };

  const handleStreamSelect = async (stream: Stream) => {
    // Get the IMDB ID for subtitles - use baseId for episodes
    const imdbId = baseId || (id as string);
    const contentTitle = content?.name || 'Video';
    const cType = type as string || 'movie';
    
    console.log('[DETAILS] handleStreamSelect - passing to player:', { cType, imdbId, contentTitle });
    
    // Also save to AsyncStorage as backup
    try {
      await AsyncStorage.setItem('currentPlaying', JSON.stringify({
        contentType: cType,
        contentId: imdbId,
        title: contentTitle,
      }));
    } catch (e) {
      console.log('[DETAILS] Error saving to AsyncStorage:', e);
    }
    
    // Check if this is an external URL stream (xHamster, etc.) that needs to open in browser
    if (stream.externalUrl || stream.requiresWebView) {
      const externalUrl = stream.externalUrl || stream.url;
      console.log('[DETAILS] Opening external URL in browser:', externalUrl);
      
      // Open in external browser - this is the only way to play IP-restricted content
      Linking.openURL(externalUrl).catch(err => {
        console.error('Error opening URL:', err);
      });
      return;
    }
    
    // Check if this is a proxy stream - need to convert relative URL to absolute
    if (stream.url && stream.url.startsWith('/api/proxy/')) {
      // Get the auth token to include in the URL for video player authentication
      const authToken = await AsyncStorage.getItem('auth_token');
      
      // Build the full URL - proxy URLs already have ?url= so we add &token=
      const separator = stream.url.includes('?') ? '&' : '?';
      const tokenParam = authToken ? `${separator}token=${encodeURIComponent(authToken)}` : '';
      
      // Construct full absolute URL with the current origin
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const absoluteUrl = `${origin}${stream.url}${tokenParam}`;
      console.log('[DETAILS] Using proxy stream:', absoluteUrl.substring(0, 150));
      
      router.push({
        pathname: '/player',
        params: { 
          directUrl: absoluteUrl,
          title: contentTitle,
          isLive: 'false',
          contentType: cType,
          contentId: imdbId,
        },
      });
      return;
    }
    
    if (stream.infoHash) {
      // Torrent stream - use torrent player
      router.push({
        pathname: '/player',
        params: { 
          infoHash: stream.infoHash,
          title: contentTitle,
          contentType: cType,
          contentId: imdbId,
        },
      });
    } else if (stream.url) {
      // Direct URL stream (USA TV, etc.) - play directly
      router.push({
        pathname: '/player',
        params: { 
          directUrl: stream.url,
          title: contentTitle,
          isLive: type === 'tv' ? 'true' : 'false',
          contentType: cType,
          contentId: imdbId,
        },
      });
    }
  };

  const handleEpisodePress = (episode: Episode) => {
    // Navigate to episode detail page
    const episodeId = `${baseId || id}:${episode.season}:${episode.episode}`;
    router.push({
      pathname: `/details/${type}/${episodeId}`,
    });
  };

  const toggleLibrary = async () => {
    if (!content) return;
    try {
      if (inLibrary) {
        await api.library.remove(type!, content.id);
        setInLibrary(false);
      } else {
        await api.library.add({
          id: content.id,
          imdb_id: content.imdb_id || content.id,
          name: content.name,
          type: type as 'movie' | 'series',
          poster: content.poster,
          year: content.year,
          imdbRating: typeof content.imdbRating === 'string' ? parseFloat(content.imdbRating) : content.imdbRating,
        });
        setInLibrary(true);
      }
    } catch (error) {
      console.log('Failed to toggle library:', error);
    }
  };

  const parseStreamInfo = (stream: Stream) => {
    const name = stream.name || '';
    const title = stream.title || '';
    return {
      source: name,
      details: title,
    };
  };

  if (isLoadingContent) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#B8A05C" />
      </View>
    );
  }

  const rating = typeof content?.imdbRating === 'string' 
    ? parseFloat(content.imdbRating) 
    : content?.imdbRating;

  return (
    <View style={styles.container}>
      {/* Hero Section */}
      <View style={styles.heroContainer}>
        <Image
          source={{ uri: content?.background || content?.poster }}
          style={styles.heroImage}
          contentFit="cover"
        />
        <LinearGradient
          colors={['transparent', 'rgba(15,15,17,0.8)', '#0f0f11']}
          style={styles.heroGradient}
        />
        
        {/* Back Button */}
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>

        {/* Logo or Title */}
        <View style={styles.heroContent}>
          {content?.logo ? (
            <Image
              source={{ uri: content.logo }}
              style={styles.logoImage}
              contentFit="contain"
            />
          ) : (
            <Text style={styles.heroTitle}>{content?.name}</Text>
          )}
        </View>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Metadata Row */}
        <View style={styles.metaRow}>
          {rating && rating > 0 && (
            <View style={styles.imdbBadge}>
              <Text style={styles.imdbLabel}>IMDb</Text>
              <Text style={styles.imdbRating}>{rating.toFixed(1)}/10</Text>
            </View>
          )}
          {content?.year && (
            <Text style={styles.metaText}>{content.year}</Text>
          )}
          {content?.runtime && (
            <Text style={styles.metaText}>{content.runtime}</Text>
          )}
        </View>

        {/* Add to Library Button */}
        <TouchableOpacity 
          style={styles.libraryButton}
          onPress={toggleLibrary}
        >
          <Ionicons 
            name={inLibrary ? "checkmark" : "add"} 
            size={20} 
            color="#FFFFFF" 
          />
          <Text style={styles.libraryButtonText}>
            {inLibrary ? 'In Library' : 'Add to Library'}
          </Text>
        </TouchableOpacity>

        {/* Description */}
        {content?.description && (
          <Text style={styles.description}>{content.description}</Text>
        )}

        {/* Genres */}
        {content?.genre && Array.isArray(content.genre) && content.genre.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Genres</Text>
            <View style={styles.pillContainer}>
              {content.genre.map((g, i) => (
                <TouchableOpacity 
                  key={i} 
                  style={styles.genrePill}
                  onPress={() => router.push(`/search?q=${encodeURIComponent(g)}`)}
                >
                  <Text style={styles.genrePillText}>{g}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Director */}
        {content?.director && Array.isArray(content.director) && content.director.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Director</Text>
            <View style={styles.pillContainer}>
              {content.director.map((d, i) => (
                <TouchableOpacity 
                  key={i} 
                  style={styles.directorPill}
                  onPress={() => router.push(`/search?q=${encodeURIComponent(d)}`)}
                >
                  <Text style={styles.directorPillText}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Cast */}
        {content?.cast && Array.isArray(content.cast) && content.cast.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Cast</Text>
            <View style={styles.pillContainer}>
              {content.cast.slice(0, 6).map((actor, i) => (
                <TouchableOpacity 
                  key={i} 
                  style={styles.castPill}
                  onPress={() => router.push(`/search?q=${encodeURIComponent(actor)}`)}
                >
                  <Text style={styles.castPillText}>{actor}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Episodes Section - Only for series main page */}
        {type === 'series' && !isEpisodePage && seasons.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Episodes</Text>

            {/* Season Selector */}
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false} 
              style={styles.seasonScroll}
              contentContainerStyle={styles.seasonScrollContent}
            >
              {seasons.map((season) => (
                <TouchableOpacity
                  key={season}
                  style={[
                    styles.seasonButton,
                    selectedSeason === season && styles.seasonButtonActive,
                  ]}
                  onPress={() => setSelectedSeason(season)}
                >
                  <Text
                    style={[
                      styles.seasonButtonText,
                      selectedSeason === season && styles.seasonButtonTextActive,
                    ]}
                  >
                    Season {season}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Episode List */}
            <View style={styles.episodeList}>
              {episodesForSeason.map((episode) => (
                <TouchableOpacity
                  key={`${episode.season}-${episode.episode}`}
                  style={styles.episodeCard}
                  onPress={() => handleEpisodePress(episode)}
                >
                  <Image
                    source={{ uri: episode.thumbnail || content?.poster }}
                    style={styles.episodeThumbnail}
                    contentFit="cover"
                  />
                  <View style={styles.episodeInfo}>
                    <Text style={styles.episodeTitle} numberOfLines={2}>
                      Episode {episode.episode}: {episode.name || `Episode ${episode.episode}`}
                    </Text>
                    {episode.overview && (
                      <Text style={styles.episodeOverview} numberOfLines={2}>
                        {episode.overview}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Direct Website Link for Porn+ / RedTube / PornHub content */}
        {(id?.includes('RedTube') || id?.includes('pornhub') || id?.includes('porn_id')) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Watch on Website</Text>
            <TouchableOpacity
              style={styles.websiteLinkButton}
              onPress={() => {
                let url = '';
                if (id?.includes('RedTube-movie-')) {
                  const videoId = id.split('RedTube-movie-')[1];
                  url = `https://www.redtube.com/${videoId}`;
                } else if (id?.includes('pornhub-')) {
                  const videoId = id.split('pornhub-')[1];
                  url = `https://www.pornhub.com/view_video.php?viewkey=${videoId}`;
                } else if (id?.includes('porn_id:')) {
                  // Try to extract site and ID
                  const parts = id.split(':');
                  if (parts.length >= 2) {
                    const site = parts[1].split('-')[0];
                    const videoId = parts[parts.length - 1];
                    if (site === 'RedTube') {
                      url = `https://www.redtube.com/${videoId}`;
                    }
                  }
                }
                if (url) {
                  Linking.openURL(url).catch(err => console.log('Error opening URL:', err));
                }
              }}
            >
              <Ionicons name="globe-outline" size={22} color="#B8A05C" />
              <View style={styles.websiteLinkContent}>
                <Text style={styles.websiteLinkTitle}>Open in Browser</Text>
                <Text style={styles.websiteLinkSubtitle}>
                  {id?.includes('RedTube') ? 'Watch on RedTube.com' : 
                   id?.includes('pornhub') ? 'Watch on PornHub.com' : 'Watch on source website'}
                </Text>
              </View>
              <Ionicons name="open-outline" size={20} color="#666" />
            </TouchableOpacity>
          </View>
        )}

        {/* Streams Section - For movies, episode pages, OR TV channels */}
        {(type === 'movie' || type === 'tv' || isEpisodePage) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Available Streams</Text>

            {isLoadingStreams ? (
              <View style={styles.streamLoading}>
                <ActivityIndicator size="small" color="#B8A05C" />
                <Text style={styles.streamLoadingText}>Finding streams...</Text>
              </View>
            ) : streams.length === 0 ? (
              <View style={styles.noStreams}>
                <Ionicons name="cloud-offline-outline" size={32} color="#666" />
                <Text style={styles.noStreamsText}>No streams found</Text>
                {/* Show Open in Browser if content ID is a URL or contains a source URL */}
                {(id?.startsWith('http') || id?.includes('RedTube') || id?.includes('pornhub')) && (
                  <TouchableOpacity
                    style={styles.openBrowserButton}
                    onPress={() => {
                      // Extract URL from content ID
                      let url = id;
                      if (id?.includes('RedTube-movie-')) {
                        // Extract RedTube video ID and create URL
                        const videoId = id.split('RedTube-movie-')[1];
                        url = `https://www.redtube.com/${videoId}`;
                      } else if (id?.includes('pornhub-')) {
                        const videoId = id.split('pornhub-')[1];
                        url = `https://www.pornhub.com/view_video.php?viewkey=${videoId}`;
                      }
                      if (url) {
                        Linking.openURL(url).catch(err => console.log('Error opening URL:', err));
                      }
                    }}
                  >
                    <Ionicons name="open-outline" size={18} color="#B8A05C" />
                    <Text style={styles.openBrowserText}>Open in Browser</Text>
                  </TouchableOpacity>
                )}
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
                    >
                      <View style={styles.streamIcon}>
                        <Ionicons name="play" size={18} color="#B8A05C" />
                      </View>
                      <View style={styles.streamInfo}>
                        <Text style={styles.streamSource} numberOfLines={1}>{source}</Text>
                        {details && (
                          <Text style={styles.streamDetails} numberOfLines={2}>{details}</Text>
                        )}
                      </View>
                      <Ionicons name="chevron-forward" size={18} color="#666" />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f11',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f0f11',
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
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroContent: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  logoImage: {
    width: width * 0.7,
    height: 100,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  scrollView: {
    flex: 1,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 16,
  },
  imdbBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  imdbLabel: {
    backgroundColor: '#F5C518',
    color: '#000000',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 2,
  },
  imdbRating: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  metaText: {
    color: '#AAAAAA',
    fontSize: 14,
  },
  libraryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 60,
    marginBottom: 20,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444',
  },
  libraryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  description: {
    fontSize: 15,
    color: '#AAAAAA',
    lineHeight: 24,
    textAlign: 'center',
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  pillContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genrePill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(184, 160, 92, 0.2)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(184, 160, 92, 0.3)',
  },
  genrePillText: {
    color: '#D4C78A',
    fontSize: 13,
  },
  castPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  castPillText: {
    color: '#AAAAAA',
    fontSize: 13,
  },
  directorPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(184, 160, 92, 0.15)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(184, 160, 92, 0.3)',
  },
  directorPillText: {
    color: '#B8A05C',
    fontSize: 13,
    fontWeight: '500',
  },
  seasonScroll: {
    marginBottom: 16,
  },
  seasonScrollContent: {
    gap: 8,
  },
  seasonButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  seasonButtonActive: {
    backgroundColor: '#B8A05C',
    borderColor: '#B8A05C',
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
    gap: 12,
  },
  episodeCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#222',
  },
  episodeThumbnail: {
    width: 130,
    height: 75,
    borderRadius: 6,
    backgroundColor: '#333',
  },
  episodeInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
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
    color: '#666666',
    fontSize: 15,
    marginTop: 8,
  },
  openBrowserButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(184, 160, 92, 0.2)',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#B8A05C',
  },
  openBrowserText: {
    color: '#B8A05C',
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 8,
  },
  websiteLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(184, 160, 92, 0.15)',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(184, 160, 92, 0.3)',
  },
  websiteLinkContent: {
    flex: 1,
    marginLeft: 12,
  },
  websiteLinkTitle: {
    color: '#B8A05C',
    fontSize: 16,
    fontWeight: '600',
  },
  websiteLinkSubtitle: {
    color: '#888',
    fontSize: 13,
    marginTop: 2,
  },
  streamList: {
    gap: 8,
  },
  streamItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#222',
  },
  streamIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(184, 160, 92, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  streamInfo: {
    flex: 1,
  },
  streamSource: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  streamDetails: {
    fontSize: 12,
    color: '#888888',
    marginTop: 2,
  },
  bottomPadding: {
    height: 100,
  },
});
