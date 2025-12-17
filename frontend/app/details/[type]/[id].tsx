import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useContentStore } from '../../../src/store/contentStore';
import { StreamList } from '../../../src/components/StreamList';
import { api, ContentItem, Stream } from '../../../src/api/client';

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
  const [showStreams, setShowStreams] = useState(false);
  const [inLibrary, setInLibrary] = useState(false);

  useEffect(() => {
    loadContent();
    fetchLibrary();
  }, [id, type]);

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
      // Create minimal content object
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

  const handlePlayPress = async () => {
    setShowStreams(true);
    await fetchStreams(type!, id!);
  };

  const handleStreamSelect = (stream: Stream) => {
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
      // Torrent stream - show magnet link options
      const magnetLink = `magnet:?xt=urn:btih:${stream.infoHash}&dn=${encodeURIComponent(content?.name || 'Video')}`;
      
      // Add common trackers
      const trackers = [
        'udp://tracker.opentrackr.org:1337/announce',
        'udp://open.stealth.si:80/announce',
        'udp://tracker.torrent.eu.org:451/announce',
        'udp://tracker.coppersurfer.tk:6969/announce',
      ];
      const magnetWithTrackers = magnetLink + trackers.map(t => `&tr=${encodeURIComponent(t)}`).join('');
      
      Alert.alert(
        'Torrent Stream',
        `Found: ${stream.title?.split('\n')[0] || stream.name}\n\nTo play this stream:\n\n1. Use a torrent streaming app (Stremio, VLC with torrent plugin)\n2. Or use a debrid service (Real-Debrid, Premiumize)\n3. Or copy the magnet link to a torrent client`,
        [
          { 
            text: 'Copy Magnet Link', 
            onPress: async () => {
              try {
                const Clipboard = await import('expo-clipboard');
                await Clipboard.setStringAsync(magnetWithTrackers);
                Alert.alert('Copied!', 'Magnet link copied to clipboard');
              } catch (e) {
                console.log('Clipboard error:', e);
              }
            }
          },
          { text: 'Cancel', style: 'cancel' }
        ]
      );
    } else {
      Alert.alert('Error', 'This stream cannot be played directly');
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
      {/* Header Image */}
      <View style={styles.headerContainer}>
        <Image
          source={{ uri: content?.background || content?.poster }}
          style={styles.headerImage}
          contentFit="cover"
        />
        <LinearGradient
          colors={['transparent', 'rgba(12, 12, 12, 0.8)', '#0c0c0c']}
          style={styles.gradient}
        />
        <SafeAreaView style={styles.headerOverlay}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </SafeAreaView>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.contentContainer}>
          {/* Poster and Info */}
          <View style={styles.mainInfo}>
            <Image
              source={{ uri: content?.poster }}
              style={styles.poster}
              contentFit="cover"
            />
            <View style={styles.infoContainer}>
              <Text style={styles.title}>{content?.name}</Text>
              <View style={styles.metaRow}>
                {content?.year && (
                  <Text style={styles.metaText}>{content.year}</Text>
                )}
                {content?.runtime && (
                  <>
                    <Text style={styles.metaDot}>•</Text>
                    <Text style={styles.metaText}>{content.runtime}</Text>
                  </>
                )}
                {rating && rating > 0 && (
                  <>
                    <Text style={styles.metaDot}>•</Text>
                    <View style={styles.ratingContainer}>
                      <Ionicons name="star" size={14} color="#FFD700" />
                      <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
                    </View>
                  </>
                )}
              </View>
              {content?.genre && content.genre.length > 0 && (
                <View style={styles.genreContainer}>
                  {content.genre.slice(0, 3).map((g, i) => (
                    <View key={i} style={styles.genreBadge}>
                      <Text style={styles.genreText}>{g}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={styles.playButton}
              onPress={handlePlayPress}
            >
              <Ionicons name="play" size={24} color="#FFFFFF" />
              <Text style={styles.playButtonText}>Watch Now</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconButton, inLibrary && styles.iconButtonActive]}
              onPress={handleAddToLibrary}
              disabled={inLibrary}
            >
              <Ionicons
                name={inLibrary ? 'bookmark' : 'bookmark-outline'}
                size={24}
                color={inLibrary ? '#8B5CF6' : '#FFFFFF'}
              />
            </TouchableOpacity>
          </View>

          {/* Description */}
          {content?.description && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Overview</Text>
              <Text style={styles.description}>{content.description}</Text>
            </View>
          )}

          {/* Cast */}
          {content?.cast && content.cast.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Cast</Text>
              <Text style={styles.castText}>{content.cast.slice(0, 5).join(', ')}</Text>
            </View>
          )}

          {/* Director */}
          {content?.director && content.director.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Director</Text>
              <Text style={styles.castText}>{content.director.join(', ')}</Text>
            </View>
          )}

          {/* Streams */}
          {showStreams && (
            <View style={styles.streamsSection}>
              <StreamList
                streams={streams}
                isLoading={isLoadingStreams}
                onStreamSelect={handleStreamSelect}
              />
            </View>
          )}

          <View style={styles.bottomPadding} />
        </View>
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
  headerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: height * 0.35,
    zIndex: 1,
  },
  headerImage: {
    width: '100%',
    height: '100%',
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '60%',
  },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 16,
    marginTop: 8,
  },
  scrollView: {
    flex: 1,
    marginTop: height * 0.25,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  mainInfo: {
    flexDirection: 'row',
  },
  poster: {
    width: 120,
    height: 180,
    borderRadius: 8,
  },
  infoContainer: {
    flex: 1,
    marginLeft: 16,
    justifyContent: 'flex-end',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 28,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  metaText: {
    color: '#888888',
    fontSize: 14,
  },
  metaDot: {
    color: '#888888',
    marginHorizontal: 8,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    color: '#FFD700',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
  },
  genreContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    gap: 6,
  },
  genreBadge: {
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  genreText: {
    color: '#AAAAAA',
    fontSize: 12,
  },
  actionButtons: {
    flexDirection: 'row',
    marginTop: 24,
    gap: 12,
  },
  playButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    marginLeft: 8,
  },
  iconButton: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconButtonActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  description: {
    fontSize: 15,
    color: '#AAAAAA',
    lineHeight: 22,
  },
  castText: {
    fontSize: 14,
    color: '#888888',
    lineHeight: 20,
  },
  streamsSection: {
    marginTop: 24,
    marginHorizontal: -16,
  },
  bottomPadding: {
    height: 100,
  },
});
