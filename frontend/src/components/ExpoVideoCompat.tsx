import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  StyleProp,
  ViewStyle,
} from 'react-native';
import { useEventListener } from 'expo';
import {
  VideoView,
  useVideoPlayer,
  type AudioTrack,
  type VideoSource,
} from 'expo-video';
import { getDevicePlaybackCapabilities } from '../native/devicePlaybackCapabilities';
import AsyncStorage, { setItemDurable } from '../utils/mmkvStorage';

// V616A_EXPO_VIDEO_COMPAT
//
// Keep player.tsx on its existing expo-av-style contract while the
// underlying Android playback engine moves to expo-video.
//
// This deliberately exposes only the three imperative methods that
// player.tsx currently uses:
//   pauseAsync()
//   playAsync()
//   setPositionAsync(ms)
//
// Audio-track access is exposed here for V616B without requiring a
// second playback-engine migration.

export type ExpoVideoCompatHandle = {
  pauseAsync: () => Promise<void>;
  playAsync: () => Promise<void>;
  setPositionAsync: (positionMillis: number) => Promise<void>;

  getAvailableAudioTracks: () => AudioTrack[];
  getSelectedAudioTrack: () => AudioTrack | null;
  selectAudioTrack: (track: AudioTrack | null) => void;
};

type CompatSource = {
  uri?: string | null;
  overrideFileExtensionAndroid?: string | null;

  // V727B2B1_SOURCE_HEADERS
  // Optional per-source request headers supported natively by expo-video.
  headers?: Record<string, string> | null;
};

type ExpoVideoCompatProps = {
  source?: CompatSource | null;
  style?: StyleProp<ViewStyle>;
  resizeMode?: any;
  shouldPlay?: boolean;
  isLooping?: boolean;
  volume?: number;
  isMuted?: boolean;
  onPlaybackStatusUpdate?: (status: any) => void;
  onError?: (error: any) => void;
};

function contentFitFromResizeMode(
  resizeMode: any
): 'contain' | 'cover' | 'fill' {
  const mode = String(resizeMode || '').toLowerCase();

  if (mode === 'cover') return 'cover';
  if (mode === 'stretch' || mode === 'fill') return 'fill';

  return 'contain';
}

export const ExpoVideoCompat = forwardRef<
  ExpoVideoCompatHandle,
  ExpoVideoCompatProps
>(function ExpoVideoCompat(
  {
    source,
    style,
    resizeMode,
    shouldPlay = false,
    isLooping = false,
    volume = 1,
    isMuted = false,
    onPlaybackStatusUpdate,
    onError,
  },
  ref
) {
  const statusCallbackRef = useRef(onPlaybackStatusUpdate);
  const errorCallbackRef = useRef(onError);

  // V616C_DEFAULT_ENGLISH_AUDIO
  // Reset for every new source. Once the user explicitly selects an
  // audio track, never override their choice for the current source.
  const v616cUserSelectedAudioRef = useRef(false);

  // V766_ADAPTIVE_EAC3_CIRCUIT_BREAKER
  //
  // Do not globally blacklist E-AC3. A device must first prove at
  // runtime that its E-AC3 decoder is broken. Persist that fact only
  // in this app installation on this device.
  const v766Eac3DecoderBrokenRef = useRef(false);
  const v766SuppressEac3ErrorUntilRef = useRef(0);
  // V766H_PERSISTENCE_HYDRATION
  const v766Eac3StateHydratedRef = useRef(false);

  useEffect(() => {
    let active = true;

    AsyncStorage.getItem('v766_eac3_decoder_broken')
      .then(value => {
        if (active && value === '1') {
          v766Eac3DecoderBrokenRef.current = true;
          console.log('[V766 EAC3 CIRCUIT] restored broken-device flag');
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) {
          v766Eac3StateHydratedRef.current = true;
        }
      });

    return () => {
      active = false;
    };
  }, []);

  // V658_STALE_PLAYTOEND_GUARD
  // Ignore playToEnd emitted by the outgoing native source while
  // replaceAsync() is installing the next movie/episode/stream.
  const v658SourceReplacingRef = useRef(false);

  // V690C_NEAR_EOF_FALLBACK
  //
  // Some progressive files can stop a few hundred milliseconds
  // before Media3 publishes STATE_ENDED. Preserve expo-av's
  // didJustFinish contract without treating a manual pause as EOF.
  const v690IntentionalPauseRef = useRef(false);
  const v690EndFallbackFiredRef = useRef(false);
  const v690EndFallbackTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  statusCallbackRef.current = onPlaybackStatusUpdate;
  errorCallbackRef.current = onError;

  const player = useVideoPlayer(null, p => {
    // Match expo-av's normal progress cadence closely enough that all
    // existing seek/resume/progress logic continues reading fresh state.
    p.timeUpdateEventInterval = 0.5;
    p.loop = false;
    p.volume = 1;
    p.muted = false;

    // V664_LOW_MEMORY_TV_BUFFER_CAP
    // Media3's automatic A/V target is ~137.5 MiB. On 192 MiB TV heaps
    // that can exhaust the process during high-bitrate 4K playback.
    // Cap only genuinely low-memory televisions; higher-memory TVs and
    // phones/tablets retain Media3's normal automatic buffering.
    const caps = getDevicePlaybackCapabilities();
    const memoryClassMb = Number(caps?.memoryClassMb ?? 0);
    const isLowMemoryTv =
      caps?.isTelevision === true &&
      Number.isFinite(memoryClassMb) &&
      memoryClassMb > 0 &&
      memoryClassMb <= 192;

    if (isLowMemoryTv) {
      p.bufferOptions = {
        maxBufferBytes: 64 * 1024 * 1024,
        prioritizeTimeOverSizeThreshold: false,
      };

      console.log(
        '[V664_LOW_MEMORY_TV_BUFFER_CAP]',
        'memoryClassMb=' + memoryClassMb,
        'maxBufferBytes=67108864'
      );
    }
  });

  const uri = String(source?.uri || '');
  const extensionHint =
    String(source?.overrideFileExtensionAndroid || '').toLowerCase();

  // V727B2B1_SOURCE_HEADERS
  // Serialize only for source-replacement dependency tracking.
  const sourceHeaders =
    source?.headers && typeof source.headers === 'object'
      ? source.headers
      : undefined;

  const sourceHeadersKey = JSON.stringify(sourceHeaders || {});

  const emitCompatStatus = useCallback(
    (didJustFinish: boolean = false) => {
      try {
        const playerStatus = player.status;

        const currentSeconds =
          Number.isFinite(player.currentTime)
            ? player.currentTime
            : 0;

        const durationSeconds =
          Number.isFinite(player.duration)
            ? player.duration
            : 0;

        statusCallbackRef.current?.({
          // Compatibility fields consumed by player.tsx.
          // V695_END_STATUS_COMPAT
          // expo-video maps a clean STATE_ENDED to status='idle'
          // before emitting playToEnd. A successful didJustFinish
          // callback must remain an expo-av-style loaded status.
          isLoaded:
            didJustFinish ||
            (playerStatus !== 'idle' &&
              playerStatus !== 'error'),

          isPlaying: !!player.playing,

          positionMillis:
            Math.max(
              0,
              Math.round(currentSeconds * 1000)
            ),

          durationMillis:
            Math.max(
              0,
              Math.round(durationSeconds * 1000)
            ),

          isBuffering:
            playerStatus === 'loading',

          didJustFinish,
        });
      } catch (_) {
      }
    },
    [player]
  );

  const v690ClearEndFallbackTimer = useCallback(() => {
    if (v690EndFallbackTimerRef.current) {
      clearTimeout(v690EndFallbackTimerRef.current);
      v690EndFallbackTimerRef.current = null;
    }
  }, []);

  const v690ScheduleNearEofFallback = useCallback(
    (reason: 'timeUpdate' | 'playingChange') => {
      if (
        extensionHint === 'm3u8' ||
        v658SourceReplacingRef.current ||
        v690IntentionalPauseRef.current ||
        v690EndFallbackFiredRef.current ||
        v690EndFallbackTimerRef.current
      ) {
        return;
      }

      const startCurrentSeconds =
        Number(player.currentTime);

      const startDurationSeconds =
        Number(player.duration);

      if (
        !Number.isFinite(startCurrentSeconds) ||
        !Number.isFinite(startDurationSeconds) ||
        startDurationSeconds <= 0
      ) {
        return;
      }

      const startRemainingMs =
        (startDurationSeconds - startCurrentSeconds) * 1000;

      if (
        startRemainingMs < -250 ||
        startRemainingMs > 750
      ) {
        return;
      }

      const startPositionMs =
        Math.round(startCurrentSeconds * 1000);

      v690EndFallbackTimerRef.current =
        setTimeout(() => {
          v690EndFallbackTimerRef.current = null;

          if (
            v658SourceReplacingRef.current ||
            v690IntentionalPauseRef.current ||
            v690EndFallbackFiredRef.current
          ) {
            return;
          }

          const finalCurrentSeconds =
            Number(player.currentTime);

          const finalDurationSeconds =
            Number(player.duration);

          if (
            !Number.isFinite(finalCurrentSeconds) ||
            !Number.isFinite(finalDurationSeconds) ||
            finalDurationSeconds <= 0
          ) {
            return;
          }

          const finalRemainingMs =
            (finalDurationSeconds - finalCurrentSeconds) * 1000;

          if (
            finalRemainingMs < -250 ||
            finalRemainingMs > 750
          ) {
            return;
          }

          const finalPositionMs =
            Math.round(finalCurrentSeconds * 1000);

          const progressedMs =
            finalPositionMs - startPositionMs;

          const stopped =
            !player.playing;

          const stalled =
            progressedMs <= 150;

          const status =
            String(player.status || '');

          /*
           * Do not convert an actual buffering condition near EOF
           * into completion. If playback resumes, a later timeUpdate
           * can arm a fresh watchdog.
           */
          if (
            status === 'loading' ||
            (!stopped && !stalled)
          ) {
            return;
          }

          v690EndFallbackFiredRef.current = true;

          console.log(
            '[V690C_NEAR_EOF_FALLBACK] didJustFinish=true',
            'reason=' + reason,
            'startPositionMs=' + startPositionMs,
            'positionMs=' + finalPositionMs,
            'durationMs=' +
              Math.round(finalDurationSeconds * 1000),
            'remainingMs=' +
              Math.round(finalRemainingMs),
            'progressedMs=' + progressedMs,
            'playing=' +
              String(player.playing),
            'status=' + status
          );

          emitCompatStatus(true);
        }, 1800);
    },
    [
      player,
      extensionHint,
      emitCompatStatus,
    ]
  );

  useEffect(() => {
    return () => {
      v690ClearEndFallbackTimer();
    };
  }, [v690ClearEndFallbackTimer]);

  useImperativeHandle(
    ref,
    () => ({
      pauseAsync: async () => {
        v690IntentionalPauseRef.current = true;
        v690ClearEndFallbackTimer();
        player.pause();
      },

      playAsync: async () => {
        v690IntentionalPauseRef.current = false;
        v690ClearEndFallbackTimer();
        player.play();
      },

      setPositionAsync: async (
        positionMillis: number
      ) => {
        const ms =
          Number.isFinite(positionMillis)
            ? Math.max(0, positionMillis)
            : 0;

        player.currentTime = ms / 1000;
      },

      getAvailableAudioTracks: () => {
        try {
          return [...(player.availableAudioTracks || [])];
        } catch (_) {
          return [];
        }
      },

      getSelectedAudioTrack: () => {
        try {
          return player.audioTrack || null;
        } catch (_) {
          return null;
        }
      },

      selectAudioTrack: (track: AudioTrack | null) => {
        // V616C: explicit user choice wins until the next source.
        v616cUserSelectedAudioRef.current = true;
        player.audioTrack = track;
      },
    }),
    [player]
  );

  // Replace media whenever player.tsx changes its streamUrl.
  useEffect(() => {
    let cancelled = false;

    const replaceSource = async () => {
      v658SourceReplacingRef.current = true;
      v690IntentionalPauseRef.current = false;
      v690EndFallbackFiredRef.current = false;
      v690ClearEndFallbackTimer();
      try {
        // New movie/episode/stream => English becomes the preferred
        // starting language again.
        v616cUserSelectedAudioRef.current = false;

        // V766H_PRE_SOURCE_PERSISTENCE_CHECK
        // The mount restore above is asynchronous. Do not allow
        // the first source to outrun a persisted broken-device flag.
        if (!v766Eac3StateHydratedRef.current) {
          try {
            const persistedEac3State =
              await AsyncStorage.getItem(
                'v766_eac3_decoder_broken'
              );

            if (persistedEac3State === '1') {
              v766Eac3DecoderBrokenRef.current = true;
              console.log(
                '[V766H EAC3 CIRCUIT] pre-source restored broken-device flag'
              );
            }
          } catch (_) {
          } finally {
            v766Eac3StateHydratedRef.current = true;
          }
        }

        if (!uri) {
          await player.replaceAsync(null);
          return;
        }

        const nextSource: VideoSource = {
          uri,

          // V727B2B1_SOURCE_HEADERS
          ...(sourceHeaders
            ? {
                headers: sourceHeaders,
              }
            : {}),

          // Existing expo-av code explicitly identifies HLS.
          // Everything else coming from the torrent/direct server is
          // progressive media even when the endpoint has no extension.
          contentType:
            extensionHint === 'm3u8'
              ? 'hls'
              : 'progressive',
        };

        // V766H_PRE_SOURCE_AUDIO_GATE
        if (v766Eac3DecoderBrokenRef.current) {
          try {
            player.audioTrack = null;

            console.log(
              '[V766H EAC3 CIRCUIT] pre-source audio disabled'
            );
          } catch (error) {
            console.log(
              '[V766H EAC3 CIRCUIT] pre-source audio gate failed',
              error
            );
          }
        }

        await player.replaceAsync(nextSource);

        if (cancelled) return;

        console.log(
          '[V616A] expo-video source ready',
          extensionHint === 'm3u8'
            ? 'hls'
            : 'progressive'
        );

        emitCompatStatus(false);
      } catch (error) {
        if (!cancelled) {
          console.log(
            '[V616A] source replacement error',
            error
          );

          errorCallbackRef.current?.(error);
        }
      } finally {
        // A cancelled effect means a newer replacement owns the ref.
        if (!cancelled) {
          v658SourceReplacingRef.current = false;
        }
      }
    };

    replaceSource();

    return () => {
      cancelled = true;
    };
  }, [
    player,
    uri,
    extensionHint,
    sourceHeadersKey,
    emitCompatStatus,
  ]);

  useEffect(() => {
    player.loop = !!isLooping;
  }, [player, isLooping]);

  useEffect(() => {
    player.volume =
      Math.max(
        0,
        Math.min(1, Number(volume) || 0)
      );
  }, [player, volume]);

  useEffect(() => {
    player.muted = !!isMuted;
  }, [player, isMuted]);

  useEffect(() => {
    if (!uri) return;

    try {
      if (shouldPlay) {
        player.play();
      } else {
        player.pause();
      }
    } catch (_) {
    }
  }, [player, uri, shouldPlay]);

  // Re-create expo-av's onPlaybackStatusUpdate feed.
  useEventListener(
    player,
    'timeUpdate',
    () => {
      emitCompatStatus(false);
      v690ScheduleNearEofFallback('timeUpdate');
    }
  );

  useEventListener(
    player,
    'playingChange',
    ({ isPlaying }) => {
      if (isPlaying) {
        v690ClearEndFallbackTimer();
      } else {
        v690ScheduleNearEofFallback('playingChange');
      }

      emitCompatStatus(false);
    }
  );

  useEventListener(
    player,
    'sourceLoad',
    ({ availableAudioTracks }) => {
      const tracks =
        Array.isArray(availableAudioTracks)
          ? availableAudioTracks
          : [];

      console.log(
        '[V616A] sourceLoad audioTracks=' +
          String(tracks.length)
      );

      // V766C_JS_AUDIO_TRACK_DIAG
      try {
        console.log(
          '[V766C TRACK KEYS]',
          tracks.map((track: any) =>
            Object.keys(track || {}).sort()
          )
        );

        console.log(
          '[V766C TRACK JSON]',
          JSON.stringify(tracks)
        );
      } catch (error) {
        console.log(
          '[V766C TRACK DIAG ERROR]',
          error
        );
      }

      // V766_EAC3_PREDECODE_GUARD
      if (
        v766Eac3DecoderBrokenRef.current &&
        tracks.length > 0
      ) {
        const isEac3Track = (track: any): boolean => {
          const mime =
            String(track?.mimeType || '')
              .trim()
              .toLowerCase();

          return (
            mime === 'audio/eac3' ||
            mime === 'audio/eac3-joc'
          );
        };

        const eac3Tracks = tracks.filter(isEac3Track);
        const safeTracks =
          tracks.filter((track: any) => !isEac3Track(track));

        if (eac3Tracks.length > 0) {
          if (safeTracks.length > 0) {
            const isEnglish = (track: any): boolean => {
              const language =
                String(track?.language || '')
                  .trim()
                  .toLowerCase();

              const label =
                String(track?.label || '')
                  .trim()
                  .toLowerCase();

              return (
                language === 'en' ||
                language === 'eng' ||
                language === 'english' ||
                language.startsWith('en-') ||
                language.startsWith('en_') ||
                /\benglish\b/.test(label) ||
                /\beng\b/.test(label)
              );
            };

            const safeTrack =
              safeTracks.find(isEnglish) ||
              safeTracks[0];

            player.audioTrack = safeTrack;

            // Prevent V616C from immediately selecting an English
            // E-AC3 track again for this source.
            v616cUserSelectedAudioRef.current = true;

            console.log(
              '[V766 EAC3 CIRCUIT] selected safe audio',
              'mime=' +
                String((safeTrack as any)?.mimeType || 'unknown'),
              'eac3Tracks=' + String(eac3Tracks.length)
            );
          } else {
            v766SuppressEac3ErrorUntilRef.current =
              Date.now() + 3000;

            try {
              player.pause();
            } catch (_) {}

            console.log(
              '[V766 EAC3 CIRCUIT] predecode skip',
              'tracks=' + String(tracks.length),
              'mime=audio/eac3'
            );

            errorCallbackRef.current?.(
              new Error(
                'unsupported format: audio/eac3; ' +
                'decoder failed: c2.dolby.eac3.decoder.eac3'
              )
            );

            return;
          }
        }
      }

      // V616C_DEFAULT_ENGLISH_AUDIO
      //
      // Prefer an explicitly English embedded track on every new
      // source. If none exists, preserve ExoPlayer's normal default.
      //
      // Never override a manual selection made through V616B.
      if (
        tracks.length > 0 &&
        !v616cUserSelectedAudioRef.current
      ) {
        try {
          const isEnglish = (track: any): boolean => {
            const language =
              String(track?.language || '')
                .trim()
                .toLowerCase();

            const label =
              String(track?.label || '')
                .trim()
                .toLowerCase();

            return (
              language === 'en' ||
              language === 'eng' ||
              language === 'english' ||
              language.startsWith('en-') ||
              language.startsWith('en_') ||
              /\benglish\b/.test(label) ||
              /\beng\b/.test(label)
            );
          };

          const englishTrack =
            tracks.find(isEnglish) || null;

          if (englishTrack) {
            player.audioTrack = englishTrack;

            console.log(
              '[V616C] default audio=ENGLISH' +
                ' language=' +
                String(
                  (englishTrack as any)?.language ||
                    'unknown'
                ) +
                ' label=' +
                String(
                  (englishTrack as any)?.label ||
                    'unknown'
                )
            );
          } else if (v766Eac3DecoderBrokenRef.current) {
            // V767G_SAFE_NON_EAC3_AUDIO_RESTORE
            //
            // V766 intentionally clears player.audioTrack before
            // loading a source on a device with proven-broken EAC3.
            // If this source later proves to contain only safe
            // non-EAC3 audio with missing/unknown language metadata,
            // explicitly restore that safe track instead of leaving
            // audioTrack=null and playing silent video.
            const safeDefaultTrack =
              tracks.find((track: any) => {
                const mime =
                  String(track?.mimeType || '')
                    .trim()
                    .toLowerCase();

                return (
                  mime !== 'audio/eac3' &&
                  mime !== 'audio/eac3-joc'
                );
              }) || null;

            if (safeDefaultTrack) {
              player.audioTrack = safeDefaultTrack;

              // Match the existing V766 safe-track branch:
              // once we deliberately choose a safe track for this
              // source, do not let default-language logic replace it.
              v616cUserSelectedAudioRef.current = true;

              console.log(
                '[V767G SAFE AUDIO RESTORE]',
                'mime=' +
                  String(
                    (safeDefaultTrack as any)?.mimeType ||
                      'unknown'
                  ),
                'language=' +
                  String(
                    (safeDefaultTrack as any)?.language ||
                      'unknown'
                  ),
                'label=' +
                  String(
                    (safeDefaultTrack as any)?.label ||
                      'unknown'
                  )
              );
            } else {
              console.log(
                '[V616C] no English audio track; keeping stream default'
              );
            }
          } else {
            console.log(
              '[V616C] no English audio track; keeping stream default'
            );
          }
        } catch (error) {
          console.log(
            '[V616C] English audio default failed',
            error
          );
        }
      }

      emitCompatStatus(false);
    }
  );

  useEventListener(
    player,
    'statusChange',
    ({ status, error }) => {
      if (status === 'error') {
        // V766_EAC3_RUNTIME_PROOF
        const v766ErrorMessage =
          String(error?.message || error || '')
            .trim()
            .toLowerCase();

        const v766IsEac3DecoderFailure =
          v766ErrorMessage.includes('c2.dolby.eac3.decoder.eac3') ||
          (
            v766ErrorMessage.includes('audio/eac3') &&
            v766ErrorMessage.includes('decoder failed')
          );

        if (v766IsEac3DecoderFailure) {
          if (
            Date.now() <
            v766SuppressEac3ErrorUntilRef.current
          ) {
            console.log(
              '[V766 EAC3 CIRCUIT] suppressed stale native EAC3 error'
            );
            return;
          }

          v766Eac3DecoderBrokenRef.current = true;

          setItemDurable('v766_eac3_decoder_broken', '1')
            .catch(() => {});

          console.log(
            '[V766 EAC3 CIRCUIT] learned broken EAC3 decoder from runtime proof'
          );
        }
        console.log(
          '[V616A] player error',
          error?.message || error || 'unknown'
        );

        errorCallbackRef.current?.(
          error || new Error('expo-video playback error')
        );
      }

      emitCompatStatus(false);
    }
  );

  useEventListener(
    player,
    'playToEnd',
    () => {
      if (v658SourceReplacingRef.current) {
        console.log('[V658_STALE_PLAYTOEND_GUARD] ignored playToEnd during source replacement');
        return;
      }

      v690ClearEndFallbackTimer();

      if (v690EndFallbackFiredRef.current) {
        return;
      }

      v690EndFallbackFiredRef.current = true;

      console.log(
        '[V690C_NATIVE_PLAYTOEND] didJustFinish=true'
      );

      emitCompatStatus(true);
    }
  );

  return (
    <VideoView
      player={player}
      style={style}
      contentFit={contentFitFromResizeMode(resizeMode)}
      nativeControls={false}
      // V617_VIDEO_NOT_TV_FOCUSABLE
      // The video surface is visual only. TV focus belongs exclusively
      // to the existing overlay controls.
      focusable={false}
      // V657_PHONE_TOUCH_THROUGH_VIDEO
      // Native VideoView is visual-only; parent Pressable owns touch controls.
      pointerEvents="none"
    />
  );
});

ExpoVideoCompat.displayName = 'ExpoVideoCompat';