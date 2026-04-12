import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Dimensions,
  Linking,
  FlatList,
  Image as RNImage,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Constants from 'expo-constants';
import { useContentStore, getMetaCache, setMetaCache } from '../../../src/store/contentStore';

// Fallback image for missing posters
const NO_POSTER_IMAGE = require('../../../assets/images/no-poster.png');

import { api, ContentItem, Stream, Episode } from '../../../src/api/client';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width, height } = Dimensions.get('window');

// Focusable Button Component
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

// Clickable chip for genre/cast/director - routes to search
function ChipButton({ label, onPress, hasTVPreferredFocus = false }: { label: string; onPress: () => void; hasTVPreferredFocus?: boolean }) {
  const [isFocused, setIsFocused] = useState(false);
  return (
    <Pressable
      style={[styles.chipButton, isFocused && styles.chipButtonFocused]}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onPress={onPress}
      hasTVPreferredFocus={hasTVPreferredFocus}
    >
      <Text style={[styles.chipText, isFocused && styles.chipTextFocused]}>{label}</Text>
    </Pressable>
  );
}


// Parse stream info helper - used by StreamCard and sorting
function parseStreamInfo(stream: Stream) {
  const name = stream.name || '';
  const title = stream.title || '';
  const combined = `${name} ${title}`.toUpperCase();
  
  // Extract quality
  let quality = 'SD';
  if (name.includes('4K') || name.includes('2160') || title.includes('2160')) quality = '4K';
  else if (name.includes('1080') || title.includes('1080')) quality = '1080p';
  else if (name.includes('720') || title.includes('720')) quality = '720p';
  else if (name.toUpperCase().includes('HD') && !name.toUpperCase().includes('SD')) quality = 'HD';
  
  // Extract source
  let source = stream.addon || 'Unknown';
  if (stream.provider) {
    source = stream.provider;
  } else if (name.includes('TPB') || name.includes('🏴‍☠️')) source = 'TPB+';
  else if (name.includes('⚡') || name.includes('Torrentio')) source = 'Torrentio';
  else if (name.includes('EZTV')) source = 'EZTV';
  else if (name.includes('YTS') || name.includes('YIFY')) source = 'YTS';
  
  // Extract size from title
  let size = '';
  const sizeMatch = title.match(/💾\s*([\d.]+\s*[GM]B)/i);
  if (sizeMatch) size = sizeMatch[1];
  if (!size) {
    const sizeMatch2 = title.match(/([\d.]+)\s*(GB|MB)/i);
    if (sizeMatch2) size = `${sizeMatch2[1]} ${sizeMatch2[2].toUpperCase()}`;
  }
  
  // Extract seeders
  let seeders = stream.seeders || 0;
  if (!seeders) {
    const seederMatch = title.match(/👤\s*(\d+)/);
    if (seederMatch) seeders = parseInt(seederMatch[1], 10);
  }
  if (!seeders) {
    const peerMatch = title.match(/🌱\s*(\d+)/);
    if (peerMatch) seeders = parseInt(peerMatch[1], 10);
  }
  
  // Detect language
  const FOREIGN_KEYWORDS = [
    'FRENCH', 'TRUEFRENCH', 'VFF', 'VFQ', 'VOSTFR',
    'SPANISH', 'LATINO', 'CASTELLANO',
    'GERMAN', 'DEUTSCH',
    'ITALIAN', 'ITALIANO',
    'RUSSIAN', 'DUBBED', 'DUBLADO',
    'PORTUGUESE', 'HINDI', 'TAMIL', 'TELUGU',
    'KOREAN', 'JAPANESE', 'CHINESE', 'MANDARIN',
    'TURKISH', 'ARABIC', 'POLISH', 'DUTCH', 'CZECH',
    'THAI', 'INDONESIAN', 'VIETNAMESE', 'SWEDISH',
    'MULTI',
  ];
  const FOREIGN_FLAGS = ['🇫🇷', '🇪🇸', '🇲🇽', '🇧🇷', '🇩🇪', '🇮🇹', '🇷🇺', '🇵🇹', '🇵🇱', '🇳🇱', '🇨🇳', '🇯🇵', '🇰🇷', '🇮🇳', '🇹🇷'];
  const HAS_ENGLISH = combined.includes('ENGLISH') || combined.includes('🇬🇧') || combined.includes('🇺🇸') || combined.includes('EN/') || combined.includes('/EN');
  
  let language = 'ENG';
  let isForeign = false;
  
  for (const kw of FOREIGN_KEYWORDS) {
    if (combined.includes(kw)) {
      isForeign = true;
      if (kw.includes('FRENCH') || kw === 'VFF' || kw === 'VFQ' || kw === 'VOSTFR' || kw === 'TRUEFRENCH') language = 'FRE';
      else if (kw.includes('SPANISH') || kw === 'LATINO' || kw === 'CASTELLANO') language = 'SPA';
      else if (kw.includes('GERMAN') || kw === 'DEUTSCH') language = 'GER';
      else if (kw.includes('ITALIAN') || kw === 'ITALIANO') language = 'ITA';
      else if (kw.includes('RUSSIAN')) language = 'RUS';
      else if (kw.includes('HINDI')) language = 'HIN';
      else if (kw === 'DUBBED' || kw === 'DUBLADO') language = 'DUB';
      else if (kw === 'MULTI') language = 'MULTI';
      else language = 'OTHER';
      break;
    }
  }
  for (const flag of FOREIGN_FLAGS) {
    if (title.includes(flag) || name.includes(flag)) {
      isForeign = true;
      if (flag === '🇫🇷') language = 'FRE';
      else if (flag === '🇪🇸' || flag === '🇲🇽') language = 'SPA';
      else if (flag === '🇩🇪') language = 'GER';
      else if (flag === '🇮🇹') language = 'ITA';
      else if (flag === '🇷🇺') language = 'RUS';
      else if (flag === '🇮🇳') language = 'HIN';
      else language = 'OTHER';
      break;
    }
  }
  
  if (HAS_ENGLISH && isForeign) language = 'MULTI';
  if (HAS_ENGLISH && !isForeign) language = 'ENG';
  
  return { quality, source, size, seeders, title, language, isForeign };
}

// Sort streams: English first (by seeds desc), then other languages (by seeds desc)
function sortStreamsByLanguage(streams: Stream[]): Stream[] {
  // Parse all stream info first
  const parsed = streams.map(s => ({ stream: s, info: parseStreamInfo(s) }));
  
  // Language priority: ENG > MULTI > everything else alphabetically
  const langPriority = (lang: string): number => {
    if (lang === 'ENG') return 0;
    if (lang === 'MULTI') return 1;
    return 2;
  };
  
  // Sort: RD-compatible (torrent) first, then by language priority, then seeders desc
  parsed.sort((a, b) => {
    // Torrents (infoHash) go through RD — prioritize them
    const rdA = a.stream.infoHash ? 0 : 1;
    const rdB = b.stream.infoHash ? 0 : 1;
    if (rdA !== rdB) return rdA - rdB;
    
    const langA = langPriority(a.info.language);
    const langB = langPriority(b.info.language);
    if (langA !== langB) return langA - langB;
    // Same language group - sort by language name then seeds
    if (a.info.language !== b.info.language) return a.info.language.localeCompare(b.info.language);
    return (b.info.seeders || 0) - (a.info.seeders || 0);
  });
  
  return parsed.map(p => p.stream);
}

// Stream Card Component - 3-row vertical layout
function StreamCard({ 
  stream, 
  onPress 
}: { 
  stream: Stream; 
  onPress: () => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const { quality, source, size, seeders, language, isForeign } = parseStreamInfo(stream);
  const isRD = !!stream.infoHash; // Torrent streams go through Real-Debrid
  
  return (
    <Pressable
      style={[styles.streamCard, isFocused && styles.streamCardFocused]}
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      {/* Row 1: Source + RD badge */}
      <View style={styles.streamSourceRow}>
        <Text style={styles.streamSource} numberOfLines={1}>{source}</Text>
        {isRD && (
          <View style={styles.rdBadge}>
            <Text style={styles.rdBadgeText}>RD</Text>
          </View>
        )}
      </View>
      
      {/* Row 2: Seeds + Size */}
      <View style={styles.streamStatsRow}>
        {seeders > 0 && (
          <View style={styles.streamStat}>
            <Ionicons name="people" size={13} color="#aaa" />
            <Text style={styles.streamStatText}>{seeders.toLocaleString()}</Text>
          </View>
        )}
        {size ? (
          <View style={styles.streamStat}>
            <Ionicons name="download-outline" size={13} color="#aaa" />
            <Text style={styles.streamStatText}>{size}</Text>
          </View>
        ) : null}
      </View>
      
      {/* Row 3: Language + Quality + Play Button */}
      <View style={styles.streamCardFooter}>
        <View style={styles.streamBadgeRow}>
          <View style={[
            styles.langBadge, 
            isForeign ? styles.langBadgeForeign : styles.langBadgeEnglish
          ]}>
            <Text style={[
              styles.langBadgeText,
              isForeign ? styles.langBadgeTextForeign : styles.langBadgeTextEnglish
            ]}>{language}</Text>
          </View>
          <View style={[styles.qualityBadge, quality === '4K' && styles.qualityBadge4K]}>
            <Text style={styles.qualityText}>{quality}</Text>
          </View>
        </View>
        <Ionicons name="play-circle" size={22} color="#B8A05C" />
      </View>
    </Pressable>
  );
}

// Episode Card Component
// Placeholder component for missing posters/thumbnails
function ComingSoonPlaceholder({ width, height }: { width: number | string; height: number | string }) {
  return (
    <RNImage
      source={NO_POSTER_IMAGE}
      style={{ width: width as any, height: height as any }}
      resizeMode="cover"
    />
  );
}

function EpisodeCard({ 
  episode, 
  fallbackPoster, 
  onPress,
  isWatched,
  onMarkUnwatched,
}: { 
  episode: Episode; 
  fallbackPoster?: string;
  onPress: () => void;
  isWatched?: boolean;
  onMarkUnwatched?: () => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const [thumbError, setThumbError] = useState(false);
  const thumbUri = episode.thumbnail || fallbackPoster;
  
  return (
    <Pressable
      style={[styles.episodeCard, isFocused && styles.episodeCardFocused]}
      onPress={onPress}
      onLongPress={isWatched ? onMarkUnwatched : undefined}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      delayLongPress={600}
    >
      <View style={{ position: 'relative' }}>
        {thumbUri && !thumbError ? (
          <Image
            source={{ uri: thumbUri }}
            style={styles.episodeThumbnail}
            contentFit="cover"
            onError={() => setThumbError(true)}
          />
        ) : (
          <ComingSoonPlaceholder width="100%" height={90} />
        )}
        {isWatched && (
          <View style={styles.watchedBadge}>
            <Ionicons name="checkmark" size={14} color="#B8A05C" />
          </View>
        )}
      </View>
      <View style={styles.episodeInfo}>
        <Text style={styles.episodeTitle} numberOfLines={2}>
          E{episode.episode}: {episode.name || `Episode ${episode.episode}`}
        </Text>
      </View>
    </Pressable>
  );
}

export default function DetailsScreen() {
  const { 
    type, 
    id: rawId, 
    resumeEpisodeId,
    resumePosition,
    resumeSeason,
    resumeEpisode,
    // Display data passed via route params for INSTANT rendering
    name: paramName, poster: paramPoster,
    autoPlay: autoPlayParam,
  } = useLocalSearchParams<{ 
    type: string; 
    id: string;
    resumeEpisodeId?: string;
    resumePosition?: string;
    resumeSeason?: string;
    resumeEpisode?: string;
    name?: string; poster?: string;
    autoPlay?: string;
  }>();
  const router = useRouter();
  
  // Use zustand SELECTORS — only re-render when these specific fields change
  // This prevents re-renders from unrelated store changes (discover data, addons, etc.)
  const streams = useContentStore(s => s.streams);
  const isLoadingStreams = useContentStore(s => s.isLoadingStreams);
  const fetchStreams = useContentStore(s => s.fetchStreams);
  const library = useContentStore(s => s.library);
  const fetchLibrary = useContentStore(s => s.fetchLibrary);
  
  const id = rawId ? decodeURIComponent(rawId) : rawId;
  
  // Try meta cache first (instant), then route params, then bare minimum
  const cachedMeta = id ? getMetaCache(id) : null;
  const initialContent: ContentItem = cachedMeta || {
    id: id!,
    imdb_id: id,
    name: paramName || '',
    type: type as 'movie' | 'series',
    poster: paramPoster || '',
  };
  
  const [content, setContent] = useState<ContentItem | null>(initialContent);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [inLibrary, setInLibrary] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [watchedEpisodes, setWatchedEpisodes] = useState<Record<string, boolean>>({});
  const autoPlayTriggeredRef = useRef(false);

  const isEpisodePage = type !== 'tv' && id?.includes(':') && !id?.startsWith('porn') && !id?.startsWith('http');
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
    // If we have cached meta with background, skip the meta fetch entirely
    const hasCachedMeta = cachedMeta && cachedMeta.background;
    if (!hasCachedMeta) {
      // Only fetch meta for series (need episodes) or if missing background
      const needsMeta = type === 'series' || !content?.background;
      if (needsMeta) {
        loadContent();
      }
    }
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

  // Load watched episodes from AsyncStorage — reload on EVERY screen focus
  // so checkmarks appear immediately after returning from the player
  useFocusEffect(
    useCallback(() => {
      const loadWatched = async () => {
        try {
          const data = await AsyncStorage.getItem('privastream_watched');
          if (data) setWatchedEpisodes(JSON.parse(data));
        } catch (e) {
          console.log('[DETAILS] Error loading watched data:', e);
        }
      };
      loadWatched();
    }, [])
  );

  // AUTO-PLAY: When navigated from "Play Next", auto-select best stream
  useEffect(() => {
    if (autoPlayParam === 'true' && !autoPlayTriggeredRef.current && streams && streams.length > 0 && !isLoadingStreams) {
      autoPlayTriggeredRef.current = true;
      const sorted = sortStreamsByLanguage(streams);
      const bestStream = sorted[0];
      if (bestStream) {
        console.log('[AUTOPLAY] Auto-selecting best stream:', bestStream.infoHash || bestStream.title);
        // Small delay to ensure component is mounted
        setTimeout(() => handleStreamSelect(bestStream), 300);
      }
    }
  }, [streams, isLoadingStreams, autoPlayParam]);

  // PRE-WARM: When streams are loaded, silently pre-start the top ENGLISH torrent
  // This saves 5-10 seconds of metadata download when user taps play
  const prewarmedRef = useRef<string | null>(null);
  useEffect(() => {
    if (streams && streams.length > 0 && !isLoadingStreams) {
      // Find the best English stream to prewarm (highest seeders)
      const sorted = sortStreamsByLanguage(streams);
      const topStream = sorted[0]; // English first, highest seeders
      if (topStream?.infoHash && topStream.infoHash !== prewarmedRef.current) {
        prewarmedRef.current = topStream.infoHash;
        console.log(`[PREWARM] Pre-warming top English stream: ${topStream.infoHash} (${topStream.title || topStream.name})`);
        // Pass tracker sources from Torrentio for better peer discovery during prewarm
        api.stream.prewarm(topStream.infoHash, topStream.sources || []);
      }
    }
  }, [streams, isLoadingStreams]);

  const loadContent = async () => {
    try {
      const contentId = isEpisodePage ? baseId : id;
      const data = await api.content.getMeta(type!, contentId!);
      // Cache the meta data for instant re-access
      if (contentId) setMetaCache(contentId, data);
      setContent(data);
    } catch (error) {
      console.log('Failed to fetch meta:', error);
      // Keep using the initial content from params — already set
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
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || Constants.expoConfig?.extra?.backendUrl || '';
      
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
    
    // Handle external URLs - route them to the internal player
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
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || Constants.expoConfig?.extra?.backendUrl || '';
      const absoluteUrl = `${backendUrl}${stream.url}${tokenParam}`;
      
      // Build fallback URLs - include other proxy streams + direct URLs
      const fallbacks = await buildFallbackUrls();
      
      // Also include direct URLs from USAATV streams as fallbacks
      const directFallbacks = streams
        .filter(s => s !== stream && (s.directUrl || (s.url && !s.url.startsWith('/api/proxy/'))))
        .map(s => s.directUrl || s.url)
        .filter(Boolean);
      
      router.push({
        pathname: '/player',
        params: { 
          directUrl: absoluteUrl,
          title: contentTitle,
          isLive: type === 'tv' ? 'true' : 'false',
          contentType: cType,
          contentId: subtitleContentId,
          fallbackStreams: JSON.stringify([absoluteUrl, ...fallbacks, ...directFallbacks]),
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
      // Build fallback torrents from other available torrent streams (sorted by seeders)
      const sortedStreams = sortStreamsByLanguage(streams);
      const fallbackTorrents = sortedStreams
        .filter(s => s.infoHash && s.infoHash !== stream.infoHash)
        .slice(0, 5)
        .map(s => ({
          infoHash: s.infoHash,
          fileIdx: s.fileIdx,
          filename: s.filename || '',
          sources: s.sources || [],
          name: s.name || '',
          title: s.title || '',
        }));
      
      // Extract season/episode from content ID (e.g. tt123:1:2 → season=1, episode=2)
      const idParts = (id || '').split(':');
      const seasonNum = idParts.length >= 3 ? idParts[idParts.length - 2] : '';
      const episodeNum = idParts.length >= 3 ? idParts[idParts.length - 1] : '';
      
      router.push({
        pathname: '/player',
        params: { 
          infoHash: stream.infoHash,
          title: contentTitle,
          contentType: cType,
          contentId: subtitleContentId,
          fileIdx: stream.fileIdx !== undefined ? String(stream.fileIdx) : '',
          filename: stream.filename || '',
          season: seasonNum,
          episode: episodeNum,
          backdrop: content?.background || '',
          poster: content?.poster || '',
          logo: content?.logo || '',
          sources: stream.sources ? JSON.stringify(stream.sources) : '',
          fallbackTorrents: fallbackTorrents.length > 0 ? JSON.stringify(fallbackTorrents) : '',
          ...nextEpisodeData,
          ...resumeData,
        },
      });
    } else if (stream.url) {
      // === PRIVACY PROXY ===
      // Route ALL direct URLs through backend's RD unrestrict proxy
      // so the device NEVER connects to content sites (redtube, etc.)
      // ISP only sees traffic to real-debrid.com
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || Constants.expoConfig?.extra?.backendUrl || '';
      const authToken = await AsyncStorage.getItem('auth_token');
      
      // Check if URL is already a backend/proxy URL (no need to re-proxy)
      const isAlreadyProxied = stream.url.startsWith('/api/') || 
                                stream.url.startsWith(backendUrl) ||
                                stream.url.includes('/api/proxy/');
      
      let streamUrl: string;
      if (isAlreadyProxied) {
        // Already going through our backend — use as-is
        streamUrl = stream.url;
      } else {
        // External URL — route through RD privacy proxy
        const encodedUrl = encodeURIComponent(stream.url);
        const tokenParam = authToken ? `&token=${encodeURIComponent(authToken)}` : '';
        streamUrl = `${backendUrl}/api/proxy/unrestrict-stream?url=${encodedUrl}${tokenParam}`;
        console.log('[DETAILS] Privacy proxy: routing through RD unrestrict');
      }
      
      // Build fallback URLs — also route fallbacks through privacy proxy
      const allStreamUrls = streams
        .filter(s => s.url && !s.infoHash && s.url !== stream.url)
        .map(s => {
          if (!s.url) return '';
          const isProxied = s.url.startsWith('/api/') || s.url.startsWith(backendUrl);
          if (isProxied) return s.url;
          const enc = encodeURIComponent(s.url);
          const tp = authToken ? `&token=${encodeURIComponent(authToken)}` : '';
          return `${backendUrl}/api/proxy/unrestrict-stream?url=${enc}${tp}`;
        })
        .filter(Boolean);
      
      // For live TV streams, also include proxy URLs as additional fallbacks
      if (type === 'tv') {
        const proxyFallbacks = streams
          .filter(s => s.proxyUrl)
          .map(s => {
            const tokenParam = authToken ? `&token=${encodeURIComponent(authToken)}` : '';
            return `${backendUrl}${s!.proxyUrl}${tokenParam}`;
          })
          .filter(Boolean);
        
        allStreamUrls.push(...proxyFallbacks);
      }
      
      router.push({
        pathname: '/player',
        params: { 
          directUrl: streamUrl,
          title: contentTitle,
          isLive: type === 'tv' ? 'true' : 'false',
          contentType: cType,
          contentId: subtitleContentId,
          fallbackStreams: allStreamUrls.length > 0 ? JSON.stringify(allStreamUrls) : '',
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
      // Refresh library immediately so the Library tab updates in real-time
      fetchLibrary(true);
    } catch (error) {
      console.log('Failed to toggle library:', error);
    }
  };

  // Use content data for display - available immediately from store
  const displayName = content?.name || 'Loading...';
  // For episode pages, prefer the episode thumbnail as backdrop. Otherwise use series backdrop.
  const episodeBackdrop = isEpisodePage && currentEpisode?.thumbnail ? currentEpisode.thumbnail : null;
  const displayPoster = episodeBackdrop || content?.background || content?.poster || '';

  const rating = typeof content?.imdbRating === 'string' 
    ? parseFloat(content.imdbRating) 
    : content?.imdbRating;

  // Render stream item for FlatList
  const renderStreamItem = ({ item }: { item: Stream }) => (
    <StreamCard stream={item} onPress={() => handleStreamSelect(item)} />
  );

  // Mark episode as unwatched (long-press)
  const handleMarkUnwatched = useCallback(async (contentId: string) => {
    try {
      const watchedKey = 'privastream_watched';
      const existing = await AsyncStorage.getItem(watchedKey);
      const watchedSet: Record<string, boolean> = existing ? JSON.parse(existing) : {};
      delete watchedSet[contentId];
      await AsyncStorage.setItem(watchedKey, JSON.stringify(watchedSet));
      setWatchedEpisodes({ ...watchedSet });
      console.log('[DETAILS] Unmarked as watched:', contentId);
    } catch (e) {
      console.log('[DETAILS] Error unmarking watched:', e);
    }
  }, []);

  // Render episode item for FlatList
  const renderEpisodeItem = ({ item }: { item: Episode }) => {
    // Check watched status using series:season:episode format
    const epContentId = `${baseId || id}:${item.season}:${item.episode}`;
    const epWatched = !!watchedEpisodes[epContentId];
    return (
      <EpisodeCard 
        episode={item} 
        fallbackPoster={content?.poster}
        onPress={() => handleEpisodePress(item)}
        isWatched={epWatched}
        onMarkUnwatched={() => handleMarkUnwatched(epContentId)}
      />
    );
  };

  return (
    <View style={styles.container}>
      {/* Background Image — lightweight RN Image, no expo-image overhead */}
      {displayPoster ? (
        <RNImage
          source={{ uri: displayPoster }}
          style={styles.backgroundImage}
          resizeMode="cover"
        />
      ) : null}
      
      {/* Dark overlay — simple View, no LinearGradient overhead */}
      <View style={styles.gradientOverlay} />
      
      {/* Auto-play loading overlay */}
      {autoPlayParam === 'true' && !autoPlayTriggeredRef.current && (
        <View style={styles.autoPlayOverlay}>
          <ActivityIndicator size="large" color="#B8A05C" />
          <Text style={styles.autoPlayText}>Loading next episode...</Text>
        </View>
      )}
      
      {/* Content Overlay */}
      <View style={styles.contentOverlay}>
        {/* Back Button - floats over everything */}
        <FocusableButton 
          style={styles.backButton}
          focusedStyle={styles.backButtonFocused}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </FocusableButton>

        {/* Fixed Title Area - never moves */}
        <View style={styles.fixedTitleArea}>
          <View style={styles.titleSection}>
            {content?.logo ? (
              <Image
                source={{ uri: content.logo }}
                style={styles.logoImage}
                contentFit="contain"
              />
            ) : (
              <Text style={styles.title}>{displayName}</Text>
            )}
            
            {isEpisodePage && currentEpisode && (
              <Text style={styles.episodeSubtitle}>
                S{episodeSeason} E{episodeNumber} - {currentEpisode.name || `Episode ${episodeNumber}`}
              </Text>
            )}
          </View>

          <View style={styles.metaRow}>
            {rating && rating > 0 && (
              <View style={styles.imdbBadge}>
                <Text style={styles.imdbLabel}>IMDb</Text>
                <Text style={styles.imdbRating}>{rating.toFixed(1)}</Text>
              </View>
            )}
            {content?.year && (
              <Text style={styles.metaText}>{content.year}</Text>
            )}
            {content?.runtime && (
              <Text style={styles.metaText}>{content.runtime}</Text>
            )}
          </View>

          {/* Description - on episode pages show episode overview instead of series description */}
          {isEpisodePage && currentEpisode?.overview ? (
            <Text style={styles.fixedDescription} numberOfLines={4}>
              {currentEpisode.overview}
            </Text>
          ) : content?.description ? (
            <Text style={styles.fixedDescription} numberOfLines={3}>
              {content.description}
            </Text>
          ) : null}

          {/* Add to Library - under description */}
          <View style={styles.fixedActionRow}>
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
          </View>
        </View>

        {/* Scrollable Content - everything below the pinned area */}
        <ScrollView 
          style={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContentContainer}
        >
          {/* Genre */}
          {content?.genre && Array.isArray(content.genre) && content.genre.length > 0 && (
            <View style={styles.chipSection}>
              <Text style={styles.chipLabel}>Genre</Text>
              <View style={styles.chipRow}>
                {content.genre.slice(0, 4).map((g: string, i: number) => (
                  <ChipButton key={`genre-${i}`} label={g} hasTVPreferredFocus={i === 0} onPress={() => router.push({ pathname: '/(tabs)/search', params: { q: g } })} />
                ))}
              </View>
            </View>
          )}

          {/* Director */}
          {content?.director && Array.isArray(content.director) && content.director.length > 0 && (
            <View style={styles.chipSection}>
              <Text style={styles.chipLabel}>Director</Text>
              <View style={styles.chipRow}>
                {content.director.slice(0, 3).map((d: string, i: number) => (
                  <ChipButton key={`dir-${i}`} label={d} onPress={() => router.push({ pathname: '/(tabs)/search', params: { q: d } })} />
                ))}
              </View>
            </View>
          )}

          {/* Cast */}
          {content?.cast && Array.isArray(content.cast) && content.cast.length > 0 && (
            <View style={styles.chipSection}>
              <Text style={styles.chipLabel}>Cast</Text>
              <View style={styles.chipRow}>
                {content.cast.slice(0, 6).map((c: string, i: number) => (
                  <ChipButton key={`cast-${i}`} label={c} onPress={() => router.push({ pathname: '/(tabs)/search', params: { q: c } })} />
                ))}
              </View>
            </View>
          )}

          {/* Season Selector for Series */}
          {type === 'series' && !isEpisodePage && seasons.length > 0 && (
            <View style={styles.seasonSection}>
              <Text style={styles.sectionTitle}>Episodes</Text>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                style={styles.seasonSelector}
              >
                {seasons.map((season, idx) => (
                  <FocusableButton
                    key={season}
                    style={[
                      styles.seasonButton,
                      selectedSeason === season && styles.seasonButtonActive,
                    ]}
                    focusedStyle={styles.seasonButtonFocused}
                    onPress={() => setSelectedSeason(season)}
                  >
                    <Text style={[
                      styles.seasonButtonText,
                      selectedSeason === season && styles.seasonButtonTextActive,
                    ]}>
                      Season {season}
                    </Text>
                  </FocusableButton>
                ))}
              </ScrollView>
              
              {/* Episodes List */}
              <FlatList
                data={episodesForSeason}
                renderItem={renderEpisodeItem}
                keyExtractor={(item) => `${item.season}-${item.episode}`}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.episodesList}
              />
            </View>
          )}

          {/* Streams Section - Stremio Style */}
          {(type === 'movie' || type === 'tv' || isEpisodePage) && (
            <View style={styles.streamsSection}>
              <Text style={styles.sectionTitle}>
                {isLoadingStreams ? (type === 'tv' ? 'Verifying Live Streams...' : 'Finding Streams...') : `${streams.length} Stream${streams.length !== 1 ? 's' : ''} Available`}
              </Text>
              
              {isLoadingStreams ? (
                <View style={styles.streamLoading}>
                  <ActivityIndicator size="small" color="#B8A05C" />
                  <Text style={styles.streamLoadingText}>
                    {type === 'tv' ? 'Checking available channels...' : 'Searching sources...'}
                  </Text>
                </View>
              ) : streams.length === 0 ? (
                <View style={styles.noStreams}>
                  <Ionicons name="cloud-offline-outline" size={32} color="#666" />
                  <Text style={styles.noStreamsText}>No streams found</Text>
                </View>
              ) : (
                <FlatList
                  data={sortStreamsByLanguage(streams)}
                  renderItem={renderStreamItem}
                  keyExtractor={(item, index) => `${item.infoHash || item.url || index}`}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.streamsList}
                />
              )}
            </View>
          )}
          
          {/* Bottom padding */}
          <View style={{ height: 100 }} />
        </ScrollView>
      </View>
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
  backgroundImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: width,
    height: height,
  },
  gradientOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 15, 17, 0.75)',
  },
  autoPlayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 15, 17, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  autoPlayText: {
    color: '#B8A05C',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  contentOverlay: {
    flex: 1,
  },
  backButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 30,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  backButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
  },
  scrollContent: {
    flex: 1,
  },
  scrollContentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  fixedTitleArea: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  fixedDescription: {
    fontSize: 13,
    color: '#D4BC78',
    lineHeight: 19,
    marginBottom: 8,
  },
  fixedActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
  },
  titleSection: {
    marginBottom: 8,
    alignItems: 'flex-start',
  },
  logoImage: {
    width: width * 0.6,
    height: 80,
    alignSelf: 'flex-start',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#B8A05C',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
    textAlign: 'left',
  },
  episodeSubtitle: {
    fontSize: 16,
    color: '#B8A05C',
    marginTop: 8,
    textAlign: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 8,
  },
  imdbBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(245, 197, 24, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
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
    color: '#F5C518',
    fontSize: 14,
    fontWeight: '600',
  },
  metaText: {
    color: '#AAAAAA',
    fontSize: 14,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  libraryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  libraryButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
  },
  libraryButtonText: {
    color: '#B8A05C',
    fontSize: 14,
    fontWeight: '600',
  },
  description: {
    fontSize: 14,
    color: '#D4BC78',
    lineHeight: 22,
    marginBottom: 16,
    textAlign: 'left',
  },
  castText: {
    fontSize: 13,
    color: '#888888',
    marginBottom: 24,
    textAlign: 'center',
  },
  chipSection: {
    marginBottom: 16,
    alignItems: 'flex-start',
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888888',
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 8,
    marginBottom: 4,
  },
  chipScroll: {
    marginBottom: 4,
  },
  chipScrollContent: {
    gap: 8,
    paddingRight: 16,
  },
  chipButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  chipButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
    transform: [{ scale: 1.1 }],
  },
  chipText: {
    color: '#AAAAAA',
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextFocused: {
    color: '#FFFFFF',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#B8A05C',
    marginBottom: 12,
  },
  seasonSection: {
    marginBottom: 24,
  },
  seasonSelector: {
    marginBottom: 16,
    paddingVertical: 4,
  },
  seasonButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  seasonButtonActive: {
    backgroundColor: '#B8A05C',
  },
  seasonButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
  },
  seasonButtonText: {
    color: '#AAAAAA',
    fontSize: 13,
    fontWeight: '600',
  },
  seasonButtonTextActive: {
    color: '#000000',
  },
  episodesList: {
    gap: 12,
  },
  episodeCard: {
    width: 160,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  episodeCardFocused: {
    borderColor: '#B8A05C',
  },
  episodeThumbnail: {
    width: '100%',
    height: 90,
    backgroundColor: '#333',
  },
  episodeInfo: {
    padding: 8,
  },
  episodeTitle: {
    fontSize: 12,
    color: '#B8A05C',
    fontWeight: '500',
  },
  watchedBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  streamsSection: {
    marginBottom: 24,
  },
  streamLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 20,
  },
  streamLoadingText: {
    color: '#AAAAAA',
    fontSize: 14,
  },
  noStreams: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  noStreamsText: {
    color: '#666666',
    fontSize: 14,
    marginTop: 8,
  },
  streamsList: {
    gap: 12,
    paddingVertical: 8,
  },
  streamCard: {
    width: 160,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'space-between',
  },
  streamCardFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.2)',
  },
  streamSource: {
    fontSize: 14,
    fontWeight: '700',
    color: '#B8A05C',
    flex: 1,
  },
  streamSourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  rdBadge: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 6,
  },
  rdBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  streamStatsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  qualityBadge: {
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  qualityBadge4K: {
    backgroundColor: 'rgba(184, 160, 92, 0.6)',
  },
  qualityText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#B8A05C',
  },
  langBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  langBadgeEnglish: {
    backgroundColor: 'rgba(76, 175, 80, 0.3)',
  },
  langBadgeForeign: {
    backgroundColor: 'rgba(244, 67, 54, 0.3)',
  },
  langBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  langBadgeTextEnglish: {
    color: '#4CAF50',
  },
  langBadgeTextForeign: {
    color: '#F44336',
  },
  streamStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  streamStatText: {
    fontSize: 12,
    color: '#aaaaaa',
    fontWeight: '500',
  },
  streamCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  streamBadgeRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  defaultFocused: {
    borderColor: '#B8A05C',
    borderWidth: 2,
  },
});
