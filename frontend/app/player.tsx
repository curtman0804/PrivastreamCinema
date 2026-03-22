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
  Pressable,
  DeviceEventEmitter,
  findNodeHandle,
} from 'react-native';

// Safe TV event handler imports - these may not exist in all RN versions
let useTVEventHandler: any = null;
let TVEventHandler: any = null;
try {
  const RN = require('react-native');
  useTVEventHandler = RN.useTVEventHandler || null;
  TVEventHandler = RN.TVEventHandler || null;
} catch (e) {
  console.log('[TV] TV event handlers not available');
}
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../src/api/client';
import * as ScreenOrientation from 'expo-screen-orientation';
import Constants from 'expo-constants';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { Modal, FlatList } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useKeepAwake } from 'expo-keep-awake';
import * as NavigationBar from 'expo-navigation-bar';

// Local torrent streaming engine (runs on device via nodejs-mobile, like Stremio)
let LocalNodejs: any = null;
const LOCAL_PORT = 8088;
const LOCAL_BASE_URL = `http://localhost:${LOCAL_PORT}`;
let localEngineRunning = false;

try {
  LocalNodejs = require('nodejs-mobile-react-native').default;
  // Start Node.js if not already started
  if (!localEngineRunning) {
    LocalNodejs.start('main.js');
    localEngineRunning = true;
    LocalNodejs.channel.addListener('message', (msg: string) => {
      try {
        const data = JSON.parse(msg);
        if (data.type === 'server_ready') {
          console.log(`[LOCAL-ENGINE] Server ready on port ${data.port}`);
          localEngineRunning = true;
        } else if (data.type === 'engine_ready') {
          console.log(`[LOCAL-ENGINE] Engine ready: ${data.fileName}`);
        }
      } catch (e) {}
    });
    console.log('[LOCAL-ENGINE] Node.js runtime starting...');
  }
} catch (e) {
  console.log('[LOCAL-ENGINE] nodejs-mobile not available, using cloud backend');
}

// Check if running on TV
const isTV = Platform.isTV || Platform.OS === 'android';

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

// TV Focus Button Component - handles focus state for D-pad navigation
function TVFocusButton({ 
  onPress, 
  style, 
  focusedStyle,
  children,
  hasTVPreferredFocus = false,
}: {
  onPress?: () => void;
  style: any;
  focusedStyle?: any;
  children: React.ReactNode;
  hasTVPreferredFocus?: boolean;
}) {
  const [isFocused, setIsFocused] = useState(false);
  
  return (
    <Pressable
      style={[style, isFocused && focusedStyle]}
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      hasTVPreferredFocus={hasTVPreferredFocus}
    >
      {children}
    </Pressable>
  );
}

// Seekable Progress Bar Component for TV - handles left/right D-pad for seeking
// CRITICAL: Uses nextFocusLeft/nextFocusRight pointing to self to TRAP focus,
// so D-pad left/right doesn't move focus away. Instead, the DeviceEventEmitter
// handler detects left/right when this bar is focused and seeks the video.
function SeekableProgressBar({
  position,
  duration,
  onSeek,
  onFocusChange,
  style,
  focusedStyle,
}: {
  position: number;
  duration: number;
  onSeek: (newPosition: number) => void;
  onFocusChange?: (focused: boolean) => void;
  style?: any;
  focusedStyle?: any;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const barRef = useRef<View>(null);
  const [selfTag, setSelfTag] = useState<number>(0);
  
  // Get native tag for self-referencing focus trap
  useEffect(() => {
    const timer = setTimeout(() => {
      if (barRef.current) {
        try {
          const tag = findNodeHandle(barRef.current);
          if (tag && tag > 0) {
            setSelfTag(tag);
          }
        } catch (e) {
          // findNodeHandle not available
        }
      }
    }, 200);
    return () => clearTimeout(timer);
  }, []);
  
  const percentage = duration > 0 ? (position / duration) * 100 : 0;
  
  // Build focus trap props - when focused, left/right stays on this bar
  const focusTrapProps: any = {};
  if (selfTag > 0) {
    focusTrapProps.nextFocusLeft = selfTag;
    focusTrapProps.nextFocusRight = selfTag;
  }
  
  return (
    <Pressable
      ref={barRef}
      style={[styles.progressBarContainer, style, isFocused && (focusedStyle || styles.progressBarFocused)]}
      onFocus={() => { setIsFocused(true); onFocusChange?.(true); }}
      onBlur={() => { setIsFocused(false); onFocusChange?.(false); }}
      {...focusTrapProps}
    >
      <View style={[styles.progressBarFill, { width: `${percentage}%` }]} />
      <View style={[styles.progressBarThumb, { left: `${percentage}%` }]} />
      {isFocused && (
        <View style={styles.seekHint}>
          <Text style={styles.seekHintText}>◀ -10s  |  +10s ▶</Text>
        </View>
      )}
    </Pressable>
  );
}

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
  // Keep screen awake during playback
  useKeepAwake();
  
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
    // Resume position (from continue watching)
    resumePosition,
    // Tracker sources from Torrentio (CRITICAL for peer discovery)
    sources,
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
    resumePosition?: string;
    sources?: string;
  }>();
  const router = useRouter();
  
  // Hide navigation bar on Android for immersive video experience
  useEffect(() => {
    const setupImmersiveMode = async () => {
      if (Platform.OS === 'android') {
        try {
          await NavigationBar.setVisibilityAsync('hidden');
          await NavigationBar.setBehaviorAsync('overlay-swipe');
        } catch (e) {
          console.log('Could not hide navigation bar:', e);
        }
      }
    };
    
    setupImmersiveMode();
    
    return () => {
      // Restore navigation bar when leaving player
      if (Platform.OS === 'android') {
        NavigationBar.setVisibilityAsync('visible').catch(() => {});
      }
    };
  }, []);
  
  // Resume position in seconds (from continue watching)
  const parsedResumePosition = resumePosition ? parseFloat(resumePosition) : null;
  console.log(`[PLAYER] Route params - resumePosition: "${resumePosition}", parsed: ${parsedResumePosition}`);
  
  const [pendingResumePosition, setPendingResumePosition] = useState<number | null>(parsedResumePosition);
  const hasResumedRef = useRef(false); // Track if we've already attempted resume
  
  // Update pending resume position when route param changes
  useEffect(() => {
    if (resumePosition) {
      const parsed = parseFloat(resumePosition);
      if (!isNaN(parsed) && parsed > 0) {
        console.log(`[PLAYER] Setting pending resume position from route param: ${parsed}s`);
        setPendingResumePosition(parsed);
        hasResumedRef.current = false; // Reset resume flag
      }
    }
  }, [resumePosition]);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isRebuffering, setIsRebuffering] = useState(false); // Shows spinner during seek/rebuffer
  const [error, setError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [peers, setPeers] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [isLiveTV, setIsLiveTV] = useState(false);
  const [hasAudioError, setHasAudioError] = useState(false);
  const videoRetryCountRef = useRef(0);
  const maxVideoRetries = 15; // More retries - torrent data arrives progressively
  
  // Track seek state to prevent URL reset during seeking
  const isSeekingRef = useRef(false);
  const lastSeekPositionRef = useRef<number>(0);
  
  // Stremio-style breathing zoom animation for loading title
  const breatheAnim = useRef(new Animated.Value(1)).current;
  
  useEffect(() => {
    if (isLoading && !error) {
      const breathe = Animated.loop(
        Animated.sequence([
          Animated.timing(breatheAnim, {
            toValue: 1.06,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.timing(breatheAnim, {
            toValue: 0.96,
            duration: 2000,
            useNativeDriver: true,
          }),
        ])
      );
      breathe.start();
      return () => breathe.stop();
    }
  }, [isLoading, error]);
  
  // Fallback streams for auto-retry
  const [fallbackUrls, setFallbackUrls] = useState<string[]>([]);
  const [currentStreamIndex, setCurrentStreamIndex] = useState(-1);
  const [playbackStarted, setPlaybackStarted] = useState(false);
  const playbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // NO safety timeout - let the torrent download and ExoPlayer buffer naturally.
  // First-click torrents need 30-60+ seconds for metadata + initial pieces.
  // The loading screen (breathing zoom + fill) provides good UX during this wait.
  // ExoPlayer's onError handler + retry mechanism handles actual failures.
  // The user can always press back to cancel if they don't want to wait.
  
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
  
  // Refs to track latest state values for TV event handler (avoids stale closures)
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const positionRef = useRef(position);
  positionRef.current = position;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const progressBarFocusedRef = useRef(false);
  const showControlsWithTimeoutRef = useRef<(() => void) | null>(null);
  
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const continuePollingRef = useRef(true);
  
  // Track actual video file size from backend status (used for accurate seek byte calculation)
  const videoFileSizeRef = useRef<number>(0);
  
  // Watch progress tracking
  const lastProgressSaveRef = useRef<number>(0);
  const progressSaveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Refs to store current position/duration for saving on exit
  const currentPositionRef = useRef(0);
  const currentDurationRef = useRef(0);
  
  // Save watch progress to backend
  const saveWatchProgress = useCallback(async (currentPosition: number, totalDuration: number, force: boolean = false) => {
    // Don't save if no content info or if it's live TV
    if (!contentId || !contentType || isLive === 'true' || totalDuration <= 0) return;
    
    // Update refs for exit save
    currentPositionRef.current = currentPosition;
    currentDurationRef.current = totalDuration;
    
    // Don't save too frequently (minimum 5 seconds between saves) unless forced
    const now = Date.now();
    if (!force && now - lastProgressSaveRef.current < 5000) return;
    lastProgressSaveRef.current = now;
    
    try {
      await api.watchProgress.save({
        content_id: contentId,
        content_type: contentType,
        title: title || 'Unknown',
        poster: poster || undefined,
        backdrop: backdrop || undefined,
        logo: logo || undefined,
        progress: currentPosition / 1000, // Convert ms to seconds
        duration: totalDuration / 1000, // Convert ms to seconds
        season: season ? parseInt(season) : undefined,
        episode: episode ? parseInt(episode) : undefined,
        series_id: seriesId || undefined,
        // Save stream info for resuming playback
        stream_info_hash: infoHash || undefined,
        stream_url: directUrl || url || undefined,
        stream_file_idx: fileIdx ? parseInt(fileIdx) : undefined,
        stream_filename: filename || undefined,
      });
      console.log('[PLAYER] Watch progress saved:', currentPosition / 1000, '/', totalDuration / 1000);
    } catch (err) {
      console.log('[PLAYER] Failed to save watch progress:', err);
    }
  }, [contentId, contentType, title, poster, backdrop, logo, season, episode, seriesId, isLive, infoHash, directUrl, url, fileIdx, filename]);
  
  // Save progress when component unmounts (user exits player)
  useEffect(() => {
    return () => {
      // Save current progress on exit
      if (currentPositionRef.current > 0 && currentDurationRef.current > 0 && contentId && contentType && isLive !== 'true') {
        console.log('[PLAYER] Saving progress on exit:', currentPositionRef.current / 1000, 's');
        // Use a synchronous-ish approach since we're unmounting
        api.watchProgress.save({
          content_id: contentId,
          content_type: contentType,
          title: title || 'Unknown',
          poster: poster || undefined,
          backdrop: backdrop || undefined,
          logo: logo || undefined,
          progress: currentPositionRef.current / 1000,
          duration: currentDurationRef.current / 1000,
          season: season ? parseInt(season) : undefined,
          episode: episode ? parseInt(episode) : undefined,
          series_id: seriesId || undefined,
          stream_info_hash: infoHash || undefined,
          stream_url: directUrl || url || undefined,
          stream_file_idx: fileIdx ? parseInt(fileIdx) : undefined,
          stream_filename: filename || undefined,
        }).catch(err => console.log('[PLAYER] Failed to save on exit:', err));
      }
    };
  }, [contentId, contentType, title, poster, backdrop, logo, season, episode, seriesId, isLive, infoHash, directUrl, url, fileIdx, filename]);
  
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
      
      // Save watch progress periodically
      if (status.isPlaying && status.durationMillis && status.durationMillis > 0) {
        saveWatchProgress(status.positionMillis, status.durationMillis);
      }
      
      // Hide loading screen when video is ACTUALLY PLAYING (not just loaded)
      // This keeps the loading screen visible during ExoPlayer's buffering phase
      if (status.isPlaying && !playbackStarted) {
        console.log('[PLAYER] Playback started successfully!');
        setPlaybackStarted(true);
        setIsRebuffering(false);
        // Animate progress to 100% then hide loading after a brief delay
        setDownloadProgress(100);
        // Small delay to show the completed animation before hiding
        setTimeout(() => {
          setIsLoading(false);
        }, 400);
        // Clear timeout since playback started
        if (playbackTimeoutRef.current) {
          clearTimeout(playbackTimeoutRef.current);
          playbackTimeoutRef.current = null;
        }
        
        // Save progress immediately when playback starts (force save)
        if (status.durationMillis && status.durationMillis > 0) {
          saveWatchProgress(status.positionMillis, status.durationMillis, true);
        }
      }
      
      // Show/hide rebuffering spinner during playback (e.g., after seeking)
      if (playbackStarted && !isLoading) {
        if (status.isBuffering && !status.isPlaying) {
          setIsRebuffering(true);
        } else if (status.isPlaying) {
          setIsRebuffering(false);
          // Clear seeking state once playback resumes after a seek
          if (isSeekingRef.current) {
            isSeekingRef.current = false;
            videoRetryCountRef.current = 0;
          }
        }
      }
      
      // Resume from saved position if coming from "Continue Watching"
      // This runs on every status update until successful
      if (pendingResumePosition && pendingResumePosition > 0 && !hasResumedRef.current && videoRef.current) {
        const resumeMs = pendingResumePosition * 1000;
        const totalDuration = status.durationMillis || 0;
        const currentPos = status.positionMillis || 0;
        
        console.log(`[PLAYER] Resume check: pending=${pendingResumePosition}s, current=${currentPos/1000}s, duration=${totalDuration/1000}s`);
        
        // Only attempt resume if we have duration info
        if (totalDuration > 0) {
          // Check if position is past 95%, then don't resume (start from beginning)
          if (resumeMs >= totalDuration * 0.95) {
            console.log(`[PLAYER] Resume position past 95%, not resuming`);
            hasResumedRef.current = true;
            setPendingResumePosition(null);
          } else {
            const positionDiff = Math.abs(currentPos - resumeMs);
            // If we're more than 3 seconds away from target, seek
            if (positionDiff > 3000) {
              console.log(`[PLAYER] Seeking to resume position: ${pendingResumePosition}s`);
              videoRef.current.setPositionAsync(resumeMs).then(() => {
                console.log(`[PLAYER] Seek completed to ${pendingResumePosition}s`);
              }).catch((err) => {
                console.log(`[PLAYER] Seek failed:`, err);
              });
            } else {
              // We're at or near the target position, mark as resumed
              console.log(`[PLAYER] Resume complete - at position: ${currentPos/1000}s`);
              hasResumedRef.current = true;
              setPendingResumePosition(null);
            }
          }
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

  // Helper to calculate byte position from time position
  const calculateBytePosition = (timeMs: number): number => {
    if (duration <= 0) return 0;
    const totalDurationSec = duration / 1000;
    const seekTimeSec = timeMs / 1000;
    let fileSize = videoFileSizeRef.current;
    if (!fileSize || fileSize <= 0) {
      const estimatedBitrate = 5 * 1024 * 1024 / 8;
      fileSize = estimatedBitrate * totalDurationSec;
    }
    return Math.floor((seekTimeSec / totalDurationSec) * fileSize);
  };

  // PREFETCH-THEN-SEEK: Download pieces at target position BEFORE seeking
  // This is exactly how Stremio handles seeking - it buffers the target first
  const prefetchAndSeek = async (targetMs: number) => {
    if (!videoRef.current) return;
    
    const clampedPosition = Math.max(0, Math.min(duration, targetMs));
    
    // Show rebuffering spinner immediately
    isSeekingRef.current = true;
    lastSeekPositionRef.current = clampedPosition;
    setIsRebuffering(true);
    showControlsWithTimeout();
    
    if (infoHash && duration > 0) {
      const positionBytes = calculateBytePosition(clampedPosition);
      
      console.log(`[PLAYER] Prefetching pieces at byte ${positionBytes} before seeking to ${(clampedPosition/1000).toFixed(1)}s...`);
      
      // Step 1: Tell backend to prefetch pieces (waits up to 30s for pieces to download)
      try {
        const prefetchResult = await api.stream.prefetch(infoHash, positionBytes);
        console.log(`[PLAYER] Prefetch result: ${prefetchResult.status}, wait=${prefetchResult.wait_ms || 0}ms`);
        
        if (prefetchResult.status === 'ready') {
          // Step 2: Pieces are ready! Now safely seek
          console.log(`[PLAYER] Pieces ready, seeking to ${(clampedPosition/1000).toFixed(1)}s`);
          try {
            await videoRef.current.setPositionAsync(clampedPosition);
          } catch (e) {
            console.log('[PLAYER] setPositionAsync failed after prefetch:', e);
          }
        } else {
          // Timeout or error - try seeking anyway (might still work with partial data)
          console.log(`[PLAYER] Prefetch ${prefetchResult.status}, seeking anyway...`);
          try {
            await videoRef.current.setPositionAsync(clampedPosition);
          } catch (e) {
            console.log('[PLAYER] setPositionAsync failed:', e);
          }
        }
      } catch (e) {
        // Prefetch call failed - seek anyway
        console.log('[PLAYER] Prefetch call failed, seeking directly:', e);
        try {
          await videoRef.current.setPositionAsync(clampedPosition);
        } catch (e2) {
          console.log('[PLAYER] Direct seek also failed:', e2);
        }
      }
      
      // Also tell libtorrent to reprioritize (belt and suspenders)
      api.stream.seek(infoHash, positionBytes).catch(() => {});
    } else {
      // No infoHash (direct URL) - just seek directly
      try {
        await videoRef.current.setPositionAsync(clampedPosition);
      } catch (e) {
        console.log('[PLAYER] Direct seek failed:', e);
      }
    }
    
    // Clear seeking state after a delay
    setTimeout(() => {
      isSeekingRef.current = false;
    }, 5000);
  };

  // Seek to position (for progress bar interaction)
  const seekToPosition = async (percentage: number) => {
    if (videoRef.current && duration > 0) {
      const newPosition = Math.floor(duration * percentage);
      await prefetchAndSeek(newPosition);
    }
  };

  // Seek to absolute position in milliseconds
  const seekToMs = async (newPositionMs: number) => {
    if (videoRef.current) {
      await prefetchAndSeek(newPositionMs);
    }
  };

  // Handle progress bar press/tap
  const handleProgressBarPress = (event: any) => {
    const { locationX } = event.nativeEvent;
    const progressBarWidth = width - 160; // Account for time text padding
    const percentage = Math.max(0, Math.min(1, locationX / progressBarWidth));
    seekToPosition(percentage);
  };

  // Format remaining time
  const formatRemainingTime = (pos: number, dur: number) => {
    if (dur <= 0) return '-:--';
    const remaining = Math.max(0, dur - pos);
    return '-' + formatTime(remaining);
  };

  // TV remote events are handled by the useEffect below with try-catch safety

  // Handle TV remote / hardware button events via native dispatchKeyEvent
  // This uses our custom config plugin (withTVKeyEvents) that intercepts
  // ALL key events at the Activity level and emits them via DeviceEventEmitter
  // 
  // CRITICAL: Empty dependency array - set up ONCE on mount.
  // Uses refs (isPlayingRef, positionRef, durationRef) for current state values
  // to avoid constant teardown/rebuild that drops events.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    
    console.log('[TV] Setting up native key event listener (stable, ref-based)');
    
    const subscription = DeviceEventEmitter.addListener('onTVKeyEvent', (evt: any) => {
      if (!evt || !evt.eventType) return;
      
      console.log('[TV] Key event:', evt.eventType, 'keyCode:', evt.keyCode);
      
      // Show controls on any button press
      showControlsWithTimeoutRef.current?.();
      
      switch (evt.eventType) {
        case 'playPause':
          // Hardware play/pause button on Fire Stick remote
          console.log('[TV] Play/Pause - isPlaying:', isPlayingRef.current);
          if (videoRef.current) {
            if (isPlayingRef.current) {
              videoRef.current.pauseAsync();
            } else {
              videoRef.current.playAsync();
            }
          }
          break;
        case 'play':
          console.log('[TV] Play');
          if (videoRef.current && !isPlayingRef.current) {
            videoRef.current.playAsync();
          }
          break;
        case 'pause':
          console.log('[TV] Pause');
          if (videoRef.current && isPlayingRef.current) {
            videoRef.current.pauseAsync();
          }
          break;
        case 'rewind':
          // Hardware rewind button on Fire Stick remote - skip back 10s
          console.log('[TV] Rewind -10s from', positionRef.current);
          if (videoRef.current) {
            const newPos = Math.max(0, positionRef.current - 10000);
            videoRef.current.setPositionAsync(newPos);
          }
          break;
        case 'fastForward':
          // Hardware fast-forward button on Fire Stick remote - skip forward 10s
          console.log('[TV] FastForward +10s from', positionRef.current);
          if (videoRef.current) {
            const newPos = Math.min(durationRef.current, positionRef.current + 10000);
            videoRef.current.setPositionAsync(newPos);
          }
          break;
        case 'left':
          // If progress bar is focused, seek backward 10s
          if (progressBarFocusedRef.current && videoRef.current) {
            console.log('[TV] Seek Left -10s (progress bar focused)');
            const newPos = Math.max(0, positionRef.current - 10000);
            videoRef.current.setPositionAsync(newPos);
          }
          break;
        case 'right':
          // If progress bar is focused, seek forward 10s
          if (progressBarFocusedRef.current && videoRef.current) {
            console.log('[TV] Seek Right +10s (progress bar focused)');
            const newPos = Math.min(durationRef.current, positionRef.current + 10000);
            videoRef.current.setPositionAsync(newPos);
          }
          break;
        case 'select':
        case 'up':
        case 'down':
          // D-pad events - just show controls (focus navigation handled natively)
          break;
      }
    });
    
    // Also try legacy TVEventHandler as fallback
    let tvEventHandler: any;
    try {
      if (TVEventHandler) {
        tvEventHandler = new TVEventHandler();
        tvEventHandler.enable(null, (cmp: any, evt: any) => {
          if (!evt || !evt.eventType) return;
          console.log('[TV Legacy] Event:', evt.eventType);
          showControlsWithTimeoutRef.current?.();
          switch (evt.eventType) {
            case 'playPause':
              if (videoRef.current) {
                if (isPlayingRef.current) {
                  videoRef.current.pauseAsync();
                } else {
                  videoRef.current.playAsync();
                }
              }
              break;
            case 'rewind':
              if (videoRef.current) {
                const newPos = Math.max(0, positionRef.current - 10000);
                videoRef.current.setPositionAsync(newPos);
              }
              break;
            case 'fastForward':
              if (videoRef.current) {
                const newPos = Math.min(durationRef.current, positionRef.current + 10000);
                videoRef.current.setPositionAsync(newPos);
              }
              break;
          }
        });
      }
    } catch (e) {
      console.log('[TV] Legacy TVEventHandler not available:', e);
    }
    
    return () => {
      subscription.remove();
      if (tvEventHandler) {
        try { tvEventHandler.disable(); } catch (e) {}
      }
    };
  }, []); // EMPTY deps - uses refs for all mutable state
  
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
      // Auto-hide controls after 8 seconds on TV (longer for D-pad navigation), 3 seconds on mobile
      const hideTimeout = isTV ? 8000 : 3000;
      controlsTimeoutRef.current = setTimeout(() => {
        fadeControls(false);
      }, hideTimeout);
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
    
    // Set new auto-hide timeout (longer on TV)
    const hideTimeout = isTV ? 8000 : 3000;
    controlsTimeoutRef.current = setTimeout(() => {
      fadeControls(false);
    }, hideTimeout);
  };
  
  // Keep the ref in sync so TV event handler (empty deps) can call it
  showControlsWithTimeoutRef.current = showControlsWithTimeout;
  
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
      setLoadingStatus('');
      
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
        if (!playbackStarted) {
          if (fallbackUrls.length > currentStreamIndex + 1) {
            console.log('[PLAYER] Playback timeout - trying next stream');
            tryNextStream();
          } else {
            // No more fallback streams - show error to user
            console.log('[PLAYER] Playback timeout - no more fallback streams');
            setError('Stream timed out. The source may have too few peers. Try a different stream with more seeds.');
            setIsLoading(false);
          }
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
      if (isLive === 'true') {
        // For live TV, keep loading state until video actually starts playing
        setIsLoading(true);
      } else {
        setIsLoading(false);
      }
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

  const startTorrentStream = async (retryCount = 0) => {
    if (!infoHash) return;

    const MAX_RETRIES = 3;

    try {
      const parsedFileIdx = fileIdx && fileIdx !== '' ? parseInt(fileIdx, 10) : undefined;
      const validFileIdx = parsedFileIdx !== undefined && !isNaN(parsedFileIdx) ? parsedFileIdx : undefined;
      
      // === STREAMING ENGINE: Local (Stremio-like) or Cloud with polling ===
      
      // Parse sources from navigation params (tracker URLs from Torrentio)
      let streamSources: string[] = [];
      try {
        if (sources) {
          streamSources = JSON.parse(sources);
          console.log(`[PLAYER] Got ${streamSources.length} tracker sources from Torrentio`);
        }
      } catch (e) {
        console.log('[PLAYER] Could not parse sources:', e);
      }
      
      console.log(`[PLAYER] Starting torrent with fileIdx=${validFileIdx}, filename=${filename || 'auto'} (attempt ${retryCount + 1})`);
      
      // Show immediate feedback - set initial progress so user sees the bar start filling
      setDownloadProgress(5);
      
      // Start the torrent on cloud backend
      await api.stream.start(infoHash, validFileIdx, filename || undefined, streamSources);
      
      // Also start on local engine if available (Stremio-like local streaming)
      let useLocalEngine = false;
      if (LocalNodejs && localEngineRunning) {
        try {
          // Create engine on local Node.js server running on device
          const localCreateUrl = `${LOCAL_BASE_URL}/create/${infoHash}`;
          const localBody = { sources: streamSources || [] };
          const localResp = await fetch(localCreateUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(localBody),
          });
          if (localResp.ok) {
            useLocalEngine = true;
            console.log('[PLAYER] Local torrent engine created!');
          }
        } catch (e) {
          console.log('[PLAYER] Local engine not available, using cloud');
        }
      }
      
      // Get the video URL - LOCAL (localhost) if available, CLOUD (api proxy) if not
      const videoUrl = useLocalEngine 
        ? `${LOCAL_BASE_URL}/stream/${infoHash}` 
        : api.stream.getVideoUrl(infoHash, validFileIdx);
      
      console.log(`[PLAYER] Video URL: ${useLocalEngine ? 'LOCAL' : 'CLOUD'} - ${videoUrl}`);
      let pollCount = 0;
      let smoothProgress = 5; // Start at 5% for immediate visual feedback
      let videoUrlSet = false;
      let hadPeersOnce = false;
      let startTime = Date.now();
      
      const pollStatus = async () => {
        if (!continuePollingRef.current) return;
        pollCount++;
        
        try {
          const status = await api.stream.status(infoHash);
          const peerCount = status.peers || 0;
          const dlRate = status.download_rate || 0;
          setPeers(peerCount);
          setDownloadSpeed(dlRate);
          if (peerCount > 0) hadPeersOnce = true;
          
          const elapsedSec = (Date.now() - startTime) / 1000;
          
          // Track video file size for accurate seek calculations
          if (status.video_size && status.video_size > 0) {
            videoFileSizeRef.current = status.video_size;
          }
          
          // Smooth progress for loading bar - cap at 90%
          if (status.status === 'downloading_metadata') {
            smoothProgress = Math.min(smoothProgress + 3, 30);
            setLoadingStatus(`Finding torrent... (${peerCount} peers)`);
          } else if (status.status === 'buffering') {
            const readyPct = status.ready_progress ?? 0;
            const targetProgress = 30 + (readyPct / 100) * 50; // 30-80%
            smoothProgress = Math.max(smoothProgress, Math.min(smoothProgress + (targetProgress - smoothProgress) * 0.3, targetProgress));
            if (peerCount > 0) {
              setLoadingStatus(`Buffering... ${peerCount} peers, ${formatSpeed(dlRate)}`);
            } else {
              setLoadingStatus(`Connecting to peers...`);
            }
          } else if (status.status === 'ready') {
            smoothProgress = Math.min(Math.max(smoothProgress + 3, 85), 90);
            setLoadingStatus(`Starting playback...`);
          }
          setDownloadProgress(smoothProgress);
          
          // PLAY when backend reports READY (data actually available for streaming)
          // Don't start on "buffering" - data needs to be downloaded first
          if (status.status === 'ready' && !videoUrlSet) {
            videoUrlSet = true;
            // Save video file size for accurate seek calculations
            if (status.video_size) {
              videoFileSizeRef.current = status.video_size;
            }
            console.log(`[PLAYER] Stream READY in ${elapsedSec.toFixed(1)}s! Peers: ${peerCount}, FileSize: ${(videoFileSizeRef.current / 1024 / 1024).toFixed(1)}MB. Setting video URL.`);
            videoRetryCountRef.current = 0;
            setStreamUrl(videoUrl);
            // Keep polling for progress updates but don't set URL again
            return;
          }
          
          if (status.status === 'not_found' || status.status === 'invalid') {
            if (retryCount < MAX_RETRIES) {
              console.log(`[PLAYER] Stream not found, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
              if (pollIntervalRef.current) clearTimeout(pollIntervalRef.current as any);
              setTimeout(() => startTorrentStream(retryCount + 1), 2000);
              return;
            }
            setError('Stream unavailable. Try selecting a different stream.');
            setIsLoading(false);
            if (pollIntervalRef.current) clearTimeout(pollIntervalRef.current as any);
            return;
          }
          
          // Auto-switch stream after 35 seconds with no peers (give DHT time to discover)
          if (elapsedSec > 35 && !hadPeersOnce && !videoUrlSet) {
            console.log('[PLAYER] No peers after 35s, auto-trying next stream');
            if (pollIntervalRef.current) clearTimeout(pollIntervalRef.current as any);
            // Try next fallback stream
            if (fallbackUrls && fallbackUrls.length > currentStreamIndex + 1) {
              const nextIdx = currentStreamIndex + 1;
              setCurrentStreamIndex(nextIdx);
              const nextUrl = fallbackUrls[nextIdx];
              console.log(`[PLAYER] Auto-switching to stream ${nextIdx + 1}/${fallbackUrls.length}`);
              videoRetryCountRef.current = 0;
              setStreamUrl(nextUrl);
              return;
            }
            // No more fallbacks - show error
            setError('No peers found for any stream. The content may be unavailable.');
            setIsLoading(false);
            return;
          }
          
          // Give up after 2 minutes total
          if (elapsedSec > 120) {
            setError('Stream is too slow. Try a different stream with more seeders.');
            setIsLoading(false);
            if (pollIntervalRef.current) clearTimeout(pollIntervalRef.current as any);
            return;
          }
          
          // Poll every 500ms for fast response
          pollIntervalRef.current = setTimeout(pollStatus, 500) as any;
        } catch (err) {
          console.error('Status poll error:', err);
          pollIntervalRef.current = setTimeout(pollStatus, 1500) as any;
        }
      };
      
      pollStatus();
      
    } catch (err: any) {
      console.error('Stream start error:', err);
      if (retryCount < MAX_RETRIES) {
        console.log(`[PLAYER] Stream start failed, retrying in 3s (${retryCount + 1}/${MAX_RETRIES})...`);
        setTimeout(() => startTorrentStream(retryCount + 1), 3000);
        return;
      }
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
            {/* Logo/Title as Loading Bar - Stremio Style with Breathing Zoom + Fill */}
            <Animated.View style={{ transform: [{ scale: breatheAnim }], alignItems: 'center', width: '100%' }}>
            {logo ? (
              // Use the actual movie logo image with fill effect
              Platform.OS === 'web' ? (
                <div style={{
                  position: 'relative',
                  width: '70%',
                  maxWidth: 500,
                  height: 100,
                }}>
                  {/* Background logo - faded */}
                  <img 
                    src={logo}
                    alt={title || 'Loading'}
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      opacity: 0.2,
                    }}
                  />
                  {/* Filled portion - clips from left based on progress */}
                  <div style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: `${Math.min(Math.max(downloadProgress || 0, 0), 100)}%`,
                    height: '100%',
                    overflow: 'hidden',
                    transition: 'width 0.3s ease',
                  }}>
                    {/* This image must match the PARENT container size, not the clip container */}
                    <img 
                      src={logo}
                      alt={title || 'Loading'}
                      style={{
                        display: 'block',
                        height: '100%',
                        width: 'auto',
                        minWidth: 'calc(70vw)',
                        maxWidth: '500px',
                        objectFit: 'contain',
                        objectPosition: 'left center',
                      }}
                    />
                  </div>
                </div>
              ) : (
                // Native: Logo with overlay fill effect
                <View style={styles.logoWrapper}>
                  <Image
                    source={{ uri: logo }}
                    style={[styles.logoUnfilled, !infoHash && { opacity: 1 }]}
                    resizeMode="contain"
                  />
                  {infoHash && (
                  <View style={[styles.logoFillClip, { width: `${Math.min(Math.max(downloadProgress || 0, 0), 100)}%` }]}>
                    <View style={{ width: Dimensions.get('window').width * 0.8, maxWidth: 500, height: '100%' }}>
                      <Image
                        source={{ uri: logo }}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="contain"
                      />
                    </View>
                  </View>
                  )}
                </View>
              )
            ) : (
              // Fallback to text title if no logo
              Platform.OS === 'web' ? (
                <div style={{
                  position: 'relative',
                  width: '100%',
                  textAlign: 'center',
                }}>
                  <h1 style={{
                    fontSize: 42,
                    fontWeight: 800,
                    margin: 0,
                    padding: 0,
                    letterSpacing: 2,
                    background: `linear-gradient(90deg, #FFFFFF ${downloadProgress || 0}%, rgba(255,255,255,0.2) ${downloadProgress || 0}%)`,
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
                  <Text style={[styles.titleUnfilled, !infoHash && { opacity: 1 }]} numberOfLines={1} adjustsFontSizeToFit>
                    {title || 'Loading...'}
                  </Text>
                  {infoHash && (
                  <View style={styles.titleFillContainer}>
                    <View 
                      style={[
                        styles.titleFillClip, 
                        { width: `${Math.min(Math.max(downloadProgress || 0, 0), 100)}%` }
                      ]}
                    >
                      {/* Inner container matches full parent width so text position aligns with unfilled */}
                      <View style={{ width: Dimensions.get('window').width - 48, alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                        <Text style={styles.titleFilled} numberOfLines={1}>
                          {title || 'Loading...'}
                        </Text>
                      </View>
                    </View>
                  </View>
                  )}
                </View>
              )
            )}
            </Animated.View>
            
            {/* Loading status for torrent streams - shows peer/speed info */}
            {infoHash && loadingStatus ? (
              <View style={{ marginTop: 24, alignItems: 'center' }}>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '500' }}>{loadingStatus}</Text>
              </View>
            ) : null}
            
            {/* Minimal loading indicator - no text, just a subtle spinner below the title */}
            {!infoHash && (
              <View style={{ marginTop: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#B8A05C" />
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
          
          <TouchableOpacity style={[styles.button, { backgroundColor: '#B8A05C', marginTop: 12 }]} onPress={handleBack}>
            <Ionicons name="arrow-back" size={20} color="#000" style={{ marginRight: 8 }} />
            <Text style={[styles.buttonText, { color: '#000' }]}>Go Back</Text>
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
                
                // Save watch progress periodically
                if (!video.paused && totalDuration > 0) {
                  saveWatchProgress(currentTime, totalDuration);
                }
                
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
          <View style={styles.videoContainer}>
            <Pressable 
              style={StyleSheet.absoluteFill}
              onPress={handleVideoTap}
            >
              <Video
                ref={videoRef}
                source={{ 
                  uri: streamUrl,
                  // CRITICAL: Forces ExoPlayer to use HLS media source for redirect URLs
                  // Without this, URLs without .m3u8 extension (like redirects) fail
                  overrideFileExtensionAndroid: (isLiveTV || streamUrl.includes('.m3u8') || isLive === 'true') ? 'm3u8' : undefined,
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  },
                }}
                style={styles.videoPlayer}
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
                isLooping={false}
                volume={1.0}
                isMuted={false}
                onPlaybackStatusUpdate={handlePlaybackStatus}
                onError={(error) => {
                  console.log(`[PLAYER] Video error (attempt ${videoRetryCountRef.current + 1}/${maxVideoRetries}):`, error);
                  
                  // If we're seeking and get an error, DON'T reset the URL
                  // Just retry the seek - the data might not be available yet
                  if (isSeekingRef.current && lastSeekPositionRef.current > 0) {
                    console.log(`[PLAYER] Error during seek - retrying seek to ${lastSeekPositionRef.current}ms instead of resetting`);
                    setIsRebuffering(true);
                    // Wait a bit for data to arrive, then retry the seek
                    setTimeout(async () => {
                      try {
                        if (videoRef.current) {
                          await videoRef.current.setPositionAsync(lastSeekPositionRef.current);
                          console.log(`[PLAYER] Seek retry successful to ${lastSeekPositionRef.current}ms`);
                        }
                      } catch (e) {
                        console.log(`[PLAYER] Seek retry failed:`, e);
                        // After 3 retries during seek, give up and let it play from wherever it is
                        videoRetryCountRef.current += 1;
                        if (videoRetryCountRef.current > 3) {
                          isSeekingRef.current = false;
                          videoRetryCountRef.current = 0;
                          setIsRebuffering(false);
                        }
                      }
                    }, 2000);
                    return;
                  }
                  
                  // Retry aggressively - torrent data arrives progressively, each retry may succeed
                  if (videoRetryCountRef.current < maxVideoRetries) {
                    videoRetryCountRef.current += 1;
                    // Fast retries: 1s, 1s, 2s, 2s, 3s, 3s, 4s, 4s, 5s, 5s, 5s, 5s, 5s, 5s, 5s
                    const delay = Math.min(5000, Math.ceil(videoRetryCountRef.current / 2) * 1000);
                    console.log(`[PLAYER] Retrying video load in ${delay}ms...`);
                    
                    // Reset the streamUrl to force re-render of Video component
                    const currentUrl = streamUrl;
                    setStreamUrl(null);
                    setTimeout(() => {
                      setStreamUrl(currentUrl);
                    }, delay);
                  } else if (fallbackUrls.length > currentStreamIndex + 1) {
                    videoRetryCountRef.current = 0; // Reset for next stream
                    tryNextStream();
                  } else {
                    setError('Failed to play video. Please try a different stream.');
                    setHasAudioError(true);
                  }
                }}
              />
              
              {/* Rebuffering spinner - shown when seeking to unbuffered position */}
              {isRebuffering && !isLoading && (
                <View style={{
                  position: 'absolute',
                  top: 0, left: 0, right: 0, bottom: 0,
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor: 'rgba(0,0,0,0.4)',
                }}>
                  <ActivityIndicator size="large" color="#FFFFFF" />
                </View>
              )}
            </Pressable>
            
            {/* Subtitle Overlay */}
            {currentSubtitleText && (
              <View style={styles.subtitleContainer} pointerEvents="none">
                <Text style={styles.subtitleText}>{currentSubtitleText}</Text>
              </View>
            )}
            
            {/* Custom Controls Overlay - fades in/out */}
            {showControls && (
              <Animated.View style={[styles.controlsOverlay, { opacity: controlsOpacity }]} pointerEvents="box-none">
                {/* Top Bar - Back, Title, CC */}
                <View style={styles.topControls} pointerEvents="box-none">
                  <TVFocusButton 
                    style={styles.controlButton}
                    focusedStyle={styles.controlButtonFocused}
                    onPress={handleBack}
                  >
                    <Ionicons name="arrow-back" size={28} color="#FFFFFF" />
                  </TVFocusButton>
                  
                  <Text style={styles.titleText} numberOfLines={1}>{title || 'Playing'}</Text>
                  
                  <View style={styles.topRightControls}>
                    <TVFocusButton 
                      style={[styles.controlButton, selectedSubtitle && styles.ccActive]}
                      focusedStyle={styles.controlButtonFocused}
                      onPress={() => setShowSubtitlePicker(true)}
                    >
                      <Ionicons name="chatbubble-ellipses-outline" size={24} color={selectedSubtitle ? '#B8A05C' : '#FFFFFF'} />
                    </TVFocusButton>
                  </View>
                </View>
                
                {/* Center Controls: Rewind, Play/Pause, Fast Forward */}
                <View style={styles.centerControls} pointerEvents="box-none">
                  <View style={styles.centerButtonsRow}>
                    <TVFocusButton 
                      style={styles.seekButton}
                      focusedStyle={styles.seekButtonFocused}
                      onPress={() => seekToMs(position - 10000)}
                    >
                      <Ionicons name="play-back" size={36} color="#FFFFFF" />
                    </TVFocusButton>
                    
                    <TVFocusButton 
                      style={styles.playPauseButton}
                      focusedStyle={styles.playPauseFocused}
                      onPress={togglePlayPause}
                      hasTVPreferredFocus={true}
                    >
                      <Ionicons name={isPlaying ? "pause" : "play"} size={50} color="#FFFFFF" />
                    </TVFocusButton>
                    
                    <TVFocusButton 
                      style={styles.seekButton}
                      focusedStyle={styles.seekButtonFocused}
                      onPress={() => seekToMs(position + 10000)}
                    >
                      <Ionicons name="play-forward" size={36} color="#FFFFFF" />
                    </TVFocusButton>
                  </View>
                </View>
                
                {/* Bottom Bar - Progress */}
                <View style={styles.bottomControls} pointerEvents="box-none">
                  <Text style={styles.timeText}>{formatTime(position)}</Text>
                  <SeekableProgressBar
                    position={position}
                    duration={duration}
                    onSeek={seekToMs}
                    onFocusChange={(focused: boolean) => { progressBarFocusedRef.current = focused; }}
                  />
                  <Text style={styles.timeText}>{formatRemainingTime(position, duration)}</Text>
                </View>
              </Animated.View>
            )}
          </View>
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
                  <TVFocusButton
                    style={[
                      styles.subtitleItem,
                      (item.url === selectedSubtitle || (item.lang === 'off' && !selectedSubtitle)) && styles.subtitleItemActive
                    ]}
                    focusedStyle={styles.subtitleItemFocused}
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
                  </TVFocusButton>
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
    maxWidth: 500,
    height: 100,
    marginBottom: 32,
  },
  logoUnfilled: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    opacity: 0.2,
  },
  logoFillClip: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: '100%',
    overflow: 'hidden',
  },
  logoFilled: {
    width: Dimensions.get('window').width * 0.8,
    maxWidth: 500,
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
    color: 'rgba(255, 255, 255, 0.12)',
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
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    textShadowColor: '#000',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
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
    borderWidth: 2,
    borderColor: 'transparent',
  },
  controlButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.4)',
    transform: [{ scale: 1.1 }],
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
    borderWidth: 3,
    borderColor: 'transparent',
  },
  playPauseFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.4)',
    transform: [{ scale: 1.15 }],
  },
  centerButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 40,
  },
  seekButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  seekButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.4)',
    transform: [{ scale: 1.15 }],
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
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 4,
    marginHorizontal: 12,
    overflow: 'visible',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  progressBarFocused: {
    borderColor: '#B8A05C',
    height: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#B8A05C',
    borderRadius: 4,
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  progressBarThumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#B8A05C',
    marginLeft: -8,
    top: -4,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  seekHint: {
    position: 'absolute',
    top: -30,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  seekHintText: {
    color: '#B8A05C',
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
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
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  subtitleItemActive: {
    backgroundColor: 'rgba(184, 160, 92, 0.2)',
    borderColor: 'rgba(184, 160, 92, 0.5)',
  },
  subtitleItemFocused: {
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
    borderColor: '#B8A05C',
    transform: [{ scale: 1.02 }],
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
