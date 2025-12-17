import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { api } from '../src/api/client';

const { width, height } = Dimensions.get('window');

export default function PlayerScreen() {
  const { url, title, infoHash } = useLocalSearchParams<{
    url?: string;
    title?: string;
    infoHash?: string;
  }>();
  const router = useRouter();
  const videoRef = useRef<Video>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState('Initializing...');
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [peers, setPeers] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showControls, setShowControls] = useState(true);
  
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (url) {
      // Direct HTTP stream - play immediately
      setStreamUrl(url);
      setIsLoading(false);
    } else if (infoHash) {
      // Torrent stream - start backend streaming
      startTorrentStream();
    } else {
      setError('No stream source provided');
      setIsLoading(false);
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [url, infoHash]);

  const startTorrentStream = async () => {
    if (!infoHash) return;

    try {
      setLoadingStatus('Starting torrent download...');
      
      // Start the stream on backend
      await api.stream.start(infoHash);
      
      // Poll for status
      pollIntervalRef.current = setInterval(async () => {
        try {
          const status = await api.stream.status(infoHash);
          
          setDownloadProgress(status.progress || 0);
          setPeers(status.peers || 0);
          setDownloadSpeed(status.download_rate || 0);
          
          if (status.status === 'downloading_metadata') {
            setLoadingStatus(`Connecting to peers... (${status.peers} peers)`);
          } else if (status.status === 'buffering') {
            const speedMB = (status.download_rate / 1024 / 1024).toFixed(2);
            setLoadingStatus(`Buffering... ${status.progress?.toFixed(1)}% (${speedMB} MB/s)`);
          } else if (status.status === 'ready') {
            // Video is ready to play
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
            }
            
            // Get the stream URL
            const videoUrl = api.stream.getVideoUrl(infoHash);
            setStreamUrl(videoUrl);
            setIsLoading(false);
            setLoadingStatus('Playing...');
          } else if (status.status === 'not_found' || status.status === 'invalid') {
            setError('Failed to start torrent. Please try another stream.');
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
            }
          }
        } catch (err) {
          console.error('Status poll error:', err);
        }
      }, 1000);
      
    } catch (err: any) {
      console.error('Stream start error:', err);
      setError(err.message || 'Failed to start stream');
      setIsLoading(false);
    }
  };

  const onPlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      setIsPlaying(status.isPlaying);
      if (status.isPlaying) {
        setIsLoading(false);
      }
    }
  };

  const togglePlayPause = async () => {
    if (videoRef.current) {
      if (isPlaying) {
        await videoRef.current.pauseAsync();
      } else {
        await videoRef.current.playAsync();
      }
    }
  };

  const handleVideoPress = () => {
    setShowControls(!showControls);
  };

  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec > 1024 * 1024) {
      return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
    }
    return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  };

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      
      {/* Header */}
      <SafeAreaView style={[styles.header, showControls && styles.headerVisible]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {title || 'Video Player'}
        </Text>
        <View style={styles.placeholder} />
      </SafeAreaView>

      {/* Loading Overlay */}
      {isLoading && !error && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#8B5CF6" />
          <Text style={styles.loadingText}>{loadingStatus}</Text>
          
          {/* Progress info for torrents */}
          {infoHash && downloadProgress > 0 && (
            <View style={styles.progressInfo}>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${Math.min(downloadProgress, 100)}%` }]} />
              </View>
              <View style={styles.statsRow}>
                <Text style={styles.statText}>
                  <Ionicons name="people" size={12} color="#8B5CF6" /> {peers} peers
                </Text>
                <Text style={styles.statText}>
                  <Ionicons name="download" size={12} color="#8B5CF6" /> {formatSpeed(downloadSpeed)}
                </Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Error Display */}
      {error && (
        <View style={styles.errorContainer}>
          <Ionicons name="warning-outline" size={48} color="#ff6b6b" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => router.back()}>
            <Text style={styles.retryText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Video Player */}
      {streamUrl && (
        <TouchableOpacity 
          style={styles.videoContainer} 
          onPress={handleVideoPress}
          activeOpacity={1}
        >
          <Video
            ref={videoRef}
            source={{ uri: streamUrl }}
            style={styles.video}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay
            onPlaybackStatusUpdate={onPlaybackStatusUpdate}
            onError={(error) => {
              console.error('Video error:', error);
              setError('Failed to play video. Try another stream.');
            }}
          />
        </TouchableOpacity>
      )}

      {/* Download Stats Overlay (for torrents) */}
      {streamUrl && infoHash && showControls && (
        <View style={styles.torrentStats}>
          <Text style={styles.torrentStatText}>
            {downloadProgress.toFixed(1)}% • {peers} peers • {formatSpeed(downloadSpeed)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    zIndex: 100,
    opacity: 0,
  },
  headerVisible: {
    opacity: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    marginHorizontal: 12,
  },
  placeholder: {
    width: 40,
  },
  videoContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    width: width,
    height: height,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    zIndex: 50,
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 16,
    marginTop: 16,
    textAlign: 'center',
  },
  progressInfo: {
    marginTop: 24,
    width: '80%',
    alignItems: 'center',
  },
  progressBar: {
    width: '100%',
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#8B5CF6',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginTop: 12,
  },
  statText: {
    color: '#888',
    fontSize: 13,
  },
  errorContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    zIndex: 50,
    padding: 24,
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  torrentStats: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 60,
  },
  torrentStatText: {
    color: '#888',
    fontSize: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
});
