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
  Image,
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

// Conditionally import Google Cast (only available in native builds)
let CastButton: any = null;
let GoogleCast: any = null;
let useCastState: any = null;
let useRemoteMediaClient: any = null;
let CastState: any = null;

if (Platform.OS !== 'web') {
  try {
    const googleCastModule = require('react-native-google-cast');
    CastButton = googleCastModule.CastButton;
    GoogleCast = googleCastModule.default;
    useCastState = googleCastModule.useCastState;
    useRemoteMediaClient = googleCastModule.useRemoteMediaClient;
    CastState = googleCastModule.CastState;
    console.log('[CAST] Google Cast module loaded successfully');
  } catch (e) {
    console.log('[CAST] Google Cast not available (expected in Expo Go/web)');
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
    // Visual assets
    backdrop,
    poster,
    logo,
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
    backdrop?: string;
    poster?: string;
    logo?: string;
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
  const [subtitleOffset, setSubtitleOffset] = useState<number>(0); // Offset in ms (positive = subtitles appear later)
  
  // Google Cast state
  const [isCasting, setIsCasting] = useState(false);
  const [castAvailable, setCastAvailable] = useState(false);
  
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
  
  // Handle casting to Chromecast/Google Cast device
  const handleCastToDevice = useCallback(async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Cast Not Available', 'Casting is only available in the mobile app. Please install the APK on your device to use casting.');
      return;
    }
    
    if (!GoogleCast) {
      Alert.alert('Cast Not Available', 'Google Cast is not available. Please use a production build of the app.');
      return;
    }
    
    try {
      console.log('[CAST] Attempting to cast:', streamUrl);
      
      // Get the cast session
      const castSession = await GoogleCast.getCastSession();
      
      if (!castSession) {
        // Show cast dialog to select device
        await GoogleCast.showCastDialog();
        return;
      }
      
      // Prepare media info for casting
      const mediaInfo = {
        contentId: streamUrl,
        contentType: 'video/mp4',
        streamType: 'BUFFERED',
        metadata: {
          type: 'movie',
          title: title || 'Video',
        }
      };
      
      // Load media to cast device
      await castSession.loadMedia({
        mediaInfo,
        autoplay: true,
        playPosition: position / 1000, // Convert ms to seconds
      });
      
      setIsCasting(true);
      console.log('[CAST] Successfully started casting');
      
    } catch (error) {
      console.error('[CAST] Error casting:', error);
      Alert.alert('Cast Error', 'Failed to cast to device. Please make sure your device is connected to the same network as your Chromecast.');
    }
  }, [streamUrl, title, position]);
  
  // Check cast availability on mount
  useEffect(() => {
    if (GoogleCast && Platform.OS !== 'web') {
      // Check if casting is available
      GoogleCast.getCastState().then((state: any) => {
        console.log('[CAST] Cast state:', state);
        setCastAvailable(state !== 'NoDevicesAvailable');
      }).catch((e: any) => {
        console.log('[CAST] Could not get cast state:', e);
      });
    }
  }, []);

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
  
  // Update current subtitle based on position (with offset adjustment)
  useEffect(() => {
    if (subtitleCues.length > 0) {
      // Apply offset: positive offset = subtitles appear later (subtract from position)
      // negative offset = subtitles appear earlier (add to position)
      const adjustedPosition = position - subtitleOffset;
      const currentCue = subtitleCues.find(
        cue => adjustedPosition >= cue.start && adjustedPosition <= cue.end
      );
      setCurrentSubtitleText(currentCue?.text || '');
    } else {
      setCurrentSubtitleText('');
    }
  }, [position, subtitleCues, subtitleOffset]);
  
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
  
  // Credits detection settings - show popup near the end
  const CREDITS_TIME_REMAINING_MS = 30000; // Show popup when 30 seconds remaining
  const CREDITS_PERCENTAGE = 0.98; // Or when 98% complete
  const MIN_DURATION_FOR_CREDITS = 180000; // Only detect credits for videos > 3 minutes
  
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
  
  // Dismiss credits popup (keep watching) - DON'T reset creditsShownRef
  const dismissCreditsPopup = () => {
    // Clear countdown
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setShowNextEpisodeModal(false);
    // Do NOT reset creditsShownRef - we don't want popup to reappear
    // User chose to watch credits, popup will not show again for this video
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
    // Clear any existing timeout
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }
    
    Animated.timing(controlsOpacity, {
      toValue: show ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      if (!show) setShowControls(false);
    });
    if (show) {
      setShowControls(true);
      // Auto-hide controls after 3 seconds
      controlsTimeoutRef.current = setTimeout(() => {
        fadeControls(false);
      }, 3000);
    }
  };
  
  // Show controls on any interaction and reset auto-hide timer
  const showControlsWithTimeout = () => {
    // Clear existing timeout
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }
    
    // Show controls if hidden
    if (!showControls) {
      setShowControls(true);
      Animated.timing(controlsOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
    
    // Set new auto-hide timeout
    controlsTimeoutRef.current = setTimeout(() => {
      fadeControls(false);
    }, 3000);
  };
  
  // Initial show controls with auto-hide
  useEffect(() => {
    if (streamUrl && !error && !isLoading) {
      showControlsWithTimeout();
    }
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [streamUrl, error, isLoading]);
  
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
      console.log('[SUBTITLES] Making API call for:', cType, cId);
      const response = await api.subtitles.get(cType, cId);
      console.log('[SUBTITLES] API response:', response);
      
      if (response?.subtitles && response.subtitles.length > 0) {
        console.log(`[SUBTITLES] Setting ${response.subtitles.length} subtitle options`);
        setSubtitles(response.subtitles);
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
            // Keep isLoading true - it will be set to false when video actually starts playing
            // This keeps the Stremio loading screen visible until playback begins
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

      {/* Stremio-Style Loading Screen */}
      {isLoading && !error && (
        <View style={styles.stremioLoadingContainer}>
          {/* Backdrop Image */}
          {(backdrop || poster) && (
            <Image
              source={{ uri: backdrop || poster }}
              style={styles.loadingBackdrop}
              blurRadius={Platform.OS === 'web' ? 0 : 3}
            />
          )}
          
          {/* Dark Overlay */}
          <View style={styles.loadingDarkOverlay} />
          
          {/* Content */}
          <View style={styles.loadingContent}>
            {/* Logo/Title as Loading Bar - Exact Stremio Style */}
            {logo ? (
              // Use the actual movie logo image with fill effect
              Platform.OS === 'web' ? (
                <div style={{
                  position: 'relative',
                  width: '80%',
                  maxWidth: 600,
                  height: 120,
                  marginBottom: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {/* Faded logo (background) */}
                  <img 
                    src={logo}
                    alt={title || 'Loading'}
                    style={{
                      position: 'absolute',
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      opacity: 0.3,
                      filter: 'grayscale(100%)',
                    }}
                  />
                  {/* Filled logo (foreground with clip) */}
                  <div style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: `${Math.min(Math.max(downloadProgress || 0, 0), 100)}%`,
                    height: '100%',
                    overflow: 'hidden',
                    transition: 'width 0.3s ease',
                  }}>
                    <img 
                      src={logo}
                      alt={title || 'Loading'}
                      style={{
                        width: '100%',
                        minWidth: 600,
                        height: '100%',
                        objectFit: 'contain',
                        objectPosition: 'left center',
                      }}
                    />
                  </div>
                </div>
              ) : (
                // Native: Logo with overlay fill effect
                <View style={styles.logoWrapper}>
                  {/* Faded logo (background) */}
                  <Image
                    source={{ uri: logo }}
                    style={styles.logoUnfilled}
                    resizeMode="contain"
                  />
                  {/* Filled logo (foreground with clip) */}
                  <View style={[styles.logoFillClip, { width: `${Math.min(Math.max(downloadProgress || 0, 0), 100)}%` }]}>
                    <Image
                      source={{ uri: logo }}
                      style={styles.logoFilled}
                      resizeMode="contain"
                    />
                  </View>
                </View>
              )
            ) : (
              // Fallback to text title if no logo
              Platform.OS === 'web' ? (
                <div style={{
                  position: 'relative',
                  width: '100%',
                  textAlign: 'center',
                  marginBottom: 32,
                }}>
                  <h1 style={{
                    fontSize: 48,
                    fontWeight: 800,
                    margin: 0,
                    padding: 0,
                    letterSpacing: 2,
                    background: `linear-gradient(90deg, #FFFFFF ${downloadProgress || 0}%, rgba(255,255,255,0.3) ${downloadProgress || 0}%)`,
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    transition: 'background 0.3s ease',
                  }}>
                    {title || 'Loading...'}
                  </h1>
                </div>
              ) : (
                <View style={styles.titleWrapper}>
                  <Text style={styles.titleUnfilled} numberOfLines={1} adjustsFontSizeToFit>
                    {title || 'Loading...'}
                  </Text>
                  <View style={styles.titleFillContainer}>
                    <View 
                      style={[
                        styles.titleFillClip, 
                        { width: `${Math.min(Math.max(downloadProgress || 0, 0), 100)}%` }
                      ]}
                    >
                      <Text style={styles.titleFilled} numberOfLines={1}>
                        {title || 'Loading...'}
                      </Text>
                    </View>
                  </View>
                </View>
              )
            )}
            
            {/* Loading Status */}
            <Text style={styles.loadingStatusText}>{loadingStatus}</Text>
            
            {/* Stats Row */}
            {infoHash && (
              <View style={styles.loadingStatsRow}>
                <View style={styles.loadingStat}>
                  <Ionicons name="people-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.loadingStatText}>{peers} peers</Text>
                </View>
                <View style={styles.loadingStat}>
                  <Ionicons name="arrow-down-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.loadingStatText}>{formatSpeed(downloadSpeed)}</Text>
                </View>
                <View style={styles.loadingStat}>
                  <Ionicons name="disc-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.loadingStatText}>{downloadProgress.toFixed(0)}%</Text>
                </View>
              </View>
            )}
          </View>
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
      {streamUrl && !error && (
        Platform.OS === 'web' ? (
          <View 
            style={[styles.videoContainer, isLoading && { position: 'absolute', opacity: 0 }]}
            // @ts-ignore - web-specific events
            onMouseMove={() => !isLoading && showControlsWithTimeout()}
            onMouseEnter={() => !isLoading && showControlsWithTimeout()}
          >
            {/* HEVC Warning Banner for Web */}
            {isHEVCContent(title) && !isLoading && (
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
              onCanPlay={() => {
                console.log('[PLAYER] Video can play - hiding loading screen');
                setIsLoading(false);
              }}
              onMouseMove={() => !isLoading && showControlsWithTimeout()}
              onEnded={() => handlePlaybackEnd()}
              onTimeUpdate={(e: any) => {
                const video = e.target;
                const currentTime = video.currentTime * 1000; // Convert to ms
                const totalDuration = video.duration * 1000; // Convert to ms
                const timeRemaining = totalDuration - currentTime;
                const percentComplete = totalDuration > 0 ? currentTime / totalDuration : 0;
                
                // Update position for subtitles
                setPosition(currentTime);
                setDuration(totalDuration);
                
                // Credits detection for web
                if (
                  nextEpisodeId && 
                  contentType === 'series' && 
                  !creditsShownRef.current && 
                  !showNextEpisodeModal &&
                  totalDuration > MIN_DURATION_FOR_CREDITS &&
                  (timeRemaining <= CREDITS_TIME_REMAINING_MS || percentComplete >= CREDITS_PERCENTAGE)
                ) {
                  console.log(`[PLAYER-WEB] Credits detected! Time remaining: ${(timeRemaining/1000).toFixed(0)}s, ${(percentComplete*100).toFixed(1)}% complete`);
                  creditsShownRef.current = true;
                  showCreditsPopup();
                }
              }}
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
            {/* Web Controls Overlay - fades in/out */}
            {showControls && (
              <Animated.View style={[styles.webControlsOverlay, { opacity: controlsOpacity }]}>
                <TouchableOpacity style={styles.controlButton} onPress={handleBack}>
                  <Ionicons name="arrow-back" size={28} color="#FFFFFF" />
                </TouchableOpacity>
              
              <View style={styles.topRightControls}>
                {/* Cast Button */}
                <TouchableOpacity 
                  style={[styles.controlButton, isCasting && styles.castActive]}
                  onPress={handleCastToDevice}
                >
                  <Ionicons 
                    name={isCasting ? "tv" : "tv-outline"} 
                    size={24} 
                    color={isCasting ? '#B8A05C' : '#FFFFFF'} 
                  />
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[styles.controlButton, selectedSubtitle && styles.ccActive]}
                  onPress={() => setShowSubtitlePicker(true)}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={24} color={selectedSubtitle ? '#B8A05C' : '#FFFFFF'} />
                </TouchableOpacity>
                
                {nextEpisodeId && (
                  <TouchableOpacity style={styles.controlButton} onPress={playNextEpisode}>
                    <Ionicons name="play-skip-forward" size={24} color="#FFFFFF" />
                  </TouchableOpacity>
                )}
              </View>
            </Animated.View>
            )}
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
                    {/* Cast Button */}
                    <TouchableOpacity 
                      style={[styles.controlButton, isCasting && styles.castActive]}
                      onPress={handleCastToDevice}
                    >
                      <Ionicons 
                        name={isCasting ? "tv" : "tv-outline"} 
                        size={24} 
                        color={isCasting ? '#B8A05C' : '#FFFFFF'} 
                      />
                    </TouchableOpacity>
                    
                    <TouchableOpacity 
                      style={[styles.controlButton, selectedSubtitle && styles.ccActive]}
                      onPress={() => setShowSubtitlePicker(true)}
                    >
                      <Ionicons name="chatbubble-ellipses-outline" size={24} color={selectedSubtitle ? '#B8A05C' : '#FFFFFF'} />
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
              <Text style={styles.subtitleModalTitle}>Subtitles</Text>
              <TouchableOpacity onPress={() => setShowSubtitlePicker(false)}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            
            {/* Subtitle Sync Controls */}
            {selectedSubtitle && (
              <View style={styles.syncControlsContainer}>
                <Text style={styles.syncLabel}>Sync Adjustment</Text>
                <View style={styles.syncControls}>
                  <TouchableOpacity 
                    style={styles.syncButton}
                    onPress={() => setSubtitleOffset(prev => prev - 500)}
                  >
                    <Text style={styles.syncButtonText}>-0.5s</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={styles.syncButton}
                    onPress={() => setSubtitleOffset(prev => prev - 100)}
                  >
                    <Text style={styles.syncButtonText}>-0.1s</Text>
                  </TouchableOpacity>
                  <View style={styles.syncValueContainer}>
                    <Text style={styles.syncValue}>
                      {subtitleOffset >= 0 ? '+' : ''}{(subtitleOffset / 1000).toFixed(1)}s
                    </Text>
                  </View>
                  <TouchableOpacity 
                    style={styles.syncButton}
                    onPress={() => setSubtitleOffset(prev => prev + 100)}
                  >
                    <Text style={styles.syncButtonText}>+0.1s</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={styles.syncButton}
                    onPress={() => setSubtitleOffset(prev => prev + 500)}
                  >
                    <Text style={styles.syncButtonText}>+0.5s</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity 
                  style={styles.resetSyncButton}
                  onPress={() => setSubtitleOffset(0)}
                >
                  <Text style={styles.resetSyncText}>Reset to 0</Text>
                </TouchableOpacity>
                <Text style={styles.syncHint}>
                  Subtitles too early? Use + | Too late? Use -
                </Text>
              </View>
            )}
            
            {subtitles.length === 0 ? (
              <View style={styles.noSubtitlesContainer}>
                <Ionicons name="chatbubble-ellipses-outline" size={48} color="#666" />
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
              Playing next episode in {countdown}s
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
                <Text style={styles.playNextButtonText}>Play Now</Text>
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
  // Stremio-style Loading Screen
  stremioLoadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    backgroundColor: '#000',
  },
  loadingBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.4,
  },
  loadingDarkOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  loadingContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  // Logo as progress bar - Stremio style
  logoWrapper: {
    position: 'relative',
    width: '80%',
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  logoUnfilled: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    opacity: 0.3,
    tintColor: '#888',
  },
  logoFillClip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  logoFilled: {
    width: Dimensions.get('window').width * 0.8,
    height: '100%',
  },
  // Title as progress bar - Stremio style (fallback)
  titleWrapper: {
    position: 'relative',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
    height: 60,
  },
  titleUnfilled: {
    fontSize: 42,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.3)',
    textAlign: 'center',
    letterSpacing: 2,
  },
  titleFillContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleFillClip: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  titleFilled: {
    fontSize: 42,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 2,
    textAlign: 'center',
    width: Dimensions.get('window').width - 48,
  },
  loadingStatusText: {
    color: '#FFFFFF',
    fontSize: 14,
    marginBottom: 24,
    textAlign: 'center',
    opacity: 0.8,
  },
  loadingStatsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 32,
  },
  loadingStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  loadingStatText: {
    color: '#FFFFFF',
    fontSize: 13,
    opacity: 0.7,
  },
  // Legacy loading styles (keep for compatibility)
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
  castActive: {
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
  // Subtitle Sync Controls
  syncControlsContainer: {
    backgroundColor: '#252525',
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
  },
  syncLabel: {
    color: '#B8A05C',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 12,
  },
  syncControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  syncButton: {
    backgroundColor: '#333',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 50,
    alignItems: 'center',
  },
  syncButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  syncValueContainer: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 70,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#B8A05C',
  },
  syncValue: {
    color: '#B8A05C',
    fontSize: 14,
    fontWeight: '700',
  },
  resetSyncButton: {
    marginTop: 12,
    paddingVertical: 8,
  },
  resetSyncText: {
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  syncHint: {
    color: '#666',
    fontSize: 11,
    textAlign: 'center',
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
