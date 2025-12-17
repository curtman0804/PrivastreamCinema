import React, { useState, useEffect } from 'react';
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
import { WebView } from 'react-native-webview';

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

  // Build the stream URL
  const getStreamUrl = () => {
    if (url) {
      return url;
    }
    if (infoHash) {
      // Use instant.io for torrent streaming - WebTorrent based, works in browsers
      const trackers = [
        'wss://tracker.openwebtorrent.com',
        'wss://tracker.btorrent.xyz',
        'wss://tracker.fastcast.nz',
      ];
      const trackersParam = trackers.map(t => `&tr=${encodeURIComponent(t)}`).join('');
      const magnetLink = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title || 'Video')}${trackersParam}`;
      
      // Return instant.io URL
      return `https://instant.io/#${magnetLink}`;
    }
    return null;
  };

  const streamUrl = getStreamUrl();

  // HTML for embedded video player using webtor
  const getPlayerHTML = () => {
    if (!streamUrl) return '';
    
    if (url) {
      // Direct URL - use HTML5 video player
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
            video { width: 100%; height: 100%; object-fit: contain; background: #000; }
            .error { color: #ff6b6b; text-align: center; padding: 20px; font-family: sans-serif; 
                     position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
          </style>
        </head>
        <body>
          <video id="player" controls autoplay playsinline>
            <source src="${url}" type="video/mp4">
            <source src="${url}" type="video/x-matroska">
            <source src="${url}" type="video/webm">
          </video>
          <script>
            const video = document.getElementById('player');
            video.addEventListener('error', () => {
              document.body.innerHTML = '<div class="error">Video format not supported</div>';
            });
            video.play().catch(e => console.log('Autoplay blocked:', e));
          </script>
        </body>
        </html>
      `;
    }
    
    // For torrent streams, embed webtor.io player
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
          iframe { width: 100%; height: 100%; border: none; }
          .loading { 
            color: #fff; 
            text-align: center; 
            padding: 20px; 
            font-family: -apple-system, sans-serif;
            position: absolute; 
            top: 50%; 
            left: 50%; 
            transform: translate(-50%, -50%);
          }
          .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid rgba(139, 92, 246, 0.3);
            border-top-color: #8B5CF6;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <div id="loading" class="loading">
          <div class="spinner"></div>
          <div>Loading stream...</div>
        </div>
        <iframe 
          id="player"
          src="${streamUrl}"
          allow="autoplay; fullscreen; encrypted-media"
          allowfullscreen
          style="display: none;"
        ></iframe>
        <script>
          const iframe = document.getElementById('player');
          const loading = document.getElementById('loading');
          
          iframe.onload = function() {
            loading.style.display = 'none';
            iframe.style.display = 'block';
            window.ReactNativeWebView.postMessage('loaded');
          };
          
          // Timeout fallback
          setTimeout(function() {
            loading.style.display = 'none';
            iframe.style.display = 'block';
          }, 5000);
        </script>
      </body>
      </html>
    `;
  };

  const handleMessage = (event: any) => {
    const data = event.nativeEvent.data;
    if (data === 'loaded') {
      setIsLoading(false);
    }
  };

  if (!streamUrl) {
    return (
      <View style={styles.container}>
        <SafeAreaView style={styles.errorContainer}>
          <Ionicons name="warning-outline" size={48} color="#ff6b6b" />
          <Text style={styles.errorText}>No stream URL provided</Text>
          <TouchableOpacity style={styles.button} onPress={() => router.back()}>
            <Text style={styles.buttonText}>Go Back</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

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
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#8B5CF6" />
          <Text style={styles.loadingText}>Loading stream...</Text>
        </View>
      )}

      {/* WebView Player */}
      <WebView
        style={styles.webview}
        source={{ html: getPlayerHTML() }}
        onMessage={handleMessage}
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setError('Failed to load video');
          setIsLoading(false);
        }}
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo={true}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        mixedContentMode="always"
        originWhitelist={['*']}
        userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      />

      {/* Error Display */}
      {error && (
        <View style={styles.errorOverlay}>
          <Ionicons name="warning-outline" size={48} color="#ff6b6b" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.button} onPress={() => router.back()}>
            <Text style={styles.buttonText}>Go Back</Text>
          </TouchableOpacity>
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
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    zIndex: 50,
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 16,
    marginTop: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorOverlay: {
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
});
