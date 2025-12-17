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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../src/api/client';
import * as ScreenOrientation from 'expo-screen-orientation';

// Conditionally import WebView only on native
let WebView: any = null;
if (Platform.OS !== 'web') {
  try {
    WebView = require('react-native-webview').WebView;
  } catch (e) {
    console.log('WebView not available');
  }
}

const { width, height } = Dimensions.get('window');

// Web Video Component using dangerouslySetInnerHTML
const WebVideoPlayer = ({ streamUrl, onLoad, onError }: { streamUrl: string; onLoad: () => void; onError: () => void }) => {
  useEffect(() => {
    // Notify that we've loaded
    const timer = setTimeout(onLoad, 2000);
    return () => clearTimeout(timer);
  }, []);

  const html = `
    <video 
      controls 
      autoplay 
      playsinline 
      style="width:100%;height:100%;background:#000;object-fit:contain;"
    >
      <source src="${streamUrl}" type="video/mp4">
    </video>
  `;

  return (
    <div 
      style={{ width: '100%', height: '100%', background: '#000' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

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
  
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const continuePollingRef = useRef(true);

  useEffect(() => {
    continuePollingRef.current = true;
    
    if (url) {
      setStreamUrl(url);
      setIsLoading(false);
    } else if (infoHash) {
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
      setLoadingStatus('Connecting to peers...');
      
      await api.stream.start(infoHash);
      
      pollIntervalRef.current = setInterval(async () => {
        if (!continuePollingRef.current) return;
        
        try {
          const status = await api.stream.status(infoHash);
          
          setDownloadProgress(status.progress || 0);
          setPeers(status.peers || 0);
          setDownloadSpeed(status.download_rate || 0);
          
          if (status.status === 'downloading_metadata') {
            setLoadingStatus(`Finding peers... (${status.peers || 0} connected)`);
          } else if (status.status === 'buffering') {
            const speedMB = ((status.download_rate || 0) / 1024 / 1024).toFixed(1);
            setLoadingStatus(`Buffering ${(status.progress || 0).toFixed(1)}% (${speedMB} MB/s)`);
          } else if (status.status === 'ready') {
            // Clear polling - video ready
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
            }
            
            const videoUrl = api.stream.getVideoUrl(infoHash);
            setStreamUrl(videoUrl);
            setIsLoading(false);
          } else if (status.status === 'not_found' || status.status === 'invalid') {
            setError('Failed to start. Try another stream.');
            setIsLoading(false);
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
      setError(err.message || 'Failed to start');
      setIsLoading(false);
    }
  };

  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec > 1024 * 1024) {
      return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
    }
    return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  };

  // HTML for native WebView video player
  const getVideoPlayerHTML = () => {
    if (!streamUrl) return '';
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
          video { width: 100%; height: 100%; object-fit: contain; background: #000; }
          .status { color: #fff; text-align: center; padding: 20px; font-family: sans-serif; 
                   position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
          .spinner { width: 30px; height: 30px; border: 3px solid rgba(139, 92, 246, 0.3);
                    border-top-color: #8B5CF6; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 12px; }
          @keyframes spin { to { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <div id="status" class="status"><div class="spinner"></div><div>Loading...</div></div>
        <video id="player" controls playsinline style="display: none;">
          <source src="${streamUrl}" type="video/mp4">
        </video>
        <script>
          const video = document.getElementById('player');
          const status = document.getElementById('status');
          video.addEventListener('loadeddata', function() {
            status.style.display = 'none';
            video.style.display = 'block';
            video.play().catch(e => console.log('Autoplay blocked:', e));
          });
          video.addEventListener('canplay', function() {
            status.style.display = 'none';
            video.style.display = 'block';
          });
          video.addEventListener('error', function() {
            status.innerHTML = '<div style="color:#ff6b6b;">Error loading video</div>';
          });
          video.load();
        </script>
      </body>
      </html>
    `;
  };

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      
      {/* Header */}
      <SafeAreaView style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
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
          
          {infoHash && (
            <View style={styles.progressInfo}>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${Math.min(downloadProgress, 100)}%` }]} />
              </View>
              <View style={styles.statsRow}>
                <Text style={styles.statText}>{peers} peers</Text>
                <Text style={styles.statText}>{formatSpeed(downloadSpeed)}</Text>
                <Text style={styles.statText}>{downloadProgress.toFixed(1)}%</Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Error */}
      {error && (
        <View style={styles.errorContainer}>
          <Ionicons name="warning-outline" size={48} color="#ff6b6b" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.button} onPress={() => router.back()}>
            <Text style={styles.buttonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Video Player - Web uses native video, native uses WebView */}
      {streamUrl && !error && !isLoading && (
        Platform.OS === 'web' ? (
          <View style={styles.webview}>
            <video
              src={streamUrl}
              controls
              autoPlay
              playsInline
              style={{ 
                width: '100%', 
                height: '100%', 
                backgroundColor: '#000',
                objectFit: 'contain'
              } as any}
            />
          </View>
        ) : WebView ? (
          <WebView
            style={styles.webview}
            source={{ html: getVideoPlayerHTML() }}
            allowsInlineMediaPlayback={true}
            mediaPlaybackRequiresUserAction={false}
            allowsFullscreenVideo={true}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            mixedContentMode="always"
            originWhitelist={['*']}
          />
        ) : (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Video player not available</Text>
          </View>
        )
      )}

      {/* Stats overlay when playing */}
      {streamUrl && infoHash && !isLoading && !error && (
        <View style={styles.statsOverlay}>
          <Text style={styles.statsText}>
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
  button: {
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  statsOverlay: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 60,
  },
  statsText: {
    color: '#888',
    fontSize: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
});
