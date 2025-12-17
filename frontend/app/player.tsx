import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  StatusBar,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import * as Clipboard from 'expo-clipboard';
import { api } from '../src/api/client';

const { width, height } = Dimensions.get('window');

export default function PlayerScreen() {
  const { url, title, infoHash } = useLocalSearchParams<{
    url?: string;
    title?: string;
    infoHash?: string;
  }>();
  const router = useRouter();
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState('Initializing...');
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [peers, setPeers] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [videoReady, setVideoReady] = useState(false);
  const [videoFile, setVideoFile] = useState<string | null>(null);
  
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const continuePollingRef = useRef(true);

  useEffect(() => {
    continuePollingRef.current = true;
    
    if (url) {
      // Direct HTTP stream - play immediately
      setStreamUrl(url);
      setIsLoading(false);
      setVideoReady(true);
    } else if (infoHash) {
      // Torrent stream - start backend streaming
      startTorrentStream();
    } else {
      setError('No stream source provided');
      setIsLoading(false);
    }

    return () => {
      continuePollingRef.current = false;
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
        if (!continuePollingRef.current) return;
        
        try {
          const status = await api.stream.status(infoHash);
          
          setDownloadProgress(status.progress || 0);
          setPeers(status.peers || 0);
          setDownloadSpeed(status.download_rate || 0);
          
          if (status.video_file) {
            setVideoFile(status.video_file);
          }
          
          if (status.status === 'downloading_metadata') {
            setLoadingStatus(`Connecting to peers... (${status.peers} peers)`);
          } else if (status.status === 'buffering') {
            const speedMB = ((status.download_rate || 0) / 1024 / 1024).toFixed(2);
            setLoadingStatus(`Buffering... ${(status.progress || 0).toFixed(1)}% (${speedMB} MB/s)`);
          } else if (status.status === 'ready') {
            // Video is ready to play immediately - no buffer wait needed
            const videoUrl = api.stream.getVideoUrl(infoHash);
            setStreamUrl(videoUrl);
            setIsLoading(false);
            setVideoReady(true);
            setLoadingStatus('Ready to play');
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

  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec > 1024 * 1024) {
      return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
    }
    return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  };

  const openInExternalPlayer = async () => {
    if (!streamUrl) return;
    
    // Try different player schemes for Android/Fire TV
    const schemes = [
      `vlc://${streamUrl}`,
      `intent:${streamUrl}#Intent;package=com.mxtech.videoplayer.ad;type=video/*;end`,
      `intent:${streamUrl}#Intent;package=com.brouken.player;type=video/*;end`,
    ];
    
    for (const scheme of schemes) {
      try {
        const canOpen = await Linking.canOpenURL(scheme);
        if (canOpen) {
          await Linking.openURL(scheme);
          return;
        }
      } catch (e) {
        console.log('Scheme not available:', scheme);
      }
    }
    
    // Fallback - copy URL to clipboard
    Alert.alert(
      'Open in External Player',
      'Install VLC or MX Player, then copy the stream URL and paste it in the player.',
      [
        {
          text: 'Copy Stream URL',
          onPress: async () => {
            await Clipboard.setStringAsync(streamUrl);
            Alert.alert('Copied!', 'Stream URL copied to clipboard');
          }
        },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  };

  // Generate HTML for video player
  const getVideoPlayerHTML = () => {
    if (!streamUrl) return '';
    
    const isMKV = videoFile?.toLowerCase().endsWith('.mkv');
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body { 
            width: 100%; 
            height: 100%; 
            background: #000; 
            overflow: hidden;
            font-family: -apple-system, sans-serif;
          }
          video {
            width: 100%;
            height: 100%;
            object-fit: contain;
            background: #000;
          }
          .message {
            color: #fff;
            text-align: center;
            padding: 20px;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 90%;
          }
          .error { color: #ff6b6b; }
          .title { font-size: 18px; margin-bottom: 16px; }
          .subtitle { font-size: 14px; color: #888; margin-bottom: 24px; }
          .btn {
            background: #8B5CF6;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
            margin: 8px;
          }
          .btn-secondary {
            background: #333;
          }
        </style>
      </head>
      <body>
        <video id="player" controls autoplay playsinline>
          <source src="${streamUrl}" type="video/mp4">
          <source src="${streamUrl}" type="video/x-matroska">
          <source src="${streamUrl}" type="video/webm">
        </video>
        
        <div id="fallback" class="message" style="display: none;">
          <div class="title">Video format not supported in browser</div>
          <div class="subtitle">${isMKV ? 'MKV files require an external player' : 'Try opening in an external player'}</div>
          <button class="btn" onclick="window.ReactNativeWebView.postMessage('open_external')">
            Open in VLC / MX Player
          </button>
          <button class="btn btn-secondary" onclick="window.ReactNativeWebView.postMessage('copy_url')">
            Copy Stream URL
          </button>
        </div>
        
        <script>
          const video = document.getElementById('player');
          const fallback = document.getElementById('fallback');
          let hasError = false;
          
          video.addEventListener('error', function(e) {
            if (!hasError) {
              hasError = true;
              video.style.display = 'none';
              fallback.style.display = 'block';
            }
          });
          
          video.addEventListener('loadeddata', function() {
            video.play().catch(e => {
              console.log('Autoplay blocked:', e);
            });
          });
          
          // Try to load
          video.load();
          
          // Timeout fallback
          setTimeout(function() {
            if (video.readyState < 2 && !hasError) {
              hasError = true;
              video.style.display = 'none';
              fallback.style.display = 'block';
            }
          }, 10000);
        </script>
      </body>
      </html>
    `;
  };

  const handleWebViewMessage = async (event: any) => {
    const message = event.nativeEvent.data;
    
    if (message === 'open_external') {
      openInExternalPlayer();
    } else if (message === 'copy_url' && streamUrl) {
      await Clipboard.setStringAsync(streamUrl);
      Alert.alert('Copied!', 'Stream URL copied to clipboard');
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      
      {/* Header */}
      <SafeAreaView style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {title || 'Video Player'}
        </Text>
        {streamUrl && (
          <TouchableOpacity
            style={styles.externalButton}
            onPress={openInExternalPlayer}
          >
            <Ionicons name="open-outline" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </SafeAreaView>

      {/* Loading Overlay */}
      {isLoading && !error && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#8B5CF6" />
          <Text style={styles.loadingText}>{loadingStatus}</Text>
          
          {/* Progress info for torrents */}
          {infoHash && (
            <View style={styles.progressInfo}>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${Math.min(downloadProgress, 100)}%` }]} />
              </View>
              <View style={styles.statsRow}>
                <Text style={styles.statText}>
                  {peers} peers
                </Text>
                <Text style={styles.statText}>
                  {formatSpeed(downloadSpeed)}
                </Text>
                <Text style={styles.statText}>
                  {downloadProgress.toFixed(1)}%
                </Text>
              </View>
              {videoFile && (
                <Text style={styles.fileInfo} numberOfLines={1}>
                  {videoFile.split('/').pop()}
                </Text>
              )}
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

      {/* WebView Video Player */}
      {videoReady && streamUrl && !isLoading && (
        <WebView
          style={styles.webview}
          source={{ html: getVideoPlayerHTML() }}
          onMessage={handleWebViewMessage}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo={true}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          mixedContentMode="always"
          originWhitelist={['*']}
        />
      )}

      {/* Download Stats Overlay (for torrents) */}
      {videoReady && infoHash && (
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
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  externalButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(139, 92, 246, 0.5)',
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
  webview: {
    flex: 1,
    backgroundColor: '#000',
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
  fileInfo: {
    color: '#666',
    fontSize: 11,
    marginTop: 8,
    maxWidth: '90%',
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
    bottom: 20,
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
