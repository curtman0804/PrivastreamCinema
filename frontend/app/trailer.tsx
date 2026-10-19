// W121ZOD138H_DEVICE_SIDE_NATIVE_TRAILER
// Trailer-only transport:
// - resolve YouTube on the Android/Fire TV device (not production server)
// - no WebView / iframe / external player
// - play resolved HLS or progressive MP4 through Privastream's existing native Media3 surface
// - keep title top-center
// - return to the same Details route on Back or trailer end
// Normal OD player/streams/subtitles/progress/Live TV stay untouched.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ExpoVideoCompat } from '../src/components/ExpoVideoCompat';

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const DEFAULT_UA =
  'Mozilla/5.0 (Linux; Android 12; Android TV) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

type YoutubeClient = {
  key: string;
  id: string;
  version: string;
  userAgent: string;
  context: Record<string, any>;
};

type ResolvedTrailer = {
  uri: string;
  extension: 'm3u8' | 'mp4';
  client: string;
  headers: Record<string, string>;
};

const CLIENTS: YoutubeClient[] = [
  {
    key: 'visionos',
    id: '101',
    version: '1.02',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    context: {
      clientName: 'VISIONOS',
      clientVersion: '1.02',
      deviceMake: 'Apple',
      deviceModel: 'RealityDevice17,1',
      osName: 'visionOS',
      osVersion: '26.5.23O471',
      hl: 'en',
      gl: 'US',
    },
  },
  {
    key: 'android',
    id: '3',
    version: '20.10.35',
    userAgent: 'com.google.android.youtube/20.10.35 (Linux; U; Android 14; en_US) gzip',
    context: {
      clientName: 'ANDROID',
      clientVersion: '20.10.35',
      osName: 'Android',
      osVersion: '14',
      platform: 'MOBILE',
      androidSdkVersion: 34,
      hl: 'en',
      gl: 'US',
    },
  },
  {
    key: 'ios',
    id: '5',
    version: '20.10.1',
    userAgent: 'com.google.ios.youtube/20.10.1 (iPhone16,2; U; CPU iOS 17_4 like Mac OS X)',
    context: {
      clientName: 'IOS',
      clientVersion: '20.10.1',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '17.4.0.21E219',
      platform: 'MOBILE',
      hl: 'en',
      gl: 'US',
    },
  },
];

function paramValue(value?: string | string[]): string {
  return String(Array.isArray(value) ? value[0] || '' : value || '').trim();
}

function parseWatchConfig(html: string): { apiKey: string; visitorData: string } | null {
  const apiKey =
    html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/)?.[1] ||
    html.match(/INNERTUBE_API_KEY\\?"\s*:\s*\\?"([^"\\]+)\\?"/)?.[1] ||
    '';

  const visitorData =
    html.match(/"VISITOR_DATA"\s*:\s*"([^"]+)"/)?.[1] ||
    html.match(/VISITOR_DATA\\?"\s*:\s*\\?"([^"\\]+)\\?"/)?.[1] ||
    '';

  if (!apiKey) return null;
  return { apiKey, visitorData };
}

async function fetchTextWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function chooseProgressiveFormat(formats: any[]): any | null {
  const compatible = (Array.isArray(formats) ? formats : [])
    .filter((format: any) => {
      const url = String(format?.url || '');
      const mimeType = String(format?.mimeType || '').toLowerCase();
      const height = Number(format?.height || 0);
      const hasAudio =
        !!format?.audioQuality ||
        Number(format?.audioSampleRate || 0) > 0 ||
        Number(format?.audioChannels || 0) > 0;

      if (!url || !hasAudio) return false;
      if (!mimeType.includes('video/mp4')) return false;
      if (mimeType.includes('av01') || mimeType.includes('vp9')) return false;
      if (height > 720) return false;
      return true;
    })
    .sort((a: any, b: any) => {
      const heightDelta = Number(b?.height || 0) - Number(a?.height || 0);
      if (heightDelta !== 0) return heightDelta;
      return Number(b?.bitrate || 0) - Number(a?.bitrate || 0);
    });

  return compatible[0] || null;
}

async function resolveTrailerOnDevice(
  ytId: string
): Promise<ResolvedTrailer> {
  const watchResponse = await fetchTextWithTimeout(
    'https://www.youtube.com/watch?v=' + encodeURIComponent(ytId) + '&hl=en',
    {
      method: 'GET',
      headers: {
        'User-Agent': DEFAULT_UA,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    },
    15000
  );

  if (!watchResponse.ok) {
    throw new Error('WATCH_HTTP_' + String(watchResponse.status));
  }

  const watchHtml = await watchResponse.text();
  const config = parseWatchConfig(watchHtml);

  if (!config) {
    throw new Error('WATCH_CONFIG_MISSING');
  }

  let lastReason = 'NO_PLAYABLE_CLIENT';

  for (const client of CLIENTS) {
    try {
      const playerResponse = await fetchTextWithTimeout(
        'https://www.youtube.com/youtubei/v1/player?key=' +
          encodeURIComponent(config.apiKey),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://www.youtube.com',
            'User-Agent': client.userAgent,
            'X-YouTube-Client-Name': client.id,
            'X-YouTube-Client-Version': client.version,
            ...(config.visitorData
              ? { 'X-Goog-Visitor-Id': config.visitorData }
              : {}),
          },
          body: JSON.stringify({
            videoId: ytId,
            contentCheckOk: true,
            racyCheckOk: true,
            context: {
              client: client.context,
            },
            playbackContext: {
              contentPlaybackContext: {
                html5Preference: 'HTML5_PREF_WANTS',
              },
            },
          }),
        },
        15000
      );

      if (!playerResponse.ok) {
        lastReason = client.key + '_HTTP_' + String(playerResponse.status);
        console.warn(
          '[W121ZOD138H CLIENT HTTP]',
          'client=' + client.key,
          'status=' + String(playerResponse.status)
        );
        continue;
      }

      const data: any = await playerResponse.json();
      const playability = data?.playabilityStatus || {};
      const status = String(playability?.status || '');

      if (status && status !== 'OK') {
        const reason = String(
          playability?.reason ||
          playability?.errorScreen?.playerErrorMessageRenderer?.reason?.simpleText ||
          status
        );

        lastReason = client.key + '_' + status + '_' + reason.slice(0, 80);
        console.warn(
          '[W121ZOD138H CLIENT REJECTED]',
          'client=' + client.key,
          'status=' + status,
          'reason=' + reason
        );
        continue;
      }

      const streamingData = data?.streamingData || {};
      const hlsManifestUrl = String(streamingData?.hlsManifestUrl || '').trim();

      if (/^https:\/\//i.test(hlsManifestUrl)) {
        console.log(
          '[W121ZOD138H DEVICE RESOLVE PASS]',
          'client=' + client.key,
          'transport=HLS'
        );

        return {
          uri: hlsManifestUrl,
          extension: 'm3u8',
          client: client.key,
          headers: {
            'User-Agent': client.userAgent,
            Referer: 'https://www.youtube.com/',
          },
        };
      }

      const progressive = chooseProgressiveFormat(streamingData?.formats || []);
      const progressiveUrl = String(progressive?.url || '').trim();

      if (/^https:\/\//i.test(progressiveUrl)) {
        console.log(
          '[W121ZOD138H DEVICE RESOLVE PASS]',
          'client=' + client.key,
          'transport=MP4',
          'height=' + String(progressive?.height || 0),
          'itag=' + String(progressive?.itag || '')
        );

        return {
          uri: progressiveUrl,
          extension: 'mp4',
          client: client.key,
          headers: {
            'User-Agent': client.userAgent,
            Referer: 'https://www.youtube.com/',
          },
        };
      }

      lastReason = client.key + '_NO_SINGLE_URL';
    } catch (error: any) {
      lastReason =
        client.key + '_' + String(error?.message || error || 'UNKNOWN').slice(0, 100);

      console.warn(
        '[W121ZOD138H CLIENT ERROR]',
        'client=' + client.key,
        'error=' + String(error?.message || error || 'unknown')
      );
    }
  }

  throw new Error(lastReason);
}

export default function TrailerScreen() {
  const router = useRouter();
  const returnedRef = useRef(false);

  const params = useLocalSearchParams<{
    ytId?: string | string[];
    title?: string | string[];
    returnType?: string | string[];
    returnId?: string | string[];
    returnName?: string | string[];
    returnPoster?: string | string[];
    returnBackground?: string | string[];
    returnLogo?: string | string[];
    returnSelectedSeason?: string | string[];
    returnSelectedEpisode?: string | string[];
    returnResumeEpisodeId?: string | string[];
    returnResumePosition?: string | string[];
    returnResumeSeason?: string | string[];
    returnResumeEpisode?: string | string[];
  }>();

  const ytId = paramValue(params.ytId);
  const title = paramValue(params.title) || 'Trailer';
  const returnType = paramValue(params.returnType);
  const returnId = paramValue(params.returnId);
  const returnName = paramValue(params.returnName);
  const returnPoster = paramValue(params.returnPoster);
  const returnBackground = paramValue(params.returnBackground);
  const returnLogo = paramValue(params.returnLogo);
  const returnSelectedSeason = paramValue(params.returnSelectedSeason);
  const returnSelectedEpisode = paramValue(params.returnSelectedEpisode);
  const returnResumeEpisodeId = paramValue(params.returnResumeEpisodeId);
  const returnResumePosition = paramValue(params.returnResumePosition);
  const returnResumeSeason = paramValue(params.returnResumeSeason);
  const returnResumeEpisode = paramValue(params.returnResumeEpisode);

  const validTrailer = YT_ID_RE.test(ytId);
  const validReturn = !!returnType && !!returnId;

  const [resolved, setResolved] = useState<ResolvedTrailer | null>(null);
  const [resolving, setResolving] = useState(validTrailer);
  const [playingReady, setPlayingReady] = useState(false);
  const [failure, setFailure] = useState('');

  const returnToDetails = useCallback(() => {
    if (returnedRef.current) return;
    returnedRef.current = true;

    const navigate = () => {
      if (!validReturn) {
        router.back();
        return;
      }

      router.replace({
        pathname: '/details/[type]/[id]' as any,
        params: {
          type: returnType,
          id: returnId,
          name: returnName,
          poster: returnPoster,
          background: returnBackground,
          logo: returnLogo,
          selectedSeason: returnSelectedSeason,
          selectedEpisode: returnSelectedEpisode,
          resumeEpisodeId: returnResumeEpisodeId,
          resumePosition: returnResumePosition,
          resumeSeason: returnResumeSeason,
          resumeEpisode: returnResumeEpisode,
        },
      } as any);
    };

    setTimeout(navigate, 60);
  }, [
    router,
    validReturn,
    returnType,
    returnId,
    returnName,
    returnPoster,
    returnBackground,
    returnLogo,
    returnSelectedSeason,
    returnSelectedEpisode,
    returnResumeEpisodeId,
    returnResumePosition,
    returnResumeSeason,
    returnResumeEpisode,
  ]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      returnToDetails();
      return true;
    });

    return () => sub.remove();
  }, [returnToDetails]);

  useEffect(() => {
    let active = true;

    if (!validTrailer) {
      setResolving(false);
      setFailure('Trailer unavailable.');
      return () => {
        active = false;
      };
    }

    setResolving(true);
    setPlayingReady(false);
    setFailure('');
    setResolved(null);

    console.log(
      '[W121ZOD138H DEVICE RESOLVE START]',
      'ytId=' + ytId
    );

    const timer = setTimeout(() => {
      resolveTrailerOnDevice(ytId)
        .then((result) => {
          if (!active) return;

          console.log(
            '[W121ZOD138H DEVICE RESOLVE READY]',
            'client=' + result.client,
            'transport=' + result.extension
          );

          setResolved(result);
          setResolving(false);
        })
        .catch((error: any) => {
          if (!active) return;

          const message = String(error?.message || error || 'Unable to resolve trailer');
          console.warn(
            '[W121ZOD138H DEVICE RESOLVE FAIL]',
            'ytId=' + ytId,
            'error=' + message
          );

          setFailure(message);
          setResolving(false);
        });
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [validTrailer, ytId]);

  const nativeSource = useMemo(() => {
    if (!resolved) return null;

    return {
      uri: resolved.uri,
      overrideFileExtensionAndroid: resolved.extension,
      headers: resolved.headers,
    };
  }, [resolved]);

  return (
    <View style={styles.root}>
      <StatusBar hidden />

      {!!nativeSource && (
        <ExpoVideoCompat
          source={nativeSource}
          style={styles.video}
          resizeMode="contain"
          shouldPlay
          isLooping={false}
          volume={1}
          isMuted={false}
          surfaceType="surfaceView"
          onPlaybackStatusUpdate={(status: any) => {
            if (status?.isLoaded && !status?.isBuffering) {
              setPlayingReady(true);
            }

            if (status?.didJustFinish) {
              console.log(
                '[W121ZOD138H TRAILER ENDED]',
                'ytId=' + ytId
              );
              returnToDetails();
            }
          }}
          onError={(error: any) => {
            const message = String(
              error?.message ||
              error ||
              'Native trailer playback failed'
            );

            console.warn(
              '[W121ZOD138H NATIVE PLAYER ERROR]',
              'ytId=' + ytId,
              'error=' + message
            );

            setFailure(message);
            setPlayingReady(false);
          }}
        />
      )}

      {validTrailer && (resolving || (!!nativeSource && !playingReady && !failure)) && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#B8A05C" />
          <Text style={styles.loadingText}>
            {resolving ? 'Resolving trailer...' : 'Loading trailer...'}
          </Text>
        </View>
      )}

      {!!failure && (
        <View style={styles.messageWrap} pointerEvents="none">
          <Text style={styles.messageTitle}>Unable to play trailer</Text>
          <Text style={styles.messageText}>
            The device could not obtain a native trailer stream.
          </Text>
          <Text style={styles.errorCode} numberOfLines={2}>
            {failure}
          </Text>
          <Text style={styles.messageText}>Press Back to return to {title}.</Text>
        </View>
      )}

      <Pressable
        hasTVPreferredFocus={Platform.isTV}
        onPress={returnToDetails}
        style={({ focused }: any) => [
          styles.backButton,
          focused && styles.backButtonFocused,
        ]}
      >
        <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <View style={styles.titleBadge} pointerEvents="none">
        <Text style={styles.titleText} numberOfLines={1}>
          {title}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  video: {
    flex: 1,
    backgroundColor: '#000000',
  },
  backButton: {
    position: 'absolute',
    top: 18,
    left: 24,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  backButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184,160,92,0.30)',
    transform: [{ scale: 1.05 }],
  },
  backText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  titleBadge: {
    position: 'absolute',
    top: 18,
    left: '18%',
    right: '18%',
    zIndex: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.95)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  loadingText: {
    marginTop: 14,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  messageWrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 80,
    backgroundColor: '#000000',
  },
  messageTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 12,
    textAlign: 'center',
  },
  messageText: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
    marginTop: 6,
  },
  errorCode: {
    color: '#B8A05C',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 10,
  },
});
