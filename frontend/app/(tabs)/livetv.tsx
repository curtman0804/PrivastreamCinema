import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  findNodeHandle,
  DeviceEventEmitter,
  useTVEventHandler,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PrivastreamLiveTVStationList from '../../src/components/PrivastreamLiveTVStationList';
import PrivastreamLiveTVGuide from '../../src/components/PrivastreamLiveTVGuide';
import { useFocusEffect, useRouter } from 'expo-router';

import { api, ContentItem } from '../../src/api/client';
import { useContentStore } from '../../src/store/contentStore';
import {
  v176iRegisterGetter,
} from '../../src/components/ContentCard';

const SLOT_MS = 30 * 60 * 1000;
const SLOT_WIDTH = 210;
// V788R2_EIGHT_HOUR_GUIDE
const SLOT_COUNT = 16;
const CHANNEL_WIDTH = 340;
// V788R2_COMPACT_GUIDE_ROWS
// V788T7B_COMPACT_GUIDE_ROWS
const ROW_HEIGHT = 52;

type GuideProgram = {
  id?: string;
  title?: string;
  startTime: string;
  endTime: string;
  overview?: string;
  thumbnail?: string;
};

type GuideChannel = {
  key: string;
  item: ContentItem;
  name: string;
  logo?: string;
  sourceName?: string;
  addonId?: string;
  programs: GuideProgram[];
};

const localDateKey = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const floorHalfHour = (ms: number) =>
  Math.floor(ms / SLOT_MS) * SLOT_MS;

const timeLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

export default function LiveTVScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const timelineRef = useRef<ScrollView>(null);

  // V788T6B_PINNED_GUIDE_HEADER
  const timelineHeaderRef =
    useRef<ScrollView>(null);

  // V788T8L_NATIVE_STATION_PROGRAM_SYNC
  const v788t8lProgramVerticalRef =
    useRef<ScrollView>(null);

  // V788T6B_FOCUS_REGISTRY_STABILITY
  // Inline callback refs can receive null and then reattach
  // during an ordinary React render. Delay unregister by one
  // turn so that transient ref churn does not rebuild every
  // native TV focus link.
  const v788t6PendingUnregisterRef =
    useRef<Map<string, ReturnType<typeof setTimeout>>>(
      new Map()
    );

  // V788S1_STABLE_PROGRAM_VERTICAL_ANCHOR
  const v788sProgramAnchorRef =
    useRef<number | null>(null);

  const v788sLastProgramRowRef =
    useRef<number | null>(null);

  // V788N4A_DETERMINISTIC_PROGRAM_VERTICAL_FOCUS
  // Registry contains only currently mounted V788H guide cells.
  const v788nProgramFocusMapRef =
    useRef<Map<string, any>>(new Map());

  const v788nFocusWireTimerRef =
  useRef<ReturnType<typeof setTimeout> | null>(null);

  // V788T7B_DETERMINISTIC_STATION_VERTICAL_FOCUS
  const v788t7StationFocusMapRef =
    useRef<Map<string, any>>(new Map());

  const v788t7StationFocusWireTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null
    );

  const v788t7PendingStationUnregisterRef =
    useRef<Map<string, ReturnType<typeof setTimeout>>>(
      new Map()
    );

// V788P5D_POSTER_STYLE_CHANNEL_BOOKMARK
const v788pFocusedStationKeyRef =
  useRef<string | null>(null);

// V788T8C3_GUIDE_TRAY_EXIT
const v788t8cFocusAreaRef =
  useRef<'station' | 'program' | 'none'>('none');

const v788t8cFocusedRowRef =
  useRef<number | null>(null);

const v788t8cChannelCountRef = useRef(0);
const v788t8cFirstLeftRef = useRef(0);
const v788t8cRawLeftRef = useRef(0);

// V788T8Y_R3_TRAY_ACK_HANDSHAKE
const v788t8yTrayPendingRef =
  useRef(false);

const v788t8yTrayTimeoutRef =
  useRef<any>(null);

const v788t8cFocusTray = useCallback(() => {
  // Guide still owns Android focus here.
  // Do not erase guide focus state yet.
  v788t8cFirstLeftRef.current = 0;
  v788t8cRawLeftRef.current = 0;
  v788t8yTrayPendingRef.current = true;

  if (v788t8yTrayTimeoutRef.current) {
    clearTimeout(
      v788t8yTrayTimeoutRef.current
    );
  }

  console.log(
    '[V788T8Y TRAY] REQUEST'
  );

  DeviceEventEmitter.emit(
    'v788t8c:focusLiveTvTray'
  );

  v788t8yTrayTimeoutRef.current =
    setTimeout(() => {
      if (!v788t8yTrayPendingRef.current) {
        return;
      }

      v788t8yTrayPendingRef.current = false;

      console.log(
        '[V788T8Y TRAY] NO ACK - GUIDE PRESERVED'
      );
    }, 700);
}, []);

useEffect(() => {
  const subscription =
    DeviceEventEmitter.addListener(
      'v788t8y:liveTvTrayFocused',
      () => {
        if (!v788t8yTrayPendingRef.current) {
          return;
        }

        v788t8yTrayPendingRef.current = false;

        if (v788t8yTrayTimeoutRef.current) {
          clearTimeout(
            v788t8yTrayTimeoutRef.current
          );

          v788t8yTrayTimeoutRef.current = null;
        }

        // Tray now REALLY owns Android focus.
        v788t8cFocusAreaRef.current = 'none';
        v788t8cFocusedRowRef.current = null;
        v788t8cFirstLeftRef.current = 0;
        v788t8cRawLeftRef.current = 0;

        console.log(
          '[V788T8Y TRAY] ACK'
        );
      }
    );

  return () => {
    subscription.remove();

    if (v788t8yTrayTimeoutRef.current) {
      clearTimeout(
        v788t8yTrayTimeoutRef.current
      );
    }
  };
}, []);

const v788pStationLongPressRef =
  useRef<(() => void) | null>(null);

const v788pToggleFavoriteRef =
  useRef<
    (
      (
        channel: GuideChannel
      ) => void | Promise<void>
    ) | null
  >(null);

const v788pClearStationLongPress =
  useCallback(
    (expectedKey?: string) => {
      if (
        expectedKey &&
        v788pFocusedStationKeyRef.current !==
          expectedKey
      ) {
        return;
      }

      v788pFocusedStationKeyRef.current =
        null;

      v788pStationLongPressRef.current =
        null;

      try {
        v176iRegisterGetter(null);
      } catch (_) {}
    },
    []
  );

// V788P5D_NAV_DIAG
useTVEventHandler((event: any) => {
  const type =
    String(
      event?.eventType || ''
    ).toLowerCase();

  if (
    type === 'up' ||
    type === 'down' ||
    type === 'left' ||
    type === 'right' ||
    type === 'select' ||
    type === 'longselect'
  ) {
    console.log(
      '[V788P5D NAV KEY] ' +
      type
    );

    // V788T8C3_GUIDE_TRAY_EXIT
    const focusArea = v788t8cFocusAreaRef.current;
    const row = v788t8cFocusedRowRef.current;

    if (
      type === 'down' &&
      row != null &&
      row === v788t8cChannelCountRef.current - 1
    ) {
      setTimeout(v788t8cFocusTray, 0);
      return;
    }

    if (focusArea === 'station' && type === 'left') {
      const t = Date.now();

      if (t - v788t8cRawLeftRef.current < 100) {
        return;
      }

      v788t8cRawLeftRef.current = t;
      const first = v788t8cFirstLeftRef.current;

      if (
        first > 0 &&
        t - first >= 100 &&
        t - first <= 1200
      ) {
        setTimeout(v788t8cFocusTray, 0);
        return;
      }

      v788t8cFirstLeftRef.current = t;
      return;
    }

    if (type !== 'left') {
      v788t8cFirstLeftRef.current = 0;
      v788t8cRawLeftRef.current = 0;
    }
  }
});

  // V788H1_LIVE_GUIDE_WINDOWING
  // Keep the existing synchronized ScrollView structure, but only mount
  // rows near the current vertical viewport.
  const [v788hViewportRow, setV788hViewportRow] = useState(0);

  // V785L6B_LIVE_GUIDE_FOCUS_RETURN
  const [preferredChannelIndex, setPreferredChannelIndex] =
  useState(0);

// V788Q1_ONE_SHOT_PREFERRED_FOCUS
// hasTVPreferredFocus is only allowed to restore initial/return focus.
// It must NOT chase ordinary D-pad focus.
const v788qPreferredFocusArmedRef =
  useRef(true);
  const loadGenerationRef = useRef(0); // V784L_LIVE_TV_FOCUS_REFRESH

  // V785A_LIVE_GUIDE_PERSIST
  // Keep the already-rendered guide resident while /player sits above it.
  // Returning from playback must not blank/rebuild the guide.
  const guideLoadedRef = useRef(false);
  const guideLoadInFlightRef = useRef(false);
  const lastGuideLoadAtRef = useRef(0);

  const library = useContentStore((s) => s.library);
  const fetchLibrary = useContentStore((s) => s.fetchLibrary);
  const addToLibrary = useContentStore((s) => s.addToLibrary);
  const removeFromLibrary = useContentStore((s) => s.removeFromLibrary);

  const [channels, setChannels] = useState<GuideChannel[]>([]);
  v788t8cChannelCountRef.current = channels.length;
  const [loading, setLoading] = useState(true);

  // V787I_GUIDE_NOW_PLAYING_CLOCK
  const [now, setNow] = useState(() => Date.now());
 useEffect(() => {
   const timer = setInterval(
     () => setNow(Date.now()),
     30000
   );

   return () =>
     clearInterval(timer);
 }, []);

 // V788P5D_HALF_HOUR_BOUNDARY_TICK
 useEffect(() => {
   let timer:
     | ReturnType<typeof setTimeout>
     | null = null;

   const scheduleBoundary = () => {
     const current =
       Date.now();

     const next =
       floorHalfHour(current) +
       SLOT_MS;

     timer =
       setTimeout(
         () => {
           setNow(Date.now());
           scheduleBoundary();
         },
         Math.max(
           50,
           next - current + 50
         )
       );
   };

   scheduleBoundary();

   return () => {
     if (timer !== null) {
       clearTimeout(timer);
     }
   };
 }, []);
  // V788P5D_CURRENT_HALF_HOUR
const timelineStart = floorHalfHour(now);
  const timelineEnd = timelineStart + SLOT_COUNT * SLOT_MS;
  const guideWidth = SLOT_COUNT * SLOT_WIDTH;

  // V788H1_LIVE_GUIDE_WINDOWING
  // A TV screen only displays a handful of guide rows. Keep a generous
  // twelve-row buffer on either side so native D-pad focus always has
  // upcoming rows mounted before the ScrollView reaches them.
  const v788hVisibleRows = Math.max(
    8,
    Math.ceil(height / ROW_HEIGHT) + 2
  );

  const v788hOverscanRows = 12;

  // V788T8B_NAV_LOW_CHURN_WINDOW
  // Keep the same 12-row safety buffer.
  // Advance the React render window only every four rows
  // instead of rebuilding mounted focusables every row.
  const v788t8WindowStepRows = 4;

  const v788hRenderStart = Math.max(
    0,
    v788hViewportRow - v788hOverscanRows
  );

  const v788hRenderEnd = Math.min(
    channels.length,
    v788hViewportRow +
      v788hVisibleRows +
      v788hOverscanRows
  );

  const v788hRenderChannels = channels.slice(
    v788hRenderStart,
    v788hRenderEnd
  );

  const v788hTopSpacerHeight =
    v788hRenderStart * ROW_HEIGHT;

  const v788hBottomSpacerHeight =
    Math.max(
      0,
      channels.length - v788hRenderEnd
    ) * ROW_HEIGHT;

  const favoriteIds = useMemo(() => {
    const out = new Set<string>();
    for (const item of library?.channels || []) {
      const id = String(item.imdb_id || item.id || '').trim();
      if (id) out.add(id);
    }
    return out;
  }, [library]);

  // V788T8X_REALTIME_BOOKMARK
  const [
    v788t8xFavoriteOverrides,
    setV788t8xFavoriteOverrides,
  ] = useState<Record<string, boolean>>({});

  const v788t8xIsFavorite = useCallback(
    (id: string) => {
      if (
        Object.prototype.hasOwnProperty.call(
          v788t8xFavoriteOverrides,
          id
        )
      ) {
        return v788t8xFavoriteOverrides[id];
      }

      return favoriteIds.has(id);
    },
    [favoriteIds, v788t8xFavoriteOverrides]
  );

  // V788T8ZA_STICKY_CONFIRMED_BOOKMARK
  //
  // A bookmark override is no longer merely temporary.
  // Once the API/library confirms it, keep that exact value
  // authoritative for this mounted Live TV screen.
  //
  // This prevents unrelated/concurrent library refreshes from
  // visually reverting a bookmark while rows are recycled.
  // A full Live TV remount/app restart still initializes from
  // the persisted library returned by the server.

  const loadGuide = useCallback(async (silent = false) => {
    // V785A_LIVE_GUIDE_PERSIST
    if (guideLoadInFlightRef.current) {
      console.log('[V785A LIVE GUIDE] load already in flight - reuse current guide');
      return;
    }

    guideLoadInFlightRef.current = true;

    const generation = ++loadGenerationRef.current;

    // Only show the full guide loader when we truly have no guide yet.
    if (!silent && !guideLoadedRef.current) {
      setLoading(true);
    }

    try {
      const date = localDateKey(new Date());

      const [discoverResult, epgResult] = await Promise.allSettled([
        api.content.getDiscover(),
        api.content.getLiveTvEpg(date),
      ]);

      const epgById = new Map<string, any>();
      const epgOnly: any[] = [];

      if (epgResult.status === 'fulfilled') {
        for (const provider of epgResult.value?.providers || []) {
          for (const channel of provider?.channels || []) {
            const id = String(channel?.id || '').trim();
            if (!id) continue;

            const enriched = {
              ...channel,
              sourceName: provider?.addonName || provider?.catalogName || '',
              addonId: String(provider?.addonId || ''),
            };

            epgById.set(id, enriched);
            epgOnly.push(enriched);
          }
        }
      } else {
        console.warn('[V784J_EPG] unavailable', epgResult.reason);
      }

      const next: GuideChannel[] = [];
      const seen = new Set<string>();

      if (discoverResult.status === 'fulfilled') {
        const services = (discoverResult.value as any)?.services || {};

        for (const [sourceName, service] of Object.entries(services)) {
          const list = Array.isArray((service as any)?.channels)
            ? (service as any).channels
            : [];

          const serviceAddonId = String(
            (service as any)?._addon_id || ''
          ).trim();

          for (const raw of list) {
            const id = String(
              (raw as any)?.imdb_id || (raw as any)?.id || ''
            ).trim();

            if (!id) continue;

            // V786B_LIVE_TV_OWNER_ID_DEDUPE
            // A channel belongs to its addon, not to the catalog/service
            // label it happened to arrive through. The same Pluto station
            // may appear in more than one service bucket.
            const identityOwner =
              serviceAddonId || `source:${String(sourceName)}`;
            const key = `${identityOwner}:${id}`;

            if (seen.has(key)) continue;
            seen.add(key);

            const epg = epgById.get(id);
            // V788M_GUIDE_LOGO_ONLY_COMPACT
            // Never use catalog posters as station icons.
            // Prefer authoritative EPG logos when available.
            const stationLogo = String(
              epg?.logo ||
              (raw as any)?.logo ||
              ''
            ).trim();

            next.push({
              key,
              item: {
                ...(raw as any),
                id,
                type: 'tv',
                name: String(
                  (raw as any)?.name || epg?.name || id
                ),
                poster: stationLogo,
              },
              name: String((raw as any)?.name || epg?.name || id),
              logo: stationLogo,
              sourceName: String(sourceName),
              addonId: serviceAddonId,
              programs: Array.isArray(epg?.programs)
                ? epg.programs
                : [],
            });
          }
        }
      }

      for (const raw of epgOnly) {
        const id = String(raw?.id || '').trim();
        if (!id) continue;

        if (next.some((c) => String(c.item.id) === id)) continue;

        const stationLogo = String(raw?.logo || '').trim();

        next.push({
          key: `${raw.sourceName || 'epg'}:${id}`,
          item: {
            ...(raw as any),
            id,
            type: 'tv',
            name: String(raw?.name || id),
            poster: stationLogo,
          },
          name: String(raw?.name || id),
          logo: stationLogo,
          sourceName: String(raw?.sourceName || ''),
          addonId: String(raw?.addonId || ''),
          programs: Array.isArray(raw?.programs) ? raw.programs : [],
        });
      }

      if (generation !== loadGenerationRef.current) return;
      // V784O_LIVE_TV_AZ
      next.sort((a, b) =>
        String(a.name || '').localeCompare(
          String(b.name || ''),
          undefined,
          {
            sensitivity: 'base',
            numeric: true,
          }
        )
      );

      setChannels(next);

      guideLoadedRef.current = true;
      lastGuideLoadAtRef.current = Date.now();

      console.log(
        '[V785A LIVE GUIDE] snapshot committed channels=' + next.length
      );
    } catch (error) {
      console.warn('[V784J_LIVE_TV] guide load failed', error);
      // Never destroy an already-painted guide because a later refresh failed.
      if (
        generation === loadGenerationRef.current &&
        !guideLoadedRef.current
      ) {
        setChannels([]);
      }
    } finally {
      guideLoadInFlightRef.current = false;

      if (generation === loadGenerationRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // V788T8V_RETURN_FOCUS_HANDSHAKE
  const [
    v788t8vFocusRestoreSerial,
    setV788t8vFocusRestoreSerial,
  ] = useState(0);

  useFocusEffect(
    useCallback(() => {
      // V785L6B_LIVE_GUIDE_FOCUS_RETURN
      try {
        const {
          getLiveTvCurrent,
        } = require('../../src/liveTvNav');

        const current = getLiveTvCurrent();
        const restoreIndex = Number(current?.index);

        if (
          Number.isInteger(restoreIndex) &&
          restoreIndex >= 0
        ) {
          v788qPreferredFocusArmedRef.current =
          true;

        setPreferredChannelIndex(restoreIndex);

        // V788T8V_FORCE_NATIVE_FOCUS_RETURN
        // The row number may be unchanged after playback,
        // so preferredFocusIndex alone cannot be the trigger.
        setV788t8vFocusRestoreSerial(
          (serial) => serial + 1
        );

          console.log(
            '[V785L6B LIVE GUIDE] restore focus index=' + restoreIndex,
            'id=' + String(current?.entry?.id || '')
          );
        }
      } catch (error) {
        console.warn(
          '[V785L6B LIVE GUIDE] focus restore lookup failed',
          error
        );
      }

      const ageMs =
        lastGuideLoadAtRef.current > 0
          ? Date.now() - lastGuideLoadAtRef.current
          : Number.POSITIVE_INFINITY;

      if (!guideLoadedRef.current) {
        console.log('[V785A LIVE GUIDE] cold load');

        void Promise.all([
          loadGuide(false),
          fetchLibrary(true),
        ]);
      } else if (ageMs >= 5 * 60 * 1000) {
        // Refresh stale EPG data without replacing the screen with a loader.
        console.log(
          '[V785A LIVE GUIDE] stale snapshot - silent refresh ageMs=' +
            ageMs
        );

        void Promise.all([
          loadGuide(true),
          fetchLibrary(true),
        ]);
      } else {
        console.log(
          '[V785A LIVE GUIDE] focus return - preserve snapshot ageMs=' +
            ageMs
        );
      }

      // IMPORTANT:
      // Do not invalidate the guide merely because /player took focus.
      // The Live TV screen stays underneath the player.
      return undefined;
    }, [loadGuide, fetchLibrary])
  );

  const openChannel = useCallback(async (channel: GuideChannel) => {
    const id = String(
      channel.item.imdb_id ||
      channel.item.id ||
      ''
    ).trim();

    if (!id) return;

    const addonId = String(channel.addonId || '').trim();

    if (!addonId) {
      console.warn('[V784N LIVE TV] missing owning addon', id);
      return;
    }

    try {
      // V784N_DIRECT_OWNER_PLAYBACK
      // Resolve ONLY through the addon that supplied this channel.
      const result = await api.addons.getStreams(
        addonId,
        'tv',
        id
      );
      const streams = Array.isArray(result?.streams)
        ? result.streams
        : [];

      const directStreams = streams
        .map((stream: any) => {
          const streamUrl = String(
            stream?.url ||
            stream?.directUrl ||
            stream?.proxyUrl ||
            ''
          ).trim();

          return {
            ...stream,
            _liveUrl: streamUrl,
          };
        })
        .filter((stream: any) => {
          return (
            /^https?:\/\//i.test(stream._liveUrl) ||
            stream._liveUrl.startsWith('/api/')
          );
        });

      const primary =
        directStreams.find((stream: any) =>
          /\.m3u8(?:[?#]|$)/i.test(stream._liveUrl)
        ) ||
        directStreams[0];

      if (!primary) {
        console.warn(
          '[V784M LIVE TV] no direct stream for',
          id
        );
        return;
      }

      const fallbacks = directStreams
        .filter((stream: any) => stream !== primary)
        .slice(0, 12)
        .map((stream: any) => ({
          url: stream._liveUrl,
          name: stream.name || '',
          title: stream.title || '',
          addon: stream.addon || '',
        }));

      // V785L5_LIVE_CHANNEL_NAV
      try {
        const {
          setLiveTvNavSnapshot,
        } = require('../../src/liveTvNav');

        setLiveTvNavSnapshot(
          channels.map((entry) => ({
            id: String(
              entry.item.imdb_id ||
              entry.item.id ||
              ''
            ).trim(),
            addonId: String(
              entry.addonId || ''
            ).trim(),
            name: String(entry.name || ''),
            logo: String(entry.logo || ''),
            sourceName: String(entry.sourceName || ''),
            programs: (
              Array.isArray(entry.programs)
                ? entry.programs
                : []
            ).map((program) => ({
              id: String(program?.id || ''),
              title: String(program?.title || ''),
              startTime: String(program?.startTime || ''),
              endTime: String(program?.endTime || ''),
              overview: String(program?.overview || ''),
              thumbnail: String(program?.thumbnail || ''),
            })),
          })),
          id,
          addonId
        );

        console.log(
          '[V785L5 LIVE SURF] snapshot',
          'channels=' + channels.length,
          'id=' + id
        );
      } catch (error) {
        console.warn(
          '[V785L5 LIVE SURF] snapshot failed',
          error
        );
      }

      router.push({
        pathname: '/player',
        params: {
          directUrl: primary._liveUrl,
          title: channel.name,
          isLive: 'true',
          contentType: 'tv',
          contentId: id,
          addonId: addonId,
          logo: channel.logo || '',
          poster: '',
          backdrop: '',
          fallbackStreams: JSON.stringify(fallbacks),
        },
      } as any);

    } catch (error) {
      console.warn(
        '[V784M LIVE TV] stream resolve failed',
        id,
        error
      );
    }
  }, [router, channels]);

  // V788T8Z_PERSISTED_BOOKMARK_ACK
  const v788t8zLibraryHasChannel = useCallback(
    (id: string) => {
      const currentLibrary =
        useContentStore.getState().library;

      return (currentLibrary?.channels || []).some(
        (item: any) =>
          String(
            item?.imdb_id ||
            item?.id ||
            ''
          ).trim() === id
      );
    },
    []
  );

  const toggleFavorite = useCallback(
    async (channel: GuideChannel) => {
      const id = String(
        channel.item.imdb_id ||
        channel.item.id ||
        ''
      ).trim();

      if (!id) return;

      const wasFavorite =
        v788t8xIsFavorite(id);

      const nextFavorite =
        !wasFavorite;

      // Immediate visual response.
      setV788t8xFavoriteOverrides(
        (previous) => ({
          ...previous,
          [id]: nextFavorite,
        })
      );

      console.log(
        '[V788T8Z BOOKMARK] optimistic',
        id,
        nextFavorite
      );

      try {
        if (wasFavorite) {
          await removeFromLibrary(
            'tv',
            id
          );
        } else {
          await addToLibrary({
            ...channel.item,
            id,
            type: 'tv',
            poster:
              channel.item.poster ||
              channel.logo ||
              '',
          });
        }

        // Do not trust only the mutation promise.
        // Pull the authoritative library again and
        // verify the channel is actually persisted.
        await fetchLibrary(true);

        const persistedFavorite =
          v788t8zLibraryHasChannel(id);

        console.log(
          '[V788T8Z BOOKMARK] persisted-check',
          id,
          'wanted=' + nextFavorite,
          'actual=' + persistedFavorite
        );

        if (persistedFavorite !== nextFavorite) {
          throw new Error(
            'library did not confirm bookmark state'
          );
        }

        // V788T8ZA_STICKY_CONFIRMED_BOOKMARK
        // The server has confirmed the requested state.
        // Keep the same value pinned for this Live TV mount.
        setV788t8xFavoriteOverrides(
          (previous) => ({
            ...previous,
            [id]: nextFavorite,
          })
        );

        console.log(
          '[V788T8ZA BOOKMARK] confirmed-sticky',
          id,
          nextFavorite
        );
      } catch (error) {
        // The authoritative library did not confirm
        // the requested state. Put the visual back.
        setV788t8xFavoriteOverrides(
          (previous) => ({
            ...previous,
            [id]: wasFavorite,
          })
        );

        console.warn(
          '[V788T8Z BOOKMARK] persistence not confirmed',
          id,
          error
        );
      }
    },
    [
      v788t8xIsFavorite,
      v788t8zLibraryHasChannel,
      addToLibrary,
      removeFromLibrary,
      fetchLibrary,
    ]
  );

 // V788P5D_POSTER_STYLE_CHANNEL_BOOKMARK
 v788pToggleFavoriteRef.current =
   toggleFavorite;

 // V788T8L_NATIVE_STATION_ITEMS
 const v788t8lStationItems = useMemo(
   () =>
     channels.map((channel) => {
       const id = String(
         channel.item.imdb_id ||
         channel.item.id ||
         ''
       );

       return {
         key: channel.key,
         title: channel.name,
         logo: channel.logo || null,
         favorite: v788t8xIsFavorite(id),
       };
     }),
   [channels, v788t8xIsFavorite]
 );

 // V788T4A_PROGRAM_GEOMETRY
 // Snap the horizontal guide to the focused program.
 // Queued animations can move content underneath native TV focus.
 // V788T8P_WHOLE_ROW_NATIVE_ITEMS
 const v788t8pGuideItems = useMemo(
   () =>
     channels.map((channel) => {
       const id = String(
         channel.item.imdb_id ||
         channel.item.id ||
         ''
       );

       return {
         key: channel.key,
         title: channel.name,
         logo: channel.logo || null,
         favorite: v788t8xIsFavorite(id),
         programs: channel.programs
           .map((program, index) => ({
             id: String(
               program.id || index
             ),
             title: String(
               program.title || 'Programming'
             ),
             startMs:
               new Date(
                 program.startTime
               ).getTime(),
             endMs:
               new Date(
                 program.endTime
               ).getTime(),
           }))
           .filter((program) =>
             Number.isFinite(program.startMs) &&
             Number.isFinite(program.endMs) &&
             program.endMs > program.startMs
           ),
       };
     }),
   [channels, v788t8xIsFavorite]
 );
 const focusProgram = useCallback((left: number) => {
    const nextX =
      Math.max(0, left - 40);

    timelineRef.current?.scrollTo({
      x: nextX,
      animated: false,
    });

    timelineHeaderRef.current?.scrollTo({
      x: nextX,
      animated: false,
    });
  }, []);

  // V788T7B_DETERMINISTIC_STATION_VERTICAL_FOCUS
  // The channel column must not use Android spatial search.
  // Native Up/Down is wired to the exact adjacent channel row.
  const v788t7WireStationFocus = useCallback(() => {
    const entries =
      Array.from(
        v788t7StationFocusMapRef.current.values()
      );

    const byRow =
      new Map<number, any>();

    for (const entry of entries) {
      byRow.set(
        entry.rowIndex,
        entry
      );
    }

    for (const entry of entries) {
      const up =
        byRow.get(
          entry.rowIndex - 1
        );

      const down =
        byRow.get(
          entry.rowIndex + 1
        );

      const selfTag =
        entry.tag || undefined;

      try {
        entry.ref?.setNativeProps({
          nextFocusUp:
            up?.tag || selfTag,

          nextFocusDown:
            down?.tag || selfTag,

          // V788T8C3_STATION_LEFT_TRAP
          nextFocusLeft:
            selfTag,
        });
      } catch (_) {}
    }
  }, []);

  const v788t7ScheduleStationFocusWire =
    useCallback(() => {
      if (
        v788t7StationFocusWireTimerRef.current !=
          null
      ) {
        clearTimeout(
          v788t7StationFocusWireTimerRef.current
        );
      }

      v788t7StationFocusWireTimerRef.current =
        setTimeout(() => {
          v788t7StationFocusWireTimerRef.current =
            null;

          v788t7WireStationFocus();
        }, 0);
    }, [v788t7WireStationFocus]);

  const v788t7RegisterStationFocus =
    useCallback(
      (
        key: string,
        rowIndex: number,
        node: any
      ) => {
        const registry =
          v788t7StationFocusMapRef.current;

        if (!node) {
          const priorPending =
            v788t7PendingStationUnregisterRef.current.get(
              key
            );

          if (priorPending != null) {
            clearTimeout(priorPending);
          }

          const pending =
            setTimeout(() => {
              v788t7PendingStationUnregisterRef.current.delete(
                key
              );

              const removed =
                registry.delete(key);

              if (removed) {
                v788t7ScheduleStationFocusWire();
              }
            }, 0);

          v788t7PendingStationUnregisterRef.current.set(
            key,
            pending
          );

          return;
        }

        const pendingUnregister =
          v788t7PendingStationUnregisterRef.current.get(
            key
          );

        if (pendingUnregister != null) {
          clearTimeout(pendingUnregister);

          v788t7PendingStationUnregisterRef.current.delete(
            key
          );
        }

        let tag = 0;

        try {
          tag =
            Number(
              findNodeHandle(node) || 0
            );
        } catch (_) {
          tag = 0;
        }

        if (!tag) {
          return;
        }

        const previousEntry =
          registry.get(key);

        const unchanged =
          previousEntry != null &&
          previousEntry.rowIndex === rowIndex &&
          previousEntry.tag === tag;

        registry.set(
          key,
          {
            key,
            rowIndex,
            tag,
            ref: node,
          }
        );

        if (!unchanged) {
          v788t7ScheduleStationFocusWire();
        }
      },
      [v788t7ScheduleStationFocusWire]
    );

  useEffect(() => {
    return () => {
      if (
        v788t7StationFocusWireTimerRef.current !=
          null
      ) {
        clearTimeout(
          v788t7StationFocusWireTimerRef.current
        );
      }

      for (
        const pending of
          v788t7PendingStationUnregisterRef.current.values()
      ) {
        clearTimeout(pending);
      }

      v788t7PendingStationUnregisterRef.current.clear();
      v788t7StationFocusMapRef.current.clear();
    };
  }, []);

  // V788N4A_DETERMINISTIC_PROGRAM_VERTICAL_FOCUS
  //
  // Up/Down goes exactly one channel row.
  // Prefer the cell covering the same point in time.
  // Otherwise choose the temporally closest cell.
  const v788nWireProgramFocus = useCallback(() => {
    const entries =
      Array.from(
        v788nProgramFocusMapRef.current.values()
      );

    const byRow =
      new Map<number, any[]>();

    for (const entry of entries) {
      const list =
        byRow.get(entry.rowIndex) || [];

      list.push(entry);

      byRow.set(
        entry.rowIndex,
        list
      );
    }

    // V788T8B_NAV_DETERMINISTIC_PROGRAM_ORDER
    for (const list of byRow.values()) {
      list.sort((a, b) => {
        if (a.start !== b.start) {
          return a.start - b.start;
        }

        if (a.end !== b.end) {
          return a.end - b.end;
        }

        return String(a.key).localeCompare(
          String(b.key)
        );
      });
    }

    const pickTarget = (
      sourceEntry: any,
      targetRowIndex: number
    ) => {
      const candidates =
        byRow.get(targetRowIndex) || [];

      if (candidates.length === 0) {
        return null;
      }

      // V788T5C_NO_GUIDE_LEFTMOST_VERTICAL_TARGET
      // A No Guide cell spans the whole timeline and therefore
      // has no meaningful horizontal time anchor. When leaving
      // one vertically, enter the target row at its left-most
      // focusable program instead of inheriting a stale anchor.
      if (
        String(sourceEntry.key || '').startsWith(
          'no-guide:'
        )
      ) {
        let leftmost = candidates[0];

        for (const candidate of candidates) {
          if (
            candidate.start < leftmost.start ||
            (
              candidate.start === leftmost.start &&
              candidate.end < leftmost.end
            )
          ) {
            leftmost = candidate;
          }
        }

        return leftmost;
      }

      const fallbackAnchor =
        (
          sourceEntry.start +
          sourceEntry.end
        ) / 2;

      const rememberedAnchor =
        v788sProgramAnchorRef.current;

      const anchor =
        typeof rememberedAnchor === 'number' &&
        Number.isFinite(rememberedAnchor)
          ? rememberedAnchor
          : fallbackAnchor;

      let best: any = null;

      let bestGap =
        Number.POSITIVE_INFINITY;

      let bestCenterGap =
        Number.POSITIVE_INFINITY;

      for (const candidate of candidates) {
        let gap = 0;

        if (anchor < candidate.start) {
          gap =
            candidate.start - anchor;
        } else if (anchor > candidate.end) {
          gap =
            anchor - candidate.end;
        }

        const center =
          (
            candidate.start +
            candidate.end
          ) / 2;

        const centerGap =
          Math.abs(
            center - anchor
          );

        if (
          gap < bestGap ||
          (
            gap === bestGap &&
            centerGap < bestCenterGap
          )
        ) {
          best =
            candidate;

          bestGap =
            gap;

          bestCenterGap =
            centerGap;
        }
      }

      return best;
    };

    // V788T8B_NAV_STATION_RIGHT_TO_PROGRAM
    const stationByRow =
      new Map<number, any>();

    for (
      const stationEntry of
        v788t7StationFocusMapRef.current.values()
    ) {
      stationByRow.set(
        stationEntry.rowIndex,
        stationEntry
      );

      const candidates =
        byRow.get(stationEntry.rowIndex) || [];

      const currentTime = Date.now();

      const targetProgram =
        candidates.find(
          (candidate) =>
            candidate.start <= currentTime &&
            currentTime < candidate.end
        ) || candidates[0] || null;

      try {
        stationEntry.ref?.setNativeProps({
          nextFocusRight:
            targetProgram?.tag ||
            stationEntry.tag ||
            undefined,
        });
      } catch (_) {}
    }

    for (const entry of entries) {
      const up =
        pickTarget(
          entry,
          entry.rowIndex - 1
        );

      const down =
        pickTarget(
          entry,
          entry.rowIndex + 1
        );

      // V788T8B_NAV_EXPLICIT_PROGRAM_HORIZONTAL
      const rowEntries =
        byRow.get(entry.rowIndex) || [];

      const rowPosition =
        rowEntries.findIndex(
          (candidate) =>
            candidate.key === entry.key
        );

      const left =
        rowPosition > 0
          ? rowEntries[rowPosition - 1]
          : null;

      const right =
        rowPosition >= 0 &&
        rowPosition < rowEntries.length - 1
          ? rowEntries[rowPosition + 1]
          : null;

      const station =
        stationByRow.get(entry.rowIndex);

      const selfTag =
        entry.tag || undefined;

      const leftTag =
        left?.tag ||
        station?.tag ||
        selfTag;

      // V788T5A_RIGHT_EDGE_FOCUS_TRAP
      const rightTag =
        right?.tag || selfTag;

      try {
        entry.ref?.setNativeProps({
          // V788T8B_NAV_VERTICAL_SELF_TRAP
          nextFocusUp:
            up?.tag || selfTag,

          nextFocusDown:
            down?.tag || selfTag,

          nextFocusLeft:
            leftTag,

          nextFocusRight:
            rightTag,
        });
      } catch (_) {}
    }
  }, []);

  const v788nScheduleProgramFocusWire =
    useCallback(() => {
      if (
        v788nFocusWireTimerRef.current != null
      ) {
        clearTimeout(
          v788nFocusWireTimerRef.current
        );
      }

      v788nFocusWireTimerRef.current =
        setTimeout(() => {
          v788nFocusWireTimerRef.current =
            null;

          v788nWireProgramFocus();
        }, 0);
    }, [v788nWireProgramFocus]);

  const v788nRegisterProgramFocus =
    useCallback(
      (
        key: string,
        rowIndex: number,
        start: number,
        end: number,
        node: any
      ) => {
        const registry =
          v788nProgramFocusMapRef.current;

        if (!node) {
          const priorPending =
            v788t6PendingUnregisterRef.current.get(
              key
            );

          if (priorPending != null) {
            clearTimeout(priorPending);
          }

          const pending =
            setTimeout(() => {
              v788t6PendingUnregisterRef.current.delete(
                key
              );

              const removed =
                registry.delete(key);

              if (removed) {
                v788nScheduleProgramFocusWire();
              }
            }, 0);

          v788t6PendingUnregisterRef.current.set(
            key,
            pending
          );

          return;
        }

        const pendingUnregister =
          v788t6PendingUnregisterRef.current.get(
            key
          );

        if (pendingUnregister != null) {
          clearTimeout(pendingUnregister);
          v788t6PendingUnregisterRef.current.delete(
            key
          );
        }

        let tag = 0;

        try {
          tag =
            Number(
              findNodeHandle(node) || 0
            );
        } catch (_) {
          tag = 0;
        }

        if (!tag) {
          return;
        }

        const previousEntry =
          registry.get(key);

        const unchanged =
          previousEntry != null &&
          previousEntry.rowIndex === rowIndex &&
          previousEntry.start === start &&
          previousEntry.end === end &&
          previousEntry.tag === tag;

        registry.set(
          key,
          {
            key,
            rowIndex,
            start,
            end,
            tag,
            ref: node,
          }
        );

        if (!unchanged) {
          v788nScheduleProgramFocusWire();
        }
      },
      [v788nScheduleProgramFocusWire]
    );

  useEffect(() => {
    return () => {
      if (
        v788nFocusWireTimerRef.current != null
      ) {
        clearTimeout(
          v788nFocusWireTimerRef.current
        );
      }

      for (
        const pending of
          v788t6PendingUnregisterRef.current.values()
      ) {
        clearTimeout(pending);
      }

      v788t6PendingUnregisterRef.current.clear();
      v788nProgramFocusMapRef.current.clear();
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#B8A05C" />
        <Text style={styles.loadingText}>Loading TV guide...</Text>
      </View>
    );
  }

  if (!channels.length) {
    return (
      <View style={styles.center}>
        <Ionicons name="tv-outline" size={64} color="#B8A05C" />
        <Text style={styles.emptyTitle}>No TV channels installed</Text>
        <Text style={styles.emptyText}>
          Install a TV addon from Addons using its manifest link or share code.
        </Text>
      </View>
    );
  }

  const nowX = ((now - timelineStart) / SLOT_MS) * SLOT_WIDTH;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Live TV</Text>

      {/* V788T6B_PINNED_GUIDE_HEADER */}
      <View style={styles.guideHeader}>
        <View
          style={[
            styles.stationHeader,
            { width: CHANNEL_WIDTH },
          ]}
        >
          <Text style={styles.stationHeaderText}>
            CHANNEL
          </Text>

          <Text style={styles.stationHeaderClock}>
            {timeLabel(now)}
          </Text>
        </View>

        <ScrollView
          ref={timelineHeaderRef}
          horizontal
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          style={{
            width: Math.max(
              0,
              width - CHANNEL_WIDTH - 48
            ),
          }}
        >
          <View
            style={[
              styles.timelineHeader,
              { width: guideWidth },
            ]}
          >
            {Array.from({
              length: SLOT_COUNT,
            }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.timeSlot,
                  { width: SLOT_WIDTH },
                ]}
              >
                <Text style={styles.timeText}>
                  {timeLabel(
                    timelineStart +
                      i * SLOT_MS
                  )}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* V788T8P_WHOLE_ROW_NATIVE_GUIDE */}
      <PrivastreamLiveTVGuide
        style={styles.vertical}
        items={v788t8pGuideItems}
        rowHeight={ROW_HEIGHT}
        channelWidth={CHANNEL_WIDTH}
        slotWidth={SLOT_WIDTH}
        slotCount={SLOT_COUNT}
        slotMs={SLOT_MS}
        timelineStartMs={timelineStart}
        nowMs={now}
        preferredFocusIndex={preferredChannelIndex}
        focusRestoreRequest={
          v788t8vFocusRestoreSerial > 0
            ? `${preferredChannelIndex}:${v788t8vFocusRestoreSerial}`
            : ''
        }
        onHorizontalScroll={(event: any) => {
          const x = Math.max(
            0,
            Number(
              event?.nativeEvent?.offset || 0
            )
          );

          timelineHeaderRef.current?.scrollTo({
            x,
            animated: false,
          });
        }}
        onItemFocus={(event: any) => {
          const index = Number(
            event?.nativeEvent?.index
          );

          if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >= channels.length
          ) {
            return;
          }

          const channel = channels[index];
          const zone = String(
            event?.nativeEvent?.zone || 'station'
          );

          v788qPreferredFocusArmedRef.current =
            false;

          // V788T8X_DOUBLE_LEFT_STABLE_ARM
          // A native re-report of the same logical focus must not
          // erase the first LEFT before the second LEFT arrives.
          const previousRow =
            v788t8cFocusedRowRef.current;
          const previousArea =
            v788t8cFocusAreaRef.current;

          const logicalFocusChanged =
            previousRow !== index ||
            previousArea !== zone;

          v788t8cFocusedRowRef.current = index;

          if (logicalFocusChanged) {
            v788t8cFirstLeftRef.current = 0;
            v788t8cRawLeftRef.current = 0;
          }

          if (zone === 'program') {
            v788t8cFocusAreaRef.current = 'program';
            v788pClearStationLongPress();

            const anchor = Number(
              event?.nativeEvent?.anchorMs
            );

            if (Number.isFinite(anchor)) {
              v788sProgramAnchorRef.current =
                anchor;
            }

            v788sLastProgramRowRef.current =
              index;
          } else {
            v788t8cFocusAreaRef.current = 'station';

            v788sProgramAnchorRef.current = null;
            v788sLastProgramRowRef.current = null;

            v788pFocusedStationKeyRef.current =
              channel.key;

            v788pStationLongPressRef.current =
              () => {
                const toggle =
                  v788pToggleFavoriteRef.current;

                if (toggle) {
                  void toggle(channel);
                }
              };

            try {
              v176iRegisterGetter(
                () =>
                  v788pStationLongPressRef.current
              );
            } catch (_) {}
          }

          console.log(
            '[V788T8P NATIVE GUIDE FOCUS] row=' +
              index +
              ' zone=' + zone +
              ' channel=' +
              String(
                channel.item.imdb_id ||
                channel.item.id ||
                channel.name ||
                ''
              )
          );
        }}
        onItemPress={(event: any) => {
          const index = Number(
            event?.nativeEvent?.index
          );

          if (
            Number.isInteger(index) &&
            index >= 0 &&
            index < channels.length
          ) {
            void openChannel(
              channels[index]
            );
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0c0c',
    paddingHorizontal: 24,
    paddingTop: 18,
  },
  vertical: {
    flex: 1,
    overflow: 'hidden',
  },
  verticalContent: { paddingBottom: 36 },
  center: {
    flex: 1,
    backgroundColor: '#0c0c0c',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
  },
  title: {
  color: '#B8A05C',
  fontSize: 30,
  fontWeight: '700',
  marginBottom: 14,
},
  loadingText: { color: '#B8A05C', marginTop: 14 },
  emptyTitle: {
    color: '#B8A05C',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 18,
  },
  emptyText: {
    color: '#B8A05C',
    fontSize: 16,
    marginTop: 8,
    textAlign: 'center',
  },
  guideHeader: {
    flexDirection: 'row',
    backgroundColor: '#151515',
  },
  guide: { flexDirection: 'row', flex: 1 },
  stationHeader: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: '#151515',
    borderRightWidth: 1,
    borderColor: '#333',
  },
  stationHeaderText: {
    color: '#999',
    fontSize: 13,
    fontWeight: '700',
  },
  stationHeaderClock: {
    color: '#B8A05C',
    fontSize: 13,
    fontWeight: '700',
  },
  stationRow: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    backgroundColor: '#151515',
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderColor: '#292929',
  },
  stationMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },

  stationBookmarkBadge: {
  backgroundColor: '#B8A05C',
  borderRadius: 4,
  padding: 4,
  marginLeft: 8,
  alignItems: 'center',
  justifyContent: 'center',
},
focused: {
  borderColor: '#B8A05C',
    backgroundColor: 'rgba(184,160,92,0.14)',
  },
  logoBox: {
  width: 84,
  height: 48,
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: 8,
},
  logo: {
  width: 80,
  height: 44,
},
  stationText: { flex: 1 },
  stationName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  timelineHeader: {
    position: 'relative',
    height: 42,
    flexDirection: 'row',
    backgroundColor: '#151515',
  },
  timeSlot: {
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRightWidth: 1,
    borderColor: '#333',
  },
  timeText: {
    color: '#bbb',
    fontSize: 13,
    fontWeight: '700',
  },
  programRow: {
    position: 'relative',
    height: ROW_HEIGHT,
    borderTopWidth: 1,
    borderColor: '#292929',
    backgroundColor: '#111',
  },
  program: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#1c1c1c',
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  currentProgram: {
    backgroundColor: 'rgba(184,160,92,0.20)',
  },
  focusedProgram: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184,160,92,0.30)',
  },
  programTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  programTitleNarrow: {
    fontSize: 12,
    lineHeight: 14,
  },
  noGuide: {
    height: ROW_HEIGHT - 8,
    marginTop: 4,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  noGuideText: {
    color: '#666',
    fontSize: 14,
  },
});