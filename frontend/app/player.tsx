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
  const { url, title, infoHash, magnetLink } = useLocalSearchParams<{
    url?: string;
    title?: string;
    infoHash?: string;
    magnetLink?: string;
  }>();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState('Initializing...');

  // Build the WebTorrent player HTML
  const getPlayerHTML = () => {
    const magnet = magnetLink || (infoHash ? `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title || 'Video')}` : null);
    
    if (url) {
      // Direct HTTP stream - use simple video player
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { background: #000; overflow: hidden; }
            video {
              width: 100vw;
              height: 100vh;
              object-fit: contain;
            }
          </style>
        </head>
        <body>
          <video controls autoplay playsinline>
            <source src="${url}" type="video/mp4">
            Your browser does not support video playback.
          </video>
        </body>
        </html>
      `;
    }

    if (magnet) {
      // WebTorrent player for magnet links
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
          <script src="https://cdn.jsdelivr.net/npm/webtorrent@latest/webtorrent.min.js"></script>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              background: #000; 
              color: #fff; 
              font-family: -apple-system, BlinkMacSystemFont, sans-serif;
              overflow: hidden;
            }
            #status {
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              text-align: center;
              z-index: 10;
              padding: 20px;
            }
            #status.hidden { display: none; }
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
            #statusText { font-size: 14px; color: #aaa; margin-bottom: 8px; }
            #progress { font-size: 12px; color: #666; }
            #player {
              width: 100vw;
              height: 100vh;
              display: none;
            }
            #player.active {
              display: block;
            }
            video {
              width: 100%;
              height: 100%;
              object-fit: contain;
              background: #000;
            }
            #errorMsg {
              color: #ff6b6b;
              font-size: 14px;
              padding: 20px;
              text-align: center;
            }
            #controls {
              position: absolute;
              bottom: 20px;
              left: 50%;
              transform: translateX(-50%);
              display: flex;
              gap: 12px;
              z-index: 20;
            }
            .control-btn {
              background: rgba(139, 92, 246, 0.8);
              border: none;
              color: white;
              padding: 10px 16px;
              border-radius: 8px;
              font-size: 14px;
              cursor: pointer;
            }
          </style>
        </head>
        <body>
          <div id="status">
            <div class="spinner"></div>
            <div id="statusText">Connecting to peers...</div>
            <div id="progress"></div>
          </div>
          <div id="player"></div>
          
          <script>
            const magnet = "${magnet.replace(/"/g, '\\"')}";
            const statusDiv = document.getElementById('status');
            const statusText = document.getElementById('statusText');
            const progressDiv = document.getElementById('progress');
            const playerDiv = document.getElementById('player');
            
            // Send message to React Native
            function sendMessage(type, data) {
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type, ...data }));
              }
            }
            
            function updateStatus(text, progress = '') {
              statusText.textContent = text;
              progressDiv.textContent = progress;
              sendMessage('status', { text, progress });
            }
            
            function showError(msg) {
              statusDiv.innerHTML = '<div id="errorMsg">' + msg + '</div>';
              sendMessage('error', { message: msg });
            }
            
            // Initialize WebTorrent
            try {
              updateStatus('Initializing WebTorrent...');
              
              const client = new WebTorrent();
              
              client.on('error', function(err) {
                console.error('Client error:', err);
                showError('WebTorrent error: ' + err.message);
              });
              
              updateStatus('Adding torrent...');
              
              const torrent = client.add(magnet, {
                announce: [
                  'wss://tracker.openwebtorrent.com',
                  'wss://tracker.btorrent.xyz',
                  'wss://tracker.fastcast.nz'
                ]
              });
              
              torrent.on('error', function(err) {
                console.error('Torrent error:', err);
                showError('Torrent error: ' + err.message);
              });
              
              torrent.on('warning', function(err) {
                console.warn('Torrent warning:', err);
              });
              
              torrent.on('metadata', function() {
                updateStatus('Got metadata, finding video...');
              });
              
              torrent.on('ready', function() {
                updateStatus('Torrent ready, buffering...');
                
                // Find the largest video file
                const videoFile = torrent.files.reduce((largest, file) => {
                  const isVideo = /\\.(mp4|mkv|avi|webm|mov)$/i.test(file.name);
                  if (isVideo && (!largest || file.length > largest.length)) {
                    return file;
                  }
                  return largest;
                }, null);
                
                if (videoFile) {
                  updateStatus('Starting playback: ' + videoFile.name);
                  
                  videoFile.renderTo('video', { autoplay: true }, function(err, elem) {
                    if (err) {
                      showError('Render error: ' + err.message);
                      return;
                    }
                    
                    statusDiv.classList.add('hidden');
                    playerDiv.classList.add('active');
                    sendMessage('playing', { file: videoFile.name });
                    
                    elem.controls = true;
                    elem.play().catch(function(e) {
                      console.log('Autoplay blocked:', e);
                    });
                  });
                } else {
                  showError('No video file found in torrent');
                }
              });
              
              // Update progress
              setInterval(function() {
                if (torrent.progress > 0 && torrent.progress < 1) {
                  const percent = (torrent.progress * 100).toFixed(1);
                  const speed = (torrent.downloadSpeed / 1024 / 1024).toFixed(2);
                  const peers = torrent.numPeers;
                  updateStatus(
                    'Downloading... ' + percent + '%',
                    speed + ' MB/s • ' + peers + ' peers'
                  );
                }
              }, 1000);
              
            } catch (err) {
              showError('Failed to initialize: ' + err.message);
            }
          </script>
          <div id="player">
            <video controls playsinline></video>
          </div>
        </body>
        </html>
      `;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { background: #000; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; font-family: sans-serif; }
        </style>
      </head>
      <body>
        <div>No stream URL provided</div>
      </body>
      </html>
    `;
  };

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'status') {
        setLoadingStatus(data.text);
      } else if (data.type === 'playing') {
        setIsLoading(false);
      } else if (data.type === 'error') {
        setError(data.message);
        setIsLoading(false);
      }
    } catch (e) {
      console.log('Message parse error:', e);
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
        <View style={styles.placeholder} />
      </SafeAreaView>

      {/* Loading Overlay */}
      {isLoading && !error && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#8B5CF6" />
          <Text style={styles.loadingText}>{loadingStatus}</Text>
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

      {/* WebView Player */}
      <WebView
        style={styles.webview}
        source={{ html: getPlayerHTML() }}
        onMessage={handleMessage}
        onLoad={() => {
          if (url) setIsLoading(false);
        }}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          setError(nativeEvent.description || 'Failed to load player');
          setIsLoading(false);
        }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback={true}
        allowsFullscreenVideo={true}
        mixedContentMode="always"
        originWhitelist={['*']}
      />
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
    color: '#AAAAAA',
    fontSize: 14,
    marginTop: 16,
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
});
