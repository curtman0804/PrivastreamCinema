import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
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

// Focusable Button Component - reusable for consistent TV focus
function FocusableButton({ 
  onPress, 
  style, 
  focusedStyle,
  children,
  disabled = false,
}: {
  onPress?: () => void;
  style: any;
  focusedStyle?: any;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const [isFocused, setIsFocused] = useState(false);
  
  return (
    <Pressable
      style={[style, isFocused && (focusedStyle || styles.defaultFocused)]}
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      disabled={disabled}
    >
      {children}
    </Pressable>
  );
}

// Focusable Pill Component
function FocusablePill({ 
  onPress, 
  style, 
  textStyle,
  text,
}: {
  onPress?: () => void;
  style: any;
  textStyle: any;
  text: string;
}) {
  const [isFocused, setIsFocused] = useState(false);
  
  return (
    <Pressable
      style={[style, isFocused && styles.pillFocused]}
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      <Text style={textStyle}>{text}</Text>
    </Pressable>
  );
}

// Focusable Stream Item Component
function FocusableStreamItem({ 
  onPress, 
  source,
  details,
}: {
  onPress: () => void;
  source: string;
  details?: string;
}) {
  const [isFocused, setIsFocused] = useState(false);
  
  return (
    <Pressable
      style={[styles.streamItem, isFocused && styles.streamItemFocused]}
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
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
    </Pressable>
  );
}

// Focusable Episode Card Component
function FocusableEpisodeCard({ 
  onPress, 
  episode,
  fallbackPoster,
}: {
  onPress: () => void;
  episode: Episode;
  fallbackPoster?: string;
}) {
  const [isFocused, setIsFocused] = useState(false);
  
  return (
    <Pressable
      style={[styles.episodeCard, isFocused && styles.cardFocused]}
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      <Image
        source={{ uri: episode.thumbnail || fallbackPoster }}
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
    </Pressable>
  );
}

// Focusable Season Button Component
function FocusableSeasonButton({ 
  onPress, 
  season,
  isActive,
}: {
  onPress: () => void;
  season: number;
  isActive: boolean;
}) {
  const [isFocused, setIsFocused] = useState(false);
  
  return (
    <Pressable
      style={[
        styles.seasonButton,
        isActive && styles.seasonButtonActive,
        isFocused && styles.seasonButtonFocused,
      ]}
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      <Text
        style={[
          styles.seasonButtonText,
          isActive && styles.seasonButtonTextActive,
        ]}
      >
        Season {season}
      </Text>
    </Pressable>
  );
}

export default function DetailsScreen() {
  const { 
    type, 
    id: rawId, 
    name: passedName, 
    poster: passedPoster,
    resumeEpisodeId,
    resumePosition,
    resumeSeason,
    resumeEpisode,
  } = useLocalSearchParams<{ 
    type: string; 
    id: string;
    name?: string;
    poster?: string;
    resumeEpisodeId?: string;
    resumePosition?: string;
    resumeSeason?: string;
    resumeEpisode?: string;
  }>();
  const router = useRouter();
  const { 
    streams, 
    isLoadingStreams, 
    fetchStreams, 
    library,
    fetchLibrary,
  } = useContentStore();
  
  const id = rawId ? decodeURIComponent(rawId) : rawId;
  
  const [content, setContent] = useState<ContentItem | null>(null);
  const [isLoadingContent, setIsLoadingContent] = useState(true);
  const [inLibrary, setInLibrary] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);

  const isEpisodePage = id?.includes(':') && !id?.startsWith('porn') && !id?.startsWith('http');
  const baseId = isEpisodePage ? id?.split(':')[0] : id;
  const episodeSeason = isEpisodePage ? parseInt(id?.split(':')[1] || '1') : null;
  const episodeNumber = isEpisodePage ? parseInt(id?.split(':')[2] || '1') : null;

  const currentEpisode = useMemo(() => {
    if (!isEpisodePage || !content?.videos || !episodeSeason || !episodeNumber) return null;
    return content.videos.find(
      ep => ep.season === episodeSeason && ep.episode === episodeNumber
    );
  }, [isEpisodePage, content?.videos, episodeSeason, episodeNumber]);

  const nextEpisode = useMemo(() => {
    if (!isEpisodePage || !content?.videos || !episodeSeason || !episodeNumber) return null;
    
    const sameSeasonNext = content.videos.find(
      ep => ep.season === episodeSeason && ep.episode === episodeNumber + 1
    );
    if (sameSeasonNext) return sameSeasonNext;
    
    const nextSeasonFirst = content.videos.find(
      ep => ep.season === episodeSeason + 1 && ep.episode === 1
    );
    return nextSeasonFirst || null;
  }, [isEpisodePage, content?.videos, episodeSeason, episodeNumber]);

  const seasons = useMemo(() => {
    if (!content?.videos) return [];
    const seasonSet = new Set(content.videos.map(ep => ep.season).filter(s => s > 0));
    return Array.from(seasonSet).sort((a, b) => a - b);
  }, [content?.videos]);

  const episodesForSeason = useMemo(() => {
    if (!content?.videos) return [];
    return content.videos
      .filter(ep => ep.season === selectedSeason)
      .sort((a, b) => a.episode - b.episode);
  }, [content?.videos, selectedSeason]);

  useEffect(() => {
    loadContent();
    fetchLibrary();
    
    if (type && id && (type === 'movie' || type === 'tv' || isEpisodePage)) {
      fetchStreams(type, id);
    }
  }, [id, type]);

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
      const contentId = isEpisodePage ? baseId : id;
      const data = await api.content.getMeta(type!, contentId!);
      setContent(data);
    } catch (error) {
      console.log('Failed to fetch meta:', error);
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
    const subtitleContentId = isEpisodePage 
      ? `${baseId}:${episodeSeason}:${episodeNumber}`
      : (id as string);
    const contentTitle = currentEpisode 
      ? `S${episodeSeason}E${episodeNumber} - ${currentEpisode.name || content?.name || 'Video'}`
      : content?.name || 'Video';
    const cType = type as string || 'movie';
    
    const nextEpisodeData = nextEpisode ? {
      nextEpisodeId: `${baseId}:${nextEpisode.season}:${nextEpisode.episode}`,
      nextEpisodeTitle: `S${nextEpisode.season}E${nextEpisode.episode} - ${nextEpisode.name || 'Next Episode'}`,
      seriesId: baseId || id,
      season: String(episodeSeason),
      episode: String(episodeNumber),
    } : {};
    
    const shouldResume = resumePosition && parseFloat(resumePosition) > 0 && (
      (type === 'movie' && !resumeEpisodeId) ||
      (type === 'series' && resumeEpisodeId === subtitleContentId)
    );
    const resumeData = shouldResume ? { resumePosition } : {};
    
    const buildFallbackUrls = async (): Promise<string[]> => {
      const authToken = await AsyncStorage.getItem('auth_token');
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://firetv-cinema.preview.emergentagent.com';
      
      return streams
        .filter(s => s !== stream)
        .filter(s => s.url && s.url.startsWith('/api/proxy/'))
        .slice(0, 5)
        .map(s => {
          const separator = s.url!.includes('?') ? '&' : '?';
          const tokenParam = authToken ? `${separator}token=${encodeURIComponent(authToken)}` : '';
          return `${backendUrl}${s.url}${tokenParam}`;
        });
    };
    
    try {
      await AsyncStorage.setItem('currentPlaying', JSON.stringify({
        contentType: cType,
        contentId: id,
        title: contentTitle,
      }));
    } catch (e) {
      console.log('[DETAILS] Error saving to AsyncStorage:', e);
    }
    
    // REMOVED: External player launch for streams with externalUrl/requiresWebView
    // All streams now play in the internal player, like Stremio does
    // The user can still manually open in external player via the player controls button
    
    // Handle external URLs - route them to the internal player instead of external browser
    if (stream.externalUrl || stream.requiresWebView) {
      const streamUrl = stream.externalUrl || stream.url;
      console.log('[DETAILS] Playing external URL in internal player:', streamUrl);
      router.push({
        pathname: '/player',
        params: { 
          directUrl: streamUrl,
          title: contentTitle,
          isLive: 'false',
          contentType: cType,
          contentId: subtitleContentId,
          backdrop: content?.background || '',
          poster: content?.poster || '',
          logo: content?.logo || '',
          ...nextEpisodeData,
          ...resumeData,
        },
      });
      return;
    }
    
    if (stream.url && stream.url.startsWith('/api/proxy/')) {
      const authToken = await AsyncStorage.getItem('auth_token');
      const separator = stream.url.includes('?') ? '&' : '?';
      const tokenParam = authToken ? `${separator}token=${encodeURIComponent(authToken)}` : '';
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://firetv-cinema.preview.emergentagent.com';
      const absoluteUrl = `${backendUrl}${stream.url}${tokenParam}`;
      
      const fallbacks = await buildFallbackUrls();
      
      router.push({
        pathname: '/player',
        params: { 
          directUrl: absoluteUrl,
          title: contentTitle,
          isLive: 'false',
          contentType: cType,
          contentId: subtitleContentId,
          fallbackStreams: JSON.stringify([absoluteUrl, ...fallbacks]),
          backdrop: content?.background || '',
          poster: content?.poster || '',
          logo: content?.logo || '',
          ...nextEpisodeData,
          ...resumeData,
        },
      });
      return;
    }
    
    if (stream.infoHash) {
      router.push({
        pathname: '/player',
        params: { 
          infoHash: stream.infoHash,
          title: contentTitle,
          contentType: cType,
          contentId: subtitleContentId,
          fileIdx: stream.fileIdx !== undefined ? String(stream.fileIdx) : '',
          filename: stream.filename || '',
          backdrop: content?.background || '',
          poster: content?.poster || '',
          logo: content?.logo || '',
          ...nextEpisodeData,
          ...resumeData,
        },
      });
    } else if (stream.url) {
      router.push({
        pathname: '/player',
        params: { 
          directUrl: stream.url,
          title: contentTitle,
          isLive: type === 'tv' ? 'true' : 'false',
          contentType: cType,
          contentId: subtitleContentId,
          backdrop: content?.background || '',
          poster: content?.poster || '',
          logo: content?.logo || '',
          ...nextEpisodeData,
          ...resumeData,
        },
      });
    }
  };

  const handleEpisodePress = (episode: Episode) => {
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

  const openWebsiteLink = (contentId: string) => {
    let url = '';
    if (contentId?.includes('RedTube-movie-')) {
      const videoId = contentId.split('RedTube-movie-')[1];
      url = `https://www.redtube.com/${videoId}`;
    } else if (contentId?.includes('pornhub-')) {
      const videoId = contentId.split('pornhub-')[1];
      url = `https://www.pornhub.com/view_video.php?viewkey=${videoId}`;
    } else if (contentId?.includes('porn_id:')) {
      const parts = contentId.split(':');
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
          source={{ uri: (isEpisodePage && currentEpisode?.thumbnail) || content?.background || content?.poster }}
          style={styles.heroImage}
          contentFit="cover"
        />
        <LinearGradient
          colors={['transparent', 'rgba(15,15,17,0.8)', '#0f0f11']}
          style={styles.heroGradient}
        />
        
        {/* Back Button */}
        <FocusableButton 
          style={styles.backButton}
          focusedStyle={styles.backButtonFocused}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </FocusableButton>

        {/* Logo or Title */}
        <View style={styles.heroContent}>
          {isEpisodePage && currentEpisode ? (
            <View>
              <Text style={styles.episodeLabel}>
                S{episodeSeason} E{episodeNumber}
              </Text>
              <Text style={styles.heroTitle}>
                {currentEpisode.name || currentEpisode.title || `Episode ${episodeNumber}`}
              </Text>
              <Text style={styles.seriesTitle}>{content?.name}</Text>
            </View>
          ) : content?.logo ? (
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
        {/* Episode-specific info */}
        {isEpisodePage && currentEpisode && (
          <>
            {currentEpisode.released && (
              <View style={styles.metaRow}>
                <Text style={styles.metaText}>
                  {new Date(currentEpisode.released).toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </Text>
              </View>
            )}
            
            {currentEpisode.overview && (
              <Text style={styles.description}>{currentEpisode.overview}</Text>
            )}
          </>
        )}

        {/* Metadata Row */}
        {(!isEpisodePage || !currentEpisode) && (
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
        )}

        {/* Add to Library Button */}
        <FocusableButton 
          style={styles.libraryButton}
          focusedStyle={styles.libraryButtonFocused}
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
        </FocusableButton>

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
                <FocusablePill 
                  key={i} 
                  style={styles.genrePill}
                  textStyle={styles.genrePillText}
                  text={g}
                  onPress={() => router.push(`/search?q=${encodeURIComponent(g)}`)}
                />
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
                <FocusablePill 
                  key={i} 
                  style={styles.directorPill}
                  textStyle={styles.directorPillText}
                  text={d}
                  onPress={() => router.push(`/search?q=${encodeURIComponent(d)}`)}
                />
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
                <FocusablePill 
                  key={i} 
                  style={styles.castPill}
                  textStyle={styles.castPillText}
                  text={actor}
                  onPress={() => router.push(`/search?q=${encodeURIComponent(actor)}`)}
                />
              ))}
            </View>
          </View>
        )}

        {/* Episodes Section */}
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
                <FocusableSeasonButton
                  key={season}
                  season={season}
                  isActive={selectedSeason === season}
                  onPress={() => setSelectedSeason(season)}
                />
              ))}
            </ScrollView>

            {/* Episode List */}
            <View style={styles.episodeList}>
              {episodesForSeason.map((episode) => (
                <FocusableEpisodeCard
                  key={`${episode.season}-${episode.episode}`}
                  episode={episode}
                  fallbackPoster={content?.poster}
                  onPress={() => handleEpisodePress(episode)}
                />
              ))}
            </View>
          </View>
        )}

        {/* Direct Website Link */}
        {(id?.includes('RedTube') || id?.includes('pornhub') || id?.includes('porn_id')) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Watch on Website</Text>
            <FocusableButton
              style={styles.websiteLinkButton}
              focusedStyle={styles.websiteLinkButtonFocused}
              onPress={() => openWebsiteLink(id!)}
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
            </FocusableButton>
          </View>
        )}

        {/* Streams Section */}
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
                {(id?.startsWith('http') || id?.includes('RedTube') || id?.includes('pornhub')) && (
                  <FocusableButton
                    style={styles.openBrowserButton}
                    focusedStyle={styles.openBrowserButtonFocused}
                    onPress={() => openWebsiteLink(id!)}
                  >
                    <Ionicons name="open-outline" size={18} color="#B8A05C" />
                    <Text style={styles.openBrowserText}>Open in Browser</Text>
                  </FocusableButton>
                )}
              </View>
            ) : (
              <View style={styles.streamList}>
                {streams.map((stream, index) => {
                  const { source, details } = parseStreamInfo(stream);
                  return (
                    <FocusableStreamItem
                      key={index}
                      source={source}
                      details={details}
                      onPress={() => handleStreamSelect(stream)}
                    />
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
    height: height * 0.50,
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
    height: '80%',
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  backButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
  },
  heroContent: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  logoImage: {
    width: width * 0.6,
    height: 80,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  episodeLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#B8A05C',
    textAlign: 'center',
    marginBottom: 4,
  },
  seriesTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#888888',
    textAlign: 'center',
    marginTop: 4,
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
    borderWidth: 2,
    borderColor: '#444',
  },
  libraryButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
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
    borderWidth: 2,
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
    borderWidth: 2,
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
    borderWidth: 2,
    borderColor: 'rgba(184, 160, 92, 0.3)',
  },
  directorPillText: {
    color: '#B8A05C',
    fontSize: 13,
    fontWeight: '500',
  },
  pillFocused: {
    borderColor: '#B8A05C',
    borderWidth: 2,
    backgroundColor: 'rgba(184, 160, 92, 0.4)',
    transform: [{ scale: 1.05 }],
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
    borderWidth: 2,
    borderColor: '#333',
  },
  seasonButtonActive: {
    backgroundColor: '#B8A05C',
    borderColor: '#B8A05C',
  },
  seasonButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.4)',
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
    borderWidth: 2,
    borderColor: '#222',
  },
  cardFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.2)',
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
    borderWidth: 2,
    borderColor: '#B8A05C',
  },
  openBrowserButtonFocused: {
    backgroundColor: 'rgba(184, 160, 92, 0.5)',
    borderColor: '#D4C78A',
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
    borderWidth: 2,
    borderColor: 'rgba(184, 160, 92, 0.3)',
  },
  websiteLinkButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.4)',
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
    borderWidth: 2,
    borderColor: '#222',
  },
  streamItemFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.25)',
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
  defaultFocused: {
    borderColor: '#B8A05C',
    borderWidth: 2,
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
  },
});
