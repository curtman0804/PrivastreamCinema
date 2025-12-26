import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../src/api/client';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { Modal, FlatList } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Conditionally import WebView only on native (fallback for HLS)
let WebView: any = null;
if (Platform.OS !== 'web') {
  try {
    WebView = require('react-native-webview').WebView;
  } catch (e) {
    console.log('WebView not available');
  }
}

const { width, height } = Dimensions.get('window');

// Check if title suggests HEVC/x265 codec (not supported on most web browsers)
const isHEVCContent = (titleStr: string | undefined): boolean => {
  if (!titleStr) return false;
  const lowerTitle = titleStr.toLowerCase();
  return lowerTitle.includes('hevc') || lowerTitle.includes('x265') || lowerTitle.includes('h.265');
};

// Subtitle interface
interface Subtitle {
  id: string;
  url: string;
  lang: string;
  langName: string;
}

// Parsed subtitle cue
interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export default function PlayerScreen() {
  const { 
    url, 
    title, 
    infoHash, 
    directUrl, 
    isLive, 
    contentType, 
    contentId,
    fallbackStreams,
    // File selection for torrents
    fileIdx,
    filename,
    // Next episode data
    nextEpisodeId,
    nextEpisodeTitle,
    seriesId,
    season,
    episode,
  } = useLocalSearchParams<{
    url?: string;
    title?: string;
    infoHash?: string;
    directUrl?: string;
    isLive?: string;
    contentType?: string;
    contentId?: string;
    fallbackStreams?: string;
    fileIdx?: string;
    filename?: string;
    nextEpisodeId?: string;
    nextEpisodeTitle?: string;
    seriesId?: string;
    season?: string;
    episode?: string;
  }>();
  const router = useRouter();
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState('Initializing...');
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [peers, setPeers] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [isLiveTV, setIsLiveTV] = useState(false);
  const [hasAudioError, setHasAudioError] = useState(false);
  
  // Fallback streams for auto-retry
  const [fallbackUrls, setFallbackUrls] = useState<string[]>([]);
  const [currentStreamIndex, setCurrentStreamIndex] = useState(0);
  const [playbackStarted, setPlaybackStarted] = useState(false);
  const playbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Subtitles state
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [selectedSubtitle, setSelectedSubtitle] = useState<string | null>(null);
  const [showSubtitlePicker, setShowSubtitlePicker] = useState(false);
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [currentSubtitleText, setCurrentSubtitleText] = useState<string>('');
  
  // Custom player controls state
  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isEnded, setIsEnded] = useState(false);
  const videoRef = useRef<Video>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const continuePollingRef = useRef(true);
  
  // Format time helper
  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };
  
  // Parse VTT/SRT subtitle file
  const parseSubtitleFile = async (subtitleUrl: string) => {
    try {
      console.log('[SUBTITLES] Fetching subtitle file:', subtitleUrl);
      const response = await fetch(subtitleUrl);
      const text = await response.text();
      
      const cues: SubtitleCue[] = [];
      
      // Parse VTT or SRT format
      const lines = text.split('\n');
      let i = 0;
      
      // Skip VTT header
      if (lines[0]?.includes('WEBVTT')) {
        i = 1;
        while (i < lines.length && lines[i].trim() !== '') i++;
        i++;
      }
      
      while (i < lines.length) {
        // Skip empty lines and cue numbers
        while (i < lines.length && (lines[i].trim() === '' || /^\d+$/.test(lines[i].trim()))) {
          i++;
        }
        
        if (i >= lines.length) break;
        
        // Parse timestamp line (00:00:00,000 --> 00:00:00,000 or 00:00:00.000 --> 00:00:00.000)
        const timestampLine = lines[i];
        const timestampMatch = timestampLine.match(/(\d{1,2}:)?(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}:)?(\d{2}):(\d{2})[,.](\d{3})/);
        
        if (timestampMatch) {
          const startHours = timestampMatch[1] ? parseInt(timestampMatch[1]) : 0;
          const startMins = parseInt(timestampMatch[2]);
          const startSecs = parseInt(timestampMatch[3]);
          const startMs = parseInt(timestampMatch[4]);
          
          const endHours = timestampMatch[5] ? parseInt(timestampMatch[5]) : 0;
          const endMins = parseInt(timestampMatch[6]);
          const endSecs = parseInt(timestampMatch[7]);
          const endMs = parseInt(timestampMatch[8]);
          
          const start = (startHours * 3600 + startMins * 60 + startSecs) * 1000 + startMs;
          const end = (endHours * 3600 + endMins * 60 + endSecs) * 1000 + endMs;
          
          i++;
          
          // Collect text lines until empty line
          let textLines: string[] = [];
          while (i < lines.length && lines[i].trim() !== '') {
            textLines.push(lines[i].trim());
            i++;
          }
          
          if (textLines.length > 0) {
            cues.push({
              start,
              end,
              text: textLines.join('\n').replace(/<[^>]*>/g, ''), // Remove HTML tags
            });
          }
        } else {
          i++;
        }
      }
      
      console.log(`[SUBTITLES] Parsed ${cues.length} subtitle cues`);
      setSubtitleCues(cues);
    } catch (err) {
      console.log('[SUBTITLES] Error parsing subtitle file:', err);
    }
  };
  
  // Update current subtitle based on position
  useEffect(() => {
    if (subtitleCues.length > 0) {
      const currentCue = subtitleCues.find(
        cue => position >= cue.start && position <= cue.end
      );
      setCurrentSubtitleText(currentCue?.text || '');
    } else {
      setCurrentSubtitleText('');
    }
  }, [position, subtitleCues]);
  
  // Load subtitle when selected
  useEffect(() => {
    if (selectedSubtitle) {
      parseSubtitleFile(selectedSubtitle);
    } else {
      setSubtitleCues([]);
      setCurrentSubtitleText('');
    }
  }, [selectedSubtitle]);
  
  // Next episode modal state
  const [showNextEpisodeModal, setShowNextEpisodeModal] = useState(false);
  const [countdown, setCountdown] = useState(15);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const creditsShownRef = useRef(false); // Track if we've shown the credits popup
  
  // Credits detection settings
  const CREDITS_TIME_REMAINING_MS = 90000; // Show popup when 90 seconds remaining
  const CREDITS_PERCENTAGE = 0.95; // Or when 95% complete
  const MIN_DURATION_FOR_CREDITS = 300000; // Only detect credits for videos > 5 minutes
  
  // Handle playback status updates
  const handlePlaybackStatus = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      setIsPlaying(status.isPlaying);
      setPosition(status.positionMillis);
      setDuration(status.durationMillis || 0);
      
      // Mark playback as started when video is actually playing
      if (status.isPlaying && !playbackStarted) {
        console.log('[PLAYER] Playback started successfully!');
        setPlaybackStarted(true);
        setIsLoading(false);
        // Clear timeout since playback started
        if (playbackTimeoutRef.current) {
          clearTimeout(playbackTimeoutRef.current);
          playbackTimeoutRef.current = null;
        }
      }
      
      // Credits detection - show "Up Next" popup when credits start
      const currentDuration = status.durationMillis || 0;
      const currentPosition = status.positionMillis || 0;
      const timeRemaining = currentDuration - currentPosition;
      const percentComplete = currentDuration > 0 ? currentPosition / currentDuration : 0;
      
      // Only show credits popup for series with next episode, and only once
      if (
        nextEpisodeId && 
        contentType === 'series' && 
        !creditsShownRef.current && 
        !showNextEpisodeModal &&
        currentDuration > MIN_DURATION_FOR_CREDITS && // Video must be > 5 min
        (timeRemaining <= CREDITS_TIME_REMAINING_MS || percentComplete >= CREDITS_PERCENTAGE)
      ) {
        console.log(`[PLAYER] Credits detected! Time remaining: ${(timeRemaining/1000).toFixed(0)}s, ${(percentComplete*100).toFixed(1)}% complete`);
        creditsShownRef.current = true;
        showCreditsPopup();
      }
      
      // Check if playback ended - go back if modal was dismissed
      if (status.didJustFinish) {
        console.log('[PLAYER] Playback ended');
        setIsEnded(true);
        if (!showNextEpisodeModal) {
          // Modal was dismissed or never shown, go back
          router.back();
        }
      }
    }
  };
  
  // Show the credits/next episode popup
  const showCreditsPopup = useCallback(() => {
    setShowNextEpisodeModal(true);
    setCountdown(15); // 15 seconds to decide
    
    // Start countdown - auto-play next episode when countdown ends
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          // Time's up - AUTO-PLAY NEXT EPISODE
          if (countdownRef.current) clearInterval(countdownRef.current);
          setShowNextEpisodeModal(false);
          
          // Navigate to next episode
          console.log('[PLAYER] Countdown ended - auto-playing next episode:', nextEpisodeId);
          router.replace({
            pathname: `/details/series/${nextEpisodeId}`,
          });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [router, nextEpisodeId]);
  
  // Handle playback end - show modal or go back (fallback for short videos)
  const handlePlaybackEnd = useCallback(() => {
    if (nextEpisodeId && contentType === 'series' && !creditsShownRef.current) {
      // Credits weren't detected (short video), show popup now
      showCreditsPopup();
    } else if (!showNextEpisodeModal) {
      // No next episode or popup was dismissed - go back
      router.back();
    }
  }, [nextEpisodeId, contentType, router, showNextEpisodeModal, showCreditsPopup]);
  
  // Dismiss credits popup (keep watching)
  const dismissCreditsPopup = () => {
    // Clear countdown
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setShowNextEpisodeModal(false);
    // Reset credits shown so it can show again at actual end
    creditsShownRef.current = false;
  };
  
  // Play next episode
  const playNextEpisode = () => {
    // Clear countdown
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setShowNextEpisodeModal(false);
    
    if (!nextEpisodeId) {
      router.back();
      return;
    }
    
    console.log('[PLAYER] Playing next episode:', nextEpisodeId);
    
    // Navigate to the next episode details page
    router.replace({
      pathname: `/details/series/${nextEpisodeId}`,
    });
  };
  
  // Go back (cancel next episode)
  const handleGoBack = () => {
    // Clear countdown
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setShowNextEpisodeModal(false);
    router.back();
  };
  
  // Cleanup countdown on unmount
  useEffect(() => {
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
      }
    };
  }, []);
  
  // Toggle play/pause
  const togglePlayPause = async () => {
    if (videoRef.current) {
      if (isPlaying) {
        await videoRef.current.pauseAsync();
      } else {
        await videoRef.current.playAsync();
      }
    }
  };
  
  // Fade controls in/out
  const fadeControls = (show: boolean) => {
    Animated.timing(controlsOpacity, {
      toValue: show ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      if (!show) setShowControls(false);
    });
    if (show) setShowControls(true);
  };
  
  // Try next fallback stream
  const tryNextStream = () => {
    if (fallbackUrls.length > currentStreamIndex + 1) {
      const nextIndex = currentStreamIndex + 1;
      console.log(`[PLAYER] Trying fallback stream ${nextIndex + 1}/${fallbackUrls.length}`);
      setCurrentStreamIndex(nextIndex);
      setStreamUrl(fallbackUrls[nextIndex]);
      setPlaybackStarted(false);
      setError(null);
      setIsLoading(true);
      setLoadingStatus(`Trying stream ${nextIndex + 1}/${fallbackUrls.length}...`);
      
      // Start new timeout for this stream
      if (playbackTimeoutRef.current) {
        clearTimeout(playbackTimeoutRef.current);
      }
      playbackTimeoutRef.current = setTimeout(() => {
        if (!playbackStarted) {
          console.log('[PLAYER] Stream timeout, trying next...');
          tryNextStream();
        }
      }, 30000); // 30 second timeout
    } else {
      // No more fallback streams
      console.log('[PLAYER] No more fallback streams available');
      setError('Unable to play video. All streams failed to load.');
      setIsLoading(false);
    }
  };
  
  // Handle tap to show/hide controls
  const handleVideoTap = () => {
    if (showControls) {
      fadeControls(false);
    } else {
      fadeControls(true);
      // Reset auto-hide timer
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      controlsTimeoutRef.current = setTimeout(() => {
        if (isPlaying) fadeControls(false);
      }, 3000);
    }
  };
  
  // Auto-hide controls after 3 seconds
  useEffect(() => {
    if (showControls && streamUrl && !isLoading) {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      controlsTimeoutRef.current = setTimeout(() => {
        if (isPlaying) fadeControls(false);
      }, 4000);
    }
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [showControls, streamUrl, isLoading, isPlaying]);
  
  // Set up playback timeout when stream URL changes
  useEffect(() => {
    if (streamUrl && !playbackStarted) {
      // Clear any existing timeout
      if (playbackTimeoutRef.current) {
        clearTimeout(playbackTimeoutRef.current);
      }
      // Set 30 second timeout for playback to start
      playbackTimeoutRef.current = setTimeout(() => {
        if (!playbackStarted && fallbackUrls.length > currentStreamIndex + 1) {
          console.log('[PLAYER] Playback timeout - trying next stream');
          tryNextStream();
        }
      }, 30000);
    }
    return () => {
      if (playbackTimeoutRef.current) {
        clearTimeout(playbackTimeoutRef.current);
      }
    };
  }, [streamUrl, playbackStarted]);

  // Fetch subtitles for the content
  const fetchSubtitles = async (cType: string, cId: string) => {
    console.log('[SUBTITLES] fetchSubtitles called with:', cType, cId);
    if (!cId) {
      console.log('[SUBTITLES] No content ID provided, skipping fetch');
      return;
    }
    try {
      const url = `/api/subtitles/${cType}/${cId}`;
      console.log('[SUBTITLES] Making API call to:', url);
      const response = await api.get(url);
      console.log('[SUBTITLES] API response status:', response.status);
      
      if (response.data?.subtitles && response.data.subtitles.length > 0) {
        console.log(`[SUBTITLES] Setting ${response.data.subtitles.length} subtitle options`);
        setSubtitles(response.data.subtitles);
      } else {
        console.log('[SUBTITLES] No subtitles found in response');
      }
    } catch (err: any) {
      console.log('[SUBTITLES] Error fetching subtitles:', err.message || err);
    }
  };

  // Open stream in external player (VLC, MX Player, etc.)
  const openInExternalPlayer = async () => {
    if (!streamUrl) return;
    
    try {
      // Try VLC first
      const vlcUrl = `vlc://${streamUrl}`;
      const canOpenVLC = await Linking.canOpenURL(vlcUrl);
      
      if (canOpenVLC) {
        await Linking.openURL(vlcUrl);
        return;
      }
      
      // Fallback to generic video intent
      const supported = await Linking.canOpenURL(streamUrl);
      if (supported) {
        await Linking.openURL(streamUrl);
      } else {
        Alert.alert(
          'External Player',
          'Install VLC or MX Player for better audio codec support.\n\nVLC: https://play.google.com/store/apps/details?id=org.videolan.vlc',
          [{ text: 'OK' }]
        );
      }
    } catch (err) {
      console.log('Error opening external player:', err);
      Alert.alert('Error', 'Could not open external player');
    }
  };

  // Lock to landscape on mount, unlock on unmount
  useEffect(() => {
    const lockLandscape = async () => {
      if (Platform.OS !== 'web') {
        try {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        } catch (e) {
          console.log('Could not lock orientation:', e);
        }
      }
    };
    
    lockLandscape();
    
    return () => {
      // Unlock orientation when leaving player
      if (Platform.OS !== 'web') {
        ScreenOrientation.unlockAsync().catch(() => {});
      }
    };
  }, []);

  // Fetch subtitles when player loads
  useEffect(() => {
    let isMounted = true;
    
    const loadSubtitles = async () => {
      console.log('[SUBTITLES] URL params - contentType:', contentType, 'contentId:', contentId);
      
      if (contentId && isMounted) {
        console.log('[SUBTITLES] Using URL params to fetch subtitles');
        fetchSubtitles(contentType || 'movie', contentId);
        return;
      }
      
      // Fallback to AsyncStorage
      try {
        const storedData = await AsyncStorage.getItem('currentPlaying');
        if (storedData && isMounted) {
          const parsed = JSON.parse(storedData);
          const { contentType: cType, contentId: cId } = parsed;
          if (cId) {
            fetchSubtitles(cType || 'movie', cId);
          }
        }
      } catch (e) {
        console.log('[SUBTITLES] Error reading from AsyncStorage:', e);
      }
    };
    
    const timeout = setTimeout(loadSubtitles, 300);
    
    return () => {
      isMounted = false;
      clearTimeout(timeout);
    };
  }, [contentType, contentId]);

  // Initialize player
  useEffect(() => {
    continuePollingRef.current = true;
    
    // Parse fallback streams
    if (fallbackStreams) {
      try {
        const parsed = JSON.parse(fallbackStreams);
        if (Array.isArray(parsed)) {
          setFallbackUrls(parsed);
          console.log('[PLAYER] Loaded', parsed.length, 'fallback streams');
        }
      } catch (e) {
        console.log('[PLAYER] Error parsing fallback streams:', e);
      }
    }
    
    // Check if this is live TV
    setIsLiveTV(isLive === 'true');
    
    if (directUrl) {
      setStreamUrl(directUrl);
      setIsLoading(false);
      setLoadingStatus('');
    } else if (url) {
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
        clearTimeout(pollIntervalRef.current);
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [url, infoHash, directUrl, isLive, fallbackStreams]);

  const startTorrentStream = async () => {
    if (!infoHash) return;

    try {
      setLoadingStatus('Starting torrent engine...');
      
      // Parse fileIdx if provided (for selecting specific episode in season packs)
      const parsedFileIdx = fileIdx ? parseInt(fileIdx, 10) : undefined;
      console.log(`[PLAYER] Starting torrent with fileIdx=${parsedFileIdx}, filename=${filename || 'auto'}`);
      
      await api.stream.start(infoHash, parsedFileIdx, filename || undefined);
      
      let pollInterval = 500;
      
      const pollStatus = async () => {
        if (!continuePollingRef.current) return;
        
        try {
          const status = await api.stream.status(infoHash);
          
          setDownloadProgress(status.progress || 0);
          setPeers(status.peers || 0);
          setDownloadSpeed(status.download_rate || 0);
          
          if (status.status === 'downloading_metadata') {
            const peerCount = status.peers || 0;
            if (peerCount === 0) {
              setLoadingStatus('Searching for peers...');
            } else {
              setLoadingStatus(`Found ${peerCount} peers, getting file info...`);
            }
          } else if (status.status === 'buffering') {
            const speedMB = ((status.download_rate || 0) / 1024 / 1024).toFixed(1);
            const downloaded = status.downloaded ? (status.downloaded / (1024 * 1024)).toFixed(1) : '0';
            const threshold = status.ready_threshold_mb ? status.ready_threshold_mb.toFixed(1) : '3';
            setLoadingStatus(`Buffering ${downloaded}MB / ${threshold}MB (${speedMB} MB/s)`);
            
            if (pollInterval < 1000) pollInterval = 1000;
          } else if (status.status === 'ready') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
            }
            
            setLoadingStatus('Starting playback...');
            // Pass fileIdx to getVideoUrl for file selection
            const videoUrl = api.stream.getVideoUrl(infoHash, parsedFileIdx);
            setStreamUrl(videoUrl);
            setIsLoading(false);
            return;
          } else if (status.status === 'not_found' || status.status === 'invalid') {
            setError('Failed to start. Try selecting a different stream with more seeders.');
            setIsLoading(false);
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
            }
            return;
          }
          
          pollIntervalRef.current = setTimeout(pollStatus, pollInterval) as any;
        } catch (err) {
          console.error('Status poll error:', err);
          pollIntervalRef.current = setTimeout(pollStatus, 2000) as any;
        }
      };
      
      pollStatus();
      
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

  // Handle back button
  const handleBack = () => {
    router.back();
  };

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* Loading Overlay */}
      {isLoading && !error && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#B8A05C" />
          <Text style={styles.loadingText}>{loadingStatus}</Text>
          
          {infoHash && (
            <View style={styles.progressInfo}>
              <View style={styles.progressBarBg}>
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
          
          <TouchableOpacity 
            style={[styles.button, { backgroundColor: '#B8A05C', marginBottom: 12 }]} 
            onPress={openInExternalPlayer}
          >
            <Ionicons name="open-outline" size={20} color="#000" style={{ marginRight: 8 }} />
            <Text style={[styles.buttonText, { color: '#000' }]}>Open in External Player</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.button} onPress={handleBack}>
            <Text style={styles.buttonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Video Player */}
      {streamUrl && !error && !isLoading && (
        Platform.OS === 'web' ? (
          <View style={styles.videoContainer}>
            {/* HEVC Warning Banner for Web */}
            {isHEVCContent(title) && (
              <View style={styles.hevcWarningBanner}>
                <Ionicons name="warning" size={16} color="#FFA500" />
                <Text style={styles.hevcWarningText}>
                  HEVC/x265 codec detected - may show black screen on web.
                </Text>
              </View>
            )}
            <video
              src={streamUrl}
              controls
              autoPlay
              playsInline
              onEnded={() => handlePlaybackEnd()}
              style={{ 
                width: '100%', 
                height: '100%', 
                backgroundColor: '#000',
                objectFit: 'contain'
              } as any}
            />
            {/* Subtitle Overlay for Web */}
            {currentSubtitleText && (
              <View style={styles.subtitleContainer}>
                <Text style={styles.subtitleText}>{currentSubtitleText}</Text>
              </View>
            )}
            {/* Web Controls Overlay - always visible */}
            <View style={styles.webControlsOverlay}>
              <TouchableOpacity style={styles.controlButton} onPress={handleBack}>
                <Ionicons name="arrow-back" size={28} color="#FFFFFF" />
              </TouchableOpacity>
              
              <View style={styles.topRightControls}>
                <TouchableOpacity 
                  style={[styles.controlButton, selectedSubtitle && styles.ccActive]}
                  onPress={() => setShowSubtitlePicker(true)}
                >
                  <Ionicons name="text" size={24} color={selectedSubtitle ? '#B8A05C' : '#FFFFFF'} />
                </TouchableOpacity>
                
                {nextEpisodeId && (
                  <TouchableOpacity style={styles.controlButton} onPress={playNextEpisode}>
                    <Ionicons name="play-skip-forward" size={24} color="#FFFFFF" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        ) : (
          <TouchableOpacity 
            activeOpacity={1} 
            style={styles.videoContainer}
            onPress={handleVideoTap}
          >
            <Video
              ref={videoRef}
              source={{ uri: streamUrl }}
              style={styles.videoPlayer}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay
              isLooping={false}
              volume={1.0}
              isMuted={false}
              onPlaybackStatusUpdate={handlePlaybackStatus}
              onError={(error) => {
                console.log('[PLAYER] Video error:', error);
                if (fallbackUrls.length > currentStreamIndex + 1) {
                  tryNextStream();
                } else {
                  setError('Failed to play video. All streams failed.');
                  setHasAudioError(true);
                }
              }}
            />
            
            {/* Subtitle Overlay */}
            {currentSubtitleText && (
              <View style={styles.subtitleContainer}>
                <Text style={styles.subtitleText}>{currentSubtitleText}</Text>
              </View>
            )}
            
            {/* Custom Controls Overlay - fades in/out */}
            {showControls && (
              <Animated.View style={[styles.controlsOverlay, { opacity: controlsOpacity }]}>
                {/* Top Bar - Back, Title, CC, Next */}
                <View style={styles.topControls}>
                  <TouchableOpacity style={styles.controlButton} onPress={handleBack}>
                    <Ionicons name="arrow-back" size={28} color="#FFFFFF" />
                  </TouchableOpacity>
                  
                  <Text style={styles.titleText} numberOfLines={1}>{title || 'Playing'}</Text>
                  
                  <View style={styles.topRightControls}>
                    <TouchableOpacity 
                      style={[styles.controlButton, selectedSubtitle && styles.ccActive]}
                      onPress={() => setShowSubtitlePicker(true)}
                    >
                      <Ionicons name="text" size={24} color={selectedSubtitle ? '#B8A05C' : '#FFFFFF'} />
                    </TouchableOpacity>
                    
                    {nextEpisodeId && (
                      <TouchableOpacity style={styles.controlButton} onPress={playNextEpisode}>
                        <Ionicons name="play-skip-forward" size={24} color="#FFFFFF" />
                      </TouchableOpacity>
                    )}
                    
                    <TouchableOpacity style={styles.controlButton} onPress={openInExternalPlayer}>
                      <Ionicons name="open-outline" size={24} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                </View>
                
                {/* Center Play/Pause */}
                <View style={styles.centerControls}>
                  <TouchableOpacity style={styles.playPauseButton} onPress={togglePlayPause}>
                    <Ionicons name={isPlaying ? "pause" : "play"} size={50} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
                
                {/* Bottom Bar - Progress */}
                <View style={styles.bottomControls}>
                  <Text style={styles.timeText}>{formatTime(position)}</Text>
                  <View style={styles.progressBarContainer}>
                    <View style={[styles.progressBarFill, { width: `${duration > 0 ? (position / duration) * 100 : 0}%` }]} />
                  </View>
                  <Text style={styles.timeText}>{formatTime(duration)}</Text>
                </View>
              </Animated.View>
            )}
          </TouchableOpacity>
        )
      )}

      {/* Subtitle Picker Modal */}
      <Modal
        visible={showSubtitlePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSubtitlePicker(false)}
      >
        <View style={styles.subtitleModalOverlay}>
          <View style={styles.subtitleModal}>
            <View style={styles.subtitleModalHeader}>
              <Text style={styles.subtitleModalTitle}>Select Subtitles</Text>
              <TouchableOpacity onPress={() => setShowSubtitlePicker(false)}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            
            {subtitles.length === 0 ? (
              <View style={styles.noSubtitlesContainer}>
                <Ionicons name="text-outline" size={48} color="#666" />
                <Text style={styles.noSubtitlesText}>No subtitles available</Text>
                <Text style={styles.noSubtitlesHint}>Subtitles will appear here when available</Text>
              </View>
            ) : (
              <FlatList
                data={[{ id: 'off', url: '', lang: 'off', langName: 'Off' }, ...subtitles]}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.subtitleItem,
                      (item.url === selectedSubtitle || (item.lang === 'off' && !selectedSubtitle)) && styles.subtitleItemActive
                    ]}
                    onPress={() => {
                      setSelectedSubtitle(item.lang === 'off' ? null : item.url);
                      setShowSubtitlePicker(false);
                    }}
                  >
                    <Text style={[
                      styles.subtitleItemText,
                      (item.url === selectedSubtitle || (item.lang === 'off' && !selectedSubtitle)) && styles.subtitleItemTextActive
                    ]}>
                      {item.langName}
                    </Text>
                    {(item.url === selectedSubtitle || (item.lang === 'off' && !selectedSubtitle)) && (
                      <Ionicons name="checkmark" size={20} color="#B8A05C" />
                    )}
                  </TouchableOpacity>
                )}
                style={styles.subtitleList}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Next Episode Modal */}
      <Modal
        visible={showNextEpisodeModal}
        transparent
        animationType="fade"
        onRequestClose={dismissCreditsPopup}
      >
        <View style={styles.nextEpisodeModalOverlay}>
          <View style={styles.nextEpisodeModal}>
            <View style={styles.nextEpisodeHeader}>
              <Ionicons name="play-skip-forward" size={32} color="#B8A05C" />
              <Text style={styles.nextEpisodeTitle}>Up Next</Text>
            </View>
            
            <Text style={styles.nextEpisodeInfo}>
              {nextEpisodeTitle || 'Next Episode'}
            </Text>
            
            <Text style={styles.countdownText}>
              Returning to stream selection in {countdown}s
            </Text>
            
            <View style={styles.nextEpisodeButtons}>
              <TouchableOpacity 
                style={styles.watchCreditsButton}
                onPress={dismissCreditsPopup}
              >
                <Ionicons name="eye" size={20} color="#FFFFFF" />
                <Text style={styles.watchCreditsButtonText}>Watch Credits</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.playNextButton}
                onPress={playNextEpisode}
              >
                <Ionicons name="play" size={20} color="#000" />
                <Text style={styles.playNextButtonText}>Play Next</Text>
              </TouchableOpacity>
            </View>
            
            <TouchableOpacity 
              style={styles.goBackLink}
              onPress={handleGoBack}
            >
              <Text style={styles.goBackLinkText}>Go Back to Stream Selection</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  videoContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  videoPlayer: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  hevcWarningBanner: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(255, 165, 0, 0.9)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 200,
  },
  hevcWarningText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
    flex: 1,
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
  progressBarBg: {
    width: '100%',
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#B8A05C',
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
    backgroundColor: '#333',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  // Subtitle display
  subtitleContainer: {
    position: 'absolute',
    bottom: 80,
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 90,
  },
  subtitleText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 4,
    overflow: 'hidden',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  // Controls overlay
  webControlsOverlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 100,
  },
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'space-between',
  },
  topControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  titleText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginHorizontal: 12,
    textAlign: 'center',
  },
  topRightControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  ccActive: {
    backgroundColor: 'rgba(184, 160, 92, 0.5)',
  },
  centerControls: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playPauseButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  timeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '500',
    minWidth: 50,
    textAlign: 'center',
  },
  progressBarContainer: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 2,
    marginHorizontal: 12,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#B8A05C',
    borderRadius: 2,
  },
  // Subtitle modal
  subtitleModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  subtitleModal: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '60%',
    paddingBottom: 30,
  },
  subtitleModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  subtitleModalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  subtitleList: {
    maxHeight: 400,
  },
  subtitleItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  subtitleItemActive: {
    backgroundColor: 'rgba(184, 160, 92, 0.2)',
  },
  subtitleItemText: {
    color: '#FFFFFF',
    fontSize: 16,
  },
  subtitleItemTextActive: {
    color: '#B8A05C',
    fontWeight: '600',
  },
  noSubtitlesContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  noSubtitlesText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 16,
  },
  noSubtitlesHint: {
    color: '#888',
    fontSize: 14,
    marginTop: 8,
  },
  // Next Episode Modal
  nextEpisodeModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  nextEpisodeModal: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    width: '85%',
    maxWidth: 400,
    alignItems: 'center',
  },
  nextEpisodeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  nextEpisodeTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginLeft: 12,
  },
  nextEpisodeInfo: {
    color: '#CCCCCC',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  countdownText: {
    color: '#888',
    fontSize: 14,
    marginBottom: 24,
  },
  nextEpisodeButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 16,
  },
  watchCreditsButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#333',
    paddingVertical: 14,
    borderRadius: 8,
    marginRight: 8,
  },
  watchCreditsButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  goBackButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#333',
    paddingVertical: 14,
    borderRadius: 8,
    marginRight: 8,
  },
  goBackButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  goBackLink: {
    paddingVertical: 8,
  },
  goBackLinkText: {
    color: '#888',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  playNextButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B8A05C',
    paddingVertical: 14,
    borderRadius: 8,
    marginLeft: 8,
  },
  playNextButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});
