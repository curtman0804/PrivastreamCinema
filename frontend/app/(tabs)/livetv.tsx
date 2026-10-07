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
import PrivastreamCategoryRow from '../../src/components/PrivastreamCategoryRow';
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

type V789gCategoryKey =
  | 'favorites'
  | 'us'
  | 'news'
  | 'sports'
  | 'movies'
  | 'entertainment'
  | 'kids'
  | 'crime'
  | 'reality'
  | 'comedy'
  | 'lifestyle'
  | 'documentary'
  | 'music'
  | 'anime'
  | 'spanish'
  | 'portuguese'
  | 'german'
  | 'french'
  | 'italian'
  | 'danish'
  | 'swedish'
  | 'norwegian'
  | 'finnish'
  | 'all';

type V789gCategoryDef = {
  key: V789gCategoryKey;
  label: string;
};

const V789G_CHANNEL_META: any =
  require('../../src/data/liveTvChannelMeta.json');

const V789G_CATEGORY_DEFS: V789gCategoryDef[] = [
  { key: 'favorites', label: 'Favorites' },
  { key: 'us', label: 'US Channels' },
  { key: 'news', label: 'News' },
  { key: 'sports', label: 'Sports' },
  { key: 'movies', label: 'Movies' },
  { key: 'entertainment', label: 'Entertainment' },
  { key: 'kids', label: 'Kids' },
  { key: 'crime', label: 'Crime' },
  { key: 'reality', label: 'Reality' },
  { key: 'comedy', label: 'Comedy' },
  { key: 'lifestyle', label: 'Lifestyle' },
  { key: 'documentary', label: 'Documentary' },
  { key: 'music', label: 'Music' },
  { key: 'anime', label: 'Anime' },
  { key: 'spanish', label: 'Spanish' },
  { key: 'portuguese', label: 'Portuguese' },
  { key: 'german', label: 'German' },
  { key: 'french', label: 'French' },
  { key: 'italian', label: 'Italian' },
  { key: 'danish', label: 'Danish' },
  { key: 'swedish', label: 'Swedish' },
  { key: 'norwegian', label: 'Norwegian' },
  { key: 'finnish', label: 'Finnish' },
  { key: 'all', label: 'All Channels' },
];

const V789G_SPANISH_REGIONS =
  new Set([
    'es',
    'mx',
    'ar',
    'co',
    'cr',
    'pe',
    've',
    'cl',
    'bo',
    'sv',
    'gt',
    'hn',
    'ni',
    'pa',
    'uy',
    'ec',
    'py',
    'do',
  ]);

const v789gNormalize = (value: any) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const v789gFavoriteId = (
  channel: GuideChannel
) =>
  String(
    channel.item.imdb_id ||
      channel.item.id ||
      ''
  ).trim();

const v789gMetadataId = (
  channel: GuideChannel
) =>
  String(
    channel.item.id ||
      channel.item.imdb_id ||
      ''
  ).trim();

const v789gGenres = (
  channel: GuideChannel
) => {
  const item: any =
    channel.item as any;

  return [
    item?.genre,
    ...(Array.isArray(item?.genres)
      ? item.genres
      : []),
  ]
    .map(v789gNormalize)
    .filter(Boolean);
};

const v789gPlutoMeta = (
  channel: GuideChannel
) => {
  if (
    String(
      channel.addonId || ''
    ).trim() !== 'org.plutotv'
  ) {
    return null;
  }

  return (
    V789G_CHANNEL_META?.pluto?.[
      v789gMetadataId(channel)
    ] || null
  );
};

const v789gRegions = (
  channel: GuideChannel
) =>
  (
    Array.isArray(
      v789gPlutoMeta(channel)
        ?.regions
    )
      ? v789gPlutoMeta(channel)
          .regions
      : []
  )
    .map(v789gNormalize)
    .filter(Boolean);

const v789gCategories = (
  channel: GuideChannel
) =>
  (
    Array.isArray(
      v789gPlutoMeta(channel)
        ?.categories
    )
      ? v789gPlutoMeta(channel)
          .categories
      : []
  )
    .map(v789gNormalize)
    .filter(Boolean);

const v789gAllRegionsWithin = (
  regions: string[],
  allowed: Set<string>
) =>
  regions.length > 0 &&
  regions.every((region) =>
    allowed.has(region)
  );

const v789gLanguageBucket = (
  channel: GuideChannel
): V789gCategoryKey | null => {
  const genres =
    v789gGenres(channel);

  const regions =
    v789gRegions(channel);

  const categories =
    v789gCategories(channel);

  if (
    genres.includes('latino') ||
    categories.includes(
      'en espanol'
    ) ||
    v789gAllRegionsWithin(
      regions,
      V789G_SPANISH_REGIONS
    )
  ) {
    return 'spanish';
  }

  if (
    v789gAllRegionsWithin(
      regions,
      new Set(['br'])
    )
  ) {
    return 'portuguese';
  }

  if (
    v789gAllRegionsWithin(
      regions,
      new Set(['de', 'at'])
    )
  ) {
    return 'german';
  }

  if (
    v789gAllRegionsWithin(
      regions,
      new Set(['fr'])
    )
  ) {
    return 'french';
  }

  if (
    v789gAllRegionsWithin(
      regions,
      new Set(['it'])
    )
  ) {
    return 'italian';
  }

  if (
    v789gAllRegionsWithin(
      regions,
      new Set(['dk'])
    )
  ) {
    return 'danish';
  }

  if (
    v789gAllRegionsWithin(
      regions,
      new Set(['se'])
    )
  ) {
    return 'swedish';
  }

  if (
    v789gAllRegionsWithin(
      regions,
      new Set(['no'])
    )
  ) {
    return 'norwegian';
  }

  if (
    v789gAllRegionsWithin(
      regions,
      new Set(['fi'])
    )
  ) {
    return 'finnish';
  }

  return null;
};

const v789gMatchesCategory = (
  channel: GuideChannel,
  category: V789gCategoryKey,
  isFavorite: (
    id: string
  ) => boolean
) => {
  if (category === 'all') {
    return true;
  }

  const favoriteId =
    v789gFavoriteId(channel);

  if (category === 'favorites') {
    return (
      !!favoriteId &&
      isFavorite(favoriteId)
    );
  }

  const addonId =
    String(
      channel.addonId || ''
    ).trim();

  const genres =
    v789gGenres(channel);

  const regions =
    v789gRegions(channel);

  const categories =
    v789gCategories(channel);

  const hasGenre = (
    ...values: string[]
  ) =>
    values.some((value) =>
      genres.includes(value)
    );

  const hasCategory = (
    ...values: string[]
  ) =>
    values.some((value) =>
      categories.includes(value)
    );

  if (category === 'us') {
    return (
      addonId ===
        'community.usa-tv-next' ||
      regions.includes('us')
    );
  }

  if (category === 'news') {
    return (
      hasGenre('news') ||
      hasCategory(
        'news',
        'news + opinion',
        'local news'
      )
    );
  }

  if (category === 'sports') {
    return (
      hasGenre('sports') ||
      hasCategory('sports')
    );
  }

  if (category === 'movies') {
    return hasCategory('movies');
  }

  if (
    category === 'entertainment'
  ) {
    return (
      hasGenre(
        'entertainment',
        'premium'
      ) ||
      hasCategory(
        'entertainment',
        'drama',
        'classic tv',
        'daytime + game shows'
      )
    );
  }

  if (category === 'kids') {
    return (
      hasGenre('kids') ||
      hasCategory('kids')
    );
  }

  if (category === 'crime') {
    return hasCategory(
      'true crime'
    );
  }

  if (category === 'reality') {
    return hasCategory(
      'reality',
      'competition reality'
    );
  }

  if (category === 'comedy') {
    return hasCategory('comedy');
  }

  if (category === 'lifestyle') {
    return (
      hasGenre('lifestyle') ||
      hasCategory(
        'home + food',
        'animals + nature'
      )
    );
  }

  if (
    category === 'documentary'
  ) {
    return (
      hasGenre('documentaries') ||
      hasCategory(
        'history + science',
        'documentary + science'
      )
    );
  }

  if (category === 'music') {
    return (
      hasGenre('music') ||
      hasCategory('music videos')
    );
  }

  if (category === 'anime') {
    return hasCategory('anime');
  }

  return (
    v789gLanguageBucket(
      channel
    ) === category
  );
};

const v789gFilterChannels = (
  channels: GuideChannel[],
  category: V789gCategoryKey,
  isFavorite: (
    id: string
  ) => boolean
) =>
  channels.filter((channel) =>
    v789gMatchesCategory(
      channel,
      category,
      isFavorite
    )
  );
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

// V789S9_PROGRAM_TO_STATION_LEFT_GUARD
// Native guide focus reaches JS before useTVEventHandler receives the same
// LEFT key-up. Remember that one program -> station transition so the LEFT
// which merely returned to the channel column cannot arm the tray timer.
const v789s9ProgramToStationLeftRef = useRef(0);

// V789S10_ROW1_TO_ROW0_UP_GUARD
// Native guide focus reaches row 0 before useTVEventHandler receives the same
// UP key-up that moved row 1 -> row 0. Remember that transition so that one
// UP only lands on channel row 0. A later UP from row 0 may enter Categories.
const v789s10RowOneToZeroUpRef = useRef(0);

// V789K_SINGLE_VS_DOUBLE_LEFT
const v789kSingleLeftTimerRef =
  useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
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

    // V789M_EXPLICIT_CATEGORY_BOUNDARIES
    //
    // The category row owns its own focus while active.
    // DOWN deliberately returns to filtered guide row 0.
    // V789Q2_GLOBAL_CATEGORY_DOWN_OWNER
    //
    // Runtime proof on Google TV shows the global TV handler receives
    // category DOWN while the native category-item DOWN handler does not.
    // Use one owner only: select the actually-focused category and reuse
    // the existing category-select -> guide-row-0 transaction.
    if (
      type === 'down' &&
      v789hCategoryModeRef.current &&
      v789hCategoryFocusedIndexRef.current >= 0
    ) {
      const highlightedIndex =
        v789hCategoryFocusedIndexRef.current;

      const highlightedCategory =
        V789G_CATEGORY_DEFS[
          highlightedIndex
        ];

      // V789S9_DOWN_EXITS_ONLY
      //
      // Highlighting a category is not selection. DOWN must never mutate the
      // selected filter. It only exits Categories into the guide for the
      // category that was last committed with OK.
      console.log(
        '[V789S9 CATEGORY DOWN EXIT] ' +
          'highlighted=' +
          String(
            highlightedCategory?.key ||
            ''
          ) +
          ' selected=' +
          v789gCategory
      );

      v789mCategoryExitPendingRef.current =
        true;

      // Re-enter the currently selected guide at its first visible row.
      // For a just-selected/remounted guide that naturally resolves to row 0.
      setPreferredChannelIndex(
        -1
      );

      setV788t8vFocusRestoreRequest(
        (request) => ({
          index: -1,
          serial: request.serial + 1,
        })
      );

      return;
    }
    // UP from the first CHANNEL row enters the
    // category row on the currently-selected category.
    //
    // Normal native RecyclerView Up/Down remains untouched
    // for every other guide row.
    if (
      type === 'up' &&
      focusArea === 'station' &&
      row === 0
    ) {
      // V789S10_ROW1_TO_ROW0_UP_GUARD
      // The native guide reports row 0 before this same UP key-up reaches JS.
      // If row 1 -> row 0 just happened, this UP belongs to that move and must
      // not be reinterpreted as a second UP originating from row 0.
      const now = Date.now();
      const rowOneToZeroAt =
        v789s10RowOneToZeroUpRef.current;

      if (
        rowOneToZeroAt > 0 &&
        now - rowOneToZeroAt <= 350
      ) {
        v789s10RowOneToZeroUpRef.current = 0;

        console.log(
          '[V789S10 ROW1 TO ROW0 UP] stay-guide'
        );

        return;
      }

      v789s10RowOneToZeroUpRef.current = 0;

      const stationKey =
        v788pFocusedStationKeyRef.current;

      const channel =
        stationKey
          ? channels.find(
              (candidate) =>
                candidate.key ===
                stationKey
            )
          : undefined;

      console.log(
        '[V789M TOP ROW UP] ' +
          'channel=' +
          String(stationKey || '')
      );

      if (channel) {
        setTimeout(
          () =>
            v789gOpenCategoriesFromChannel(
              channel
            ),
          0
        );
      }

      return;
    }
    if (
      type === 'down' &&
      row != null &&
      row === v788t8cChannelCountRef.current - 1
    ) {
      setTimeout(v788t8cFocusTray, 0);
      return;
    }

    // V789K_SINGLE_VS_DOUBLE_LEFT
    if (
      focusArea === 'station' &&
      type === 'left'
    ) {
      const now = Date.now();

      // V789S9_PROGRAM_TO_STATION_LEFT_GUARD
      // onItemFocus reports station before this same LEFT reaches the JS TV
      // handler. Consume that one LEFT here instead of treating it as a new
      // station-column LEFT intended for tray/categories.
      const programReturnAt =
        v789s9ProgramToStationLeftRef.current;

      if (
        programReturnAt > 0 &&
        now - programReturnAt <= 500
      ) {
        v789s9ProgramToStationLeftRef.current =
          0;

        v788t8cFirstLeftRef.current =
          0;

        v788t8cRawLeftRef.current =
          0;

        if (
          v789kSingleLeftTimerRef.current
        ) {
          clearTimeout(
            v789kSingleLeftTimerRef.current
          );

          v789kSingleLeftTimerRef.current =
            null;
        }

        console.log(
          '[V789S9 PROGRAM RETURN LEFT CONSUMED]'
        );

        return;
      }

      v789s9ProgramToStationLeftRef.current =
        0;

      if (
        now -
          v788t8cRawLeftRef.current <
        100
      ) {
        return;
      }

      v788t8cRawLeftRef.current =
        now;

      const first =
        v788t8cFirstLeftRef.current;

      if (
        first > 0 &&
        now - first >= 100 &&
        now - first <= 400
      ) {
        if (
          v789kSingleLeftTimerRef.current
        ) {
          clearTimeout(
            v789kSingleLeftTimerRef.current
          );

          v789kSingleLeftTimerRef.current =
            null;
        }

        v788t8cFirstLeftRef.current =
          0;

        v788t8cRawLeftRef.current =
          0;

        const stationKey =
          v788pFocusedStationKeyRef.current;

        const channel =
          stationKey
            ? channels.find(
                (candidate) =>
                  candidate.key ===
                  stationKey
              )
            : undefined;

        console.log(
          '[V789K DOUBLE LEFT] ' +
            'category rail ' +
            String(stationKey || '')
        );

        if (channel) {
          setTimeout(
            () =>
              v789gOpenCategoriesFromChannel(
                channel
              ),
            0
          );
        }

        return;
      }

      v788t8cFirstLeftRef.current =
        now;

      if (
        v789kSingleLeftTimerRef.current
      ) {
        clearTimeout(
          v789kSingleLeftTimerRef.current
        );
      }

      v789kSingleLeftTimerRef.current =
        setTimeout(
          () => {
            v789kSingleLeftTimerRef.current =
              null;

            v788t8cFirstLeftRef.current =
              0;

            v788t8cRawLeftRef.current =
              0;

            console.log(
              '[V789K SINGLE LEFT] tray'
            );

            v788t8cFocusTray();
          },
          400
        );

      return;
    }
    // V789K_CANCEL_PENDING_SINGLE_LEFT
    if (
      type !== 'left' &&
      v789kSingleLeftTimerRef.current
    ) {
      clearTimeout(
        v789kSingleLeftTimerRef.current
      );

      v789kSingleLeftTimerRef.current =
        null;
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
  const v788t10gRefreshResultRef = useRef<GuideChannel[] | null>(null);

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

  // W121ZPLAY10Y24Q_LIBRARY_CHANNEL_ID_ALIASES
  // The library API has used both channels[] and tv[] for
  // Live TV entries. Preserve every supported identity alias
  // instead of choosing only the first imdb_id/id value.
  const favoriteIds = useMemo(() => {
    const out = new Set<string>();

    const libraryChannels: any[] =
      ([] as any[]).concat(
        (library as any)?.channels || [],
        (library as any)?.tv || []
      );

    for (const item of libraryChannels) {
      const aliases = [
        item?.content_id,
        item?.imdb_id,
        item?.id,
      ];

      for (const raw of aliases) {
        const id = String(raw || '').trim();
        if (id) out.add(id);
      }
    }

    return out;
  }, [library]);

  // W121ZPLAY10Y24L_STABLE_FAVORITE_PREDICATE
  // Library/override changes must not invalidate the complete guide
  // filtering + program-map chain. Read current values through refs
  // while keeping v788t8xIsFavorite identity stable.
  const v788y24lFavoriteIdsRef = useRef(favoriteIds);
  v788y24lFavoriteIdsRef.current = favoriteIds;

  // V788T8X_REALTIME_BOOKMARK
  const [
    v788t8xFavoriteOverrides,
    setV788t8xFavoriteOverrides,
  ] = useState<Record<string, boolean>>({});

  const v788y24lFavoriteOverridesRef =
    useRef<Record<string, boolean>>(
      v788t8xFavoriteOverrides
    );

  v788y24lFavoriteOverridesRef.current =
    v788t8xFavoriteOverrides;

  // W121ZPLAY10Y23A_DIRECT_GUIDE_FAVORITE_REFS
  // Visible station stars are owned by the mounted whole-row native guide.
  const v788y23GuideRef = useRef<any>(null);
  const v788y23GuideItemsRef = useRef<any[]>([]);

  const v788t8xIsFavorite = useCallback(
    (id: string) => {
      const overrides =
        v788y24lFavoriteOverridesRef.current;

      if (
        Object.prototype.hasOwnProperty.call(
          overrides,
          id
        )
      ) {
        return overrides[id];
      }

      return v788y24lFavoriteIdsRef.current.has(id);
    },
    []
  );

  // V789G_R1_LIVE_TV_CATEGORY_STATE
  const [
    v789gCategory,
    setV789gCategory,
  ] =
    useState<V789gCategoryKey>(
      'us'
    );

  // V789H_EXPLICIT_CATEGORY_FOCUS
  const v789gCategoryScrollRef =
    useRef<ScrollView>(null);

  const v789hCategoryRefs =
    useRef<Array<any | null>>(
      []
    );

  const [
    v789hCategoryTags,
    setV789hCategoryTags,
  ] =
    useState<number[]>([]);

  const [
    v789hCategoryMode,
    setV789hCategoryMode,
  ] =
    useState(false);

  const v789hCategoryModeRef =
    useRef(false);

  const v789hCategoryFocusedIndexRef =
    useRef(-1);
  // V789M_R6_EXIT_PENDING
  // Keep categories alive until the native guide
  // positively confirms it owns focus.
  const v789mCategoryExitPendingRef =
    useRef(false);

  // V789N_NATIVE_CATEGORY_SWITCH
  const [
    v789nNativeCategoryPreferredIndex,
    setV789nNativeCategoryPreferredIndex,
  ] =
    useState(0);

  const [
    v789nNativeCategoryFocusSerial,
    setV789nNativeCategoryFocusSerial,
  ] =
    useState(0);
  // V789N_MEASURED_CATEGORY_VIEWPORT
  //
  // Category pills have different real widths.
  // Never infer horizontal geometry from category index.
  const v789nCategoryLayoutsRef =
    useRef<
      Array<
        {
          x: number;
          width: number;
        } | null
      >
    >([]);

  const v789nCategoryScrollXRef =
    useRef(0);

  const v789nCategoryViewportWidthRef =
    useRef(0);

  // V789N_ENSURE_CATEGORY_VISIBLE
  const v789nEnsureCategoryVisible =
    useCallback(
      (
        index: number,
        animated = false
      ) => {
        const layout =
          v789nCategoryLayoutsRef
            .current[index];

        const viewportWidth =
          v789nCategoryViewportWidthRef
            .current;

        if (
          !layout ||
          viewportWidth <= 0
        ) {
          return;
        }

        const currentX =
          v789nCategoryScrollXRef
            .current;

        const margin = 28;

        const leftEdge =
          currentX + margin;

        const rightEdge =
          currentX +
          viewportWidth -
          margin;

        const itemLeft =
          layout.x;

        const itemRight =
          layout.x +
          layout.width;

        let targetX =
          currentX;

        if (
          itemLeft < leftEdge
        ) {
          targetX =
            Math.max(
              0,
              itemLeft - margin
            );
        }
        else if (
          itemRight > rightEdge
        ) {
          targetX =
            Math.max(
              0,
              itemRight -
                viewportWidth +
                margin
            );
        }

        if (
          Math.abs(
            targetX - currentX
          ) < 2
        ) {
          return;
        }

        console.log(
          '[V789N CATEGORY SCROLL] ' +
            'index=' +
            index +
            ' current=' +
            Math.round(currentX) +
            ' target=' +
            Math.round(targetX) +
            ' x=' +
            Math.round(layout.x) +
            ' width=' +
            Math.round(layout.width)
        );

        v789nCategoryScrollXRef
          .current =
          targetX;

        v789gCategoryScrollRef
          .current?.scrollTo({
            x: targetX,
            animated,
          });
      },
      []
    );
  const v789hRegisterCategoryRef =
    useCallback(
      (
        index: number,
        node: any
      ) => {
        v789hCategoryRefs.current[
          index
        ] = node;

        if (!node) {
          return;
        }

        let tag = 0;

        try {
          tag =
            Number(
              findNodeHandle(node) ||
                0
            );
        } catch (_) {
          tag = 0;
        }

        if (tag <= 0) {
          return;
        }

        setV789hCategoryTags(
          (previous) => {
            if (
              previous[index] ===
              tag
            ) {
              return previous;
            }

            const next =
              previous.slice();

            next[index] = tag;

            return next;
          }
        );
      },
      []
    );

  const [
    v789gFavoriteActionChannel,
    setV789gFavoriteActionChannel,
  ] =
    useState<GuideChannel | null>(
      null
    );

  // W121ZPLAY10Y24L_FAVORITES_STRUCTURE_TOKEN
  // Outside Favorites, bookmark-state changes must not rebuild
  // the full visible guide. Inside Favorites, preserve immediate
  // add/remove membership behavior.
  const v788y24lFavoritesStructureToken =
    v789gCategory === 'favorites'
      ? v788t8xFavoriteOverrides
      : null;

  const v789gVisibleChannels =
    useMemo(
      () =>
        v789gFilterChannels(
          channels,
          v789gCategory,
          v788t8xIsFavorite
        ),
      [
        channels,
        v789gCategory,
        v788t8xIsFavorite,
        v788y24lFavoritesStructureToken,
      ]
    );

  // W121ZSY3_VISIBLE_IDENTITY_DOMAIN
  //
  // LiveTvNav and the native guide must resolve rows against
  // the same filtered channel domain the user actually sees.
  // Refs let the focus-return callback read current state
  // without turning category/favorite changes into focus-effect
  // re-subscriptions.
  const v789gVisibleChannelsRef =
    useRef(v789gVisibleChannels);

  v789gVisibleChannelsRef.current =
    v789gVisibleChannels;

  const v789gCategoryRef =
    useRef(v789gCategory);

  v789gCategoryRef.current =
    v789gCategory;

  const v788t8xIsFavoriteRef =
    useRef(v788t8xIsFavorite);

  v788t8xIsFavoriteRef.current =
    v788t8xIsFavorite;

  // V789S16E_HIDE_EMPTY_LIVE_TV_CATEGORIES
  // W121ZPLAY10Y13A_PIN_FAVORITES_FIRST
  //
  // Favorites stays visible at index 0 even when empty so long-press can add the first station.
  // Other categories still require at least one playable row.
  const v789gVisibleCategoryDefs =
    useMemo(
      () =>
        V789G_CATEGORY_DEFS.filter(
          (category) =>
            category.key === 'favorites' ||
            v789gFilterChannels(
              channels,
              category.key,
              v788t8xIsFavorite
            ).length > 0
        ),
      [
        channels,
        v788t8xIsFavorite,
      ]
    );

  // Native focus callbacks can outlive a render. Keep their category
  // index mapping tied to the same visible list the user actually sees.
  const v789gVisibleCategoryDefsRef =
    useRef(v789gVisibleCategoryDefs);

  v789gVisibleCategoryDefsRef.current =
    v789gVisibleCategoryDefs;

  // W121ZPLAY10Y19A_START_CATEGORY_FROM_FAVORITES
  //
  // Startup rule:
  //   Favorites contains >=1 saved station -> Favorites
  //   Favorites contains zero stations     -> US Channels
  //
  // Wait for both channel inventory and persisted library state.
  // Resolve exactly once per mounted Live TV screen.
  const v789y19StartupCategoryResolvedRef =
    useRef(false);

  useEffect(() => {
    if (
      v789y19StartupCategoryResolvedRef.current ||
      channels.length <= 0 ||
      library === null
    ) {
      return;
    }

    const hasFavorites =
      v789gFilterChannels(
        channels,
        'favorites',
        v788t8xIsFavorite
      ).length > 0;

    const startupCategory: V789gCategoryKey =
      hasFavorites
        ? 'favorites'
        : 'us';

    v789y19StartupCategoryResolvedRef.current =
      true;

    setV789gCategory(
      startupCategory
    );

    const startupIndex =
      v789gVisibleCategoryDefs.findIndex(
        (entry) =>
          entry.key === startupCategory
      );

    setV789nNativeCategoryPreferredIndex(
      Math.max(
        0,
        startupIndex
      )
    );

    console.log(
      '[W121ZPLAY10Y19A START CATEGORY] ' +
        'favorites=' +
        String(hasFavorites) +
        ' category=' +
        startupCategory +
        ' index=' +
        String(startupIndex)
    );
  }, [
    channels,
    library,
    v788t8xIsFavorite,
    v789gVisibleCategoryDefs,
  ]);

  // After startup only: if the selected category genuinely
  // disappears, prefer US Channels instead of blindly using
  // category index zero.
  useEffect(() => {
    if (
      !v789y19StartupCategoryResolvedRef.current ||
      v789gVisibleCategoryDefs.length <= 0 ||
      v789gVisibleCategoryDefs.some(
        (entry) =>
          entry.key === v789gCategory
      )
    ) {
      return;
    }

    const fallbackCategory: V789gCategoryKey =
      v789gVisibleCategoryDefs.some(
        (entry) =>
          entry.key === 'us'
      )
        ? 'us'
        : v789gVisibleCategoryDefs[0].key;

    setV789gCategory(
      fallbackCategory
    );

    const fallbackIndex =
      v789gVisibleCategoryDefs.findIndex(
        (entry) =>
          entry.key === fallbackCategory
      );

    setV789nNativeCategoryPreferredIndex(
      Math.max(
        0,
        fallbackIndex
      )
    );
  }, [
    v789gCategory,
    v789gVisibleCategoryDefs,
  ]);
  // Existing native guide event
  // dispatcher reads this ref.
  // Keep it synchronized with
  // the filtered guide row count.
  v788t8cChannelCountRef.current =
    v789gVisibleChannels.length;

  // V789N_NATIVE_CATEGORY_ENTRY
  const v789gOpenCategoriesFromChannel =
    useCallback(
      (channel: GuideChannel) => {
        setV789gFavoriteActionChannel(
          channel
        );

        // V789S9_CATEGORY_ENTRY_CANCELS_STALE_LEFT
        // Never allow a previously armed single-LEFT tray timer to fire after
        // Categories has legitimately taken focus.
        if (
          v789kSingleLeftTimerRef.current
        ) {
          clearTimeout(
            v789kSingleLeftTimerRef.current
          );

          v789kSingleLeftTimerRef.current =
            null;
        }

        v788t8cFirstLeftRef.current =
          0;

        v788t8cRawLeftRef.current =
          0;

        v789s9ProgramToStationLeftRef.current =
          0;

        v789hCategoryFocusedIndexRef
          .current = -1;

        v789mCategoryExitPendingRef.current =
          false;

        // V789S9_CATEGORY_OWNS_FOCUS
        // While Categories is active, a category change may remount/update the
        // native guide underneath it. Put the guide's preferred focus in the
        // existing -1 sentinel state and clear any old restore request so that
        // those data changes cannot steal Android focus from Categories.
        setPreferredChannelIndex(
          -1
        );

        setV788t8vFocusRestoreRequest({
          index: -1,
          serial: 0,
        });

        const selectedIndex =
          Math.max(
            0,
            v789gVisibleCategoryDefsRef.current.findIndex(
              (entry) =>
                entry.key ===
                v789gCategory
            )
          );

        console.log(
          '[V789N NATIVE CATEGORY ENTER] ' +
            'channel=' +
            channel.key +
            ' category=' +
            v789gCategory +
            ' index=' +
            selectedIndex
        );

        setV789nNativeCategoryPreferredIndex(
          selectedIndex
        );

        v789hCategoryModeRef.current =
          true;

        setV789hCategoryMode(
          true
        );

        setV789nNativeCategoryFocusSerial(
          (value) => value + 1
        );
      },
      [
        v789gCategory,
        v789gVisibleCategoryDefs,
      ]
    );

  // V789S9_CATEGORY_SELECT_STAYS_ON_RAIL
  const v789gSelectCategory =
    useCallback(
      (
        category:
          V789gCategoryKey
      ) => {
        // OK means SELECT only. It updates the committed filter but Categories
        // remains the Android focus owner until the user explicitly presses DOWN.
        v789hCategoryModeRef.current =
          true;

        setV789hCategoryMode(
          true
        );

        v789mCategoryExitPendingRef.current =
          false;

        if (
          category ===
          v789gCategory
        ) {
          console.log(
            '[V789S9 CATEGORY SELECT STAY] ' +
              'key=' +
              category +
              ' changed=false'
          );

          return;
        }

        setV789gCategory(
          category
        );

        console.log(
          '[V789S9 CATEGORY SELECT STAY] ' +
            'key=' +
            category +
            ' changed=true'
        );
      },
      [
        v789gCategory,
        v789gVisibleCategoryDefs,
      ]
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

      // V788T12K_PARALLEL_EPG_INVENTORY
      //
      // Run the complete provider-neutral playable-channel inventory
      // concurrently with Discover + EPG.
      //
      // Nothing is rendered to the guide until ALL work reaches the
      // final barrier and one stable dataset is committed.

      const v788t12kInventoryPromise =
        (async () => {
          let sourceIndex = 0;
          let skip = 0;
          let completed = false;

          let pageCount = 0;
          let scannedTotal = 0;
          let playableTotal = 0;
          let deviceCheckTotal = 0;
          let emptyTotal = 0;
          let unknownTotal = 0;

          const rawPlayable: any[] = [];
          const rawDeviceCheck: any[] = [];

          const visitedCursors =
            new Set<string>();

          console.log(
            '[V788T12K LIVE INVENTORY] parallel start',
            'generation=' + generation
          );

          while (
            generation ===
            loadGenerationRef.current
          ) {
            const cursor =
              `${sourceIndex}:${skip}`;

            if (visitedCursors.has(cursor)) {
              throw new Error(
                '[V788T12K LIVE INVENTORY] repeated cursor ' +
                  cursor
              );
            }

            visitedCursors.add(cursor);

            let page: any = null;
            let lastPageError: any = null;

            for (
              let pageAttempt = 1;
              pageAttempt <= 3;
              pageAttempt += 1
            ) {
              try {
                page =
                  await api.content.getLiveTvInventoryPage(
                    sourceIndex,
                    skip,
                    400
                  );

                lastPageError = null;
                break;
              } catch (error) {
                lastPageError = error;

                console.warn(
                  '[V788T12K LIVE INVENTORY] page retry',
                  'source=' + sourceIndex,
                  'skip=' + skip,
                  'attempt=' + pageAttempt,
                  error
                );

                if (pageAttempt < 3) {
                  await new Promise<void>(
                    (resolve) =>
                      setTimeout(
                        resolve,
                        500 * pageAttempt
                      )
                  );
                }
              }
            }

            if (page == null) {
              throw (
                lastPageError ||
                new Error(
                  '[V788T12K LIVE INVENTORY] page unavailable'
                )
              );
            }

            if (
              generation !==
              loadGenerationRef.current
            ) {
              return {
                superseded: true,
                items: [] as any[],
                pageCount,
                scannedTotal,
                playableTotal,
                emptyTotal,
                unknownTotal,
              };
            }

            const pageItems =
              Array.isArray(page?.items)
                ? page.items
                : [];

            const pageDeviceCheckItems =
              Array.isArray(page?.deviceCheckItems)
                ? page.deviceCheckItems
                : [];

            rawPlayable.push(
              ...pageItems
            );

            rawDeviceCheck.push(
              ...pageDeviceCheckItems
            );

            pageCount += 1;

            scannedTotal +=
              Number(page?.scanned || 0);

            playableTotal +=
              Number(page?.playable || 0);

            deviceCheckTotal +=
              Number(page?.deviceCheck || 0);

            emptyTotal +=
              Number(page?.hiddenNoStream || 0);

            unknownTotal +=
              Number(page?.unknown || 0);

            console.log(
              '[V788T12K LIVE INVENTORY] page',
              'source=' + sourceIndex,
              'skip=' + skip,
              'scanned=' + String(page?.scanned ?? ''),
              'playable=' + String(page?.playable ?? ''),
              'empty=' + String(page?.hiddenNoStream ?? ''),
              'unknown=' + String(page?.unknown ?? ''),
              'received=' + pageItems.length,
              'done=' + String(Boolean(page?.done))
            );

            if (page?.done === true) {
              completed = true;

              console.log(
                '[V788T12K LIVE INVENTORY] natural exhaustion',
                'raw=' + rawPlayable.length,
                'pages=' + pageCount
              );

              break;
            }

            const nextSourceIndex =
              Number(page?.nextSourceIndex);

            const nextSkip =
              Number(page?.nextSkip);

            if (
              !Number.isInteger(nextSourceIndex) ||
              nextSourceIndex < 0 ||
              !Number.isInteger(nextSkip) ||
              nextSkip < 0
            ) {
              throw new Error(
                '[V788T12K LIVE INVENTORY] invalid cursor ' +
                  String(page?.nextSourceIndex) +
                  ':' +
                  String(page?.nextSkip)
              );
            }

            const nextCursor =
              `${nextSourceIndex}:${nextSkip}`;

            if (nextCursor === cursor) {
              throw new Error(
                '[V788T12K LIVE INVENTORY] no cursor progress ' +
                  cursor
              );
            }

            sourceIndex =
              nextSourceIndex;

            skip =
              nextSkip;

            await new Promise<void>(
              (resolve) =>
                setTimeout(
                  resolve,
                  40
                )
            );
          }

          if (
            generation !==
            loadGenerationRef.current
          ) {
            return {
              superseded: true,
              items: [] as any[],
              pageCount,
              scannedTotal,
              playableTotal,
              emptyTotal,
              unknownTotal,
            };
          }

          if (!completed) {
            throw new Error(
              '[V788T12K LIVE INVENTORY] did not reach natural exhaustion'
            );
          }

          return {
            superseded: false,
            items: rawPlayable,
            deviceCheckItems: rawDeviceCheck,
            pageCount,
            scannedTotal,
            playableTotal,
            deviceCheckTotal,
            emptyTotal,
            unknownTotal,
          };
        })();

      // W121ZOD49A_LIVE_TV_DISCOVER_BYPASS
      //
      // Live TV membership comes from the playable inventory.
      // EPG provides schedule/logo enrichment.
      // Discover must not block guide startup.
      const [
        epgResult,
        inventoryResult,
      ] = await Promise.allSettled([
        api.content.getLiveTvEpg(date),
        v788t12kInventoryPromise,
      ]);

      console.log(
        '[W121ZOD49A LIVE LOAD] guide barrier complete',
        'epg=' + epgResult.status,
        'inventory=' + inventoryResult.status
      );

      const epgById = new Map<string, any>();

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
          }
        }
      } else {
        console.warn('[V784J_EPG] unavailable', epgResult.reason);
      }

      // W121ZOD49A_NO_DISCOVER_ENRICHMENT
      //
      // Inventory + EPG already provide every field required by
      // the authoritative final merge below.
      const next: GuideChannel[] = [];

      // V788T16F_INVENTORY_OWNS_GUIDE_MEMBERSHIP
      //
      // EPG is enrichment only.
      //
      // A schedule provider must never create a Live TV row by itself.
      // Channel membership comes exclusively from the completed playable
      // inventory. If inventory removes a channel because its owning addon
      // has no usable stream, EPG cannot reinsert that channel.

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

      // V788T12K_PARALLEL_STABLE_GUIDE_COMMIT
      //
      // EPG and the COMPLETE playable inventory have now
      // reached the same barrier.
      //
      // Inventory controls visibility.
      // EPG enriches verified playable channels only.
      // Native guide receives ONE final stable array.

      if (
        generation !==
        loadGenerationRef.current
      ) {
        return;
      }

      if (
        inventoryResult.status !== 'fulfilled'
      ) {
        throw inventoryResult.reason;
      }

      const inventoryPayload =
        inventoryResult.value;

      if (inventoryPayload?.superseded) {
        return;
      }

      const backendPlayableItems =
        Array.isArray(inventoryPayload?.items)
          ? inventoryPayload.items
          : [];

      const deviceCheckItems =
        Array.isArray(
          inventoryPayload?.deviceCheckItems
        )
          ? inventoryPayload.deviceCheckItems
          : [];

      let v788t16jDevicePassedCount = 0;
      let v788t16jDeviceRejectedCount = 0;

      const v788t16jDevicePassedItems: any[] = [];

      if (deviceCheckItems.length > 0) {
        const candidateRows: any[] = [];

        for (const raw of deviceCheckItems) {
          const id =
            String(raw?.id || '').trim();

          const addonId =
            String(raw?.addonId || '').trim();

          if (!id || !addonId) {
            continue;
          }

          const identity =
            addonId + ':' + id;

          const streams =
            Array.isArray(
              raw?.deviceCheckStreams
            )
              ? raw.deviceCheckStreams
              : [];

          for (
            const stream of streams.slice(0, 4)
          ) {
            const url =
              String(stream?.url || '').trim();

            if (!url) continue;

            candidateRows.push({
              key: identity,
              url,
              headers:
                stream?.headers &&
                typeof stream.headers ===
                  'object'
                  ? stream.headers
                  : {},
            });
          }
        }

        try {
          const {
            probeLiveTvDeviceCandidates,
          } = require(
            '../../src/native/devicePlaybackCapabilities'
          );

          const probeResult =
            await probeLiveTvDeviceCandidates(
              candidateRows,
              2500
            );

          if (
            generation !==
            loadGenerationRef.current
          ) {
            return;
          }

          const playableKeys =
            new Set<string>(
              (
                Array.isArray(
                  probeResult?.playableKeys
                )
                  ? probeResult.playableKeys
                  : []
              ).map(
                (value: any) =>
                  String(value || '')
              )
            );

          for (const raw of deviceCheckItems) {
            const id =
              String(raw?.id || '').trim();

            const addonId =
              String(
                raw?.addonId || ''
              ).trim();

            const identity =
              addonId && id
                ? addonId + ':' + id
                : '';

            if (
              !identity ||
              !playableKeys.has(identity)
            ) {
              continue;
            }

            const clean = {
              ...(raw as any),
            };

            delete (
              clean as any
            ).deviceCheckStreams;

            v788t16jDevicePassedItems.push(
              clean
            );
          }

          v788t16jDevicePassedCount =
            v788t16jDevicePassedItems.length;

          v788t16jDeviceRejectedCount =
            Math.max(
              0,
              deviceCheckItems.length -
                v788t16jDevicePassedCount
            );

          console.log(
            '[V788T16J LIVE PREFLIGHT]',
            'pending=' +
              deviceCheckItems.length,
            'rows=' +
              candidateRows.length,
            'passed=' +
              v788t16jDevicePassedCount,
            'rejected=' +
              v788t16jDeviceRejectedCount
          );

        } catch (probeError) {
          // Strict pre-display contract:
          // if this device cannot prove an uncertain channel,
          // that channel never reaches the guide.
          v788t16jDeviceRejectedCount =
            deviceCheckItems.length;

          console.warn(
            '[V788T16J LIVE PREFLIGHT] failed closed',
            'pending=' +
              deviceCheckItems.length,
            probeError
          );
        }
      }

      const inventoryItems = [
        ...backendPlayableItems,
        ...v788t16jDevicePassedItems,
      ];

      const enrichmentByIdentity =
        new Map<string, GuideChannel>();

      for (const channel of next) {
        const enrichmentId =
          String(
            channel.item.imdb_id ||
            channel.item.id ||
            ''
          ).trim();

        const enrichmentAddonId =
          String(
            channel.addonId ||
            ''
          ).trim();

        if (
          !enrichmentId ||
          !enrichmentAddonId
        ) {
          continue;
        }

        const identity =
          `${enrichmentAddonId}:${enrichmentId}`;

        if (
          !enrichmentByIdentity.has(identity)
        ) {
          enrichmentByIdentity.set(
            identity,
            channel
          );
        }
      }

      const playableByIdentity =
        new Map<string, GuideChannel>();

      for (const raw of inventoryItems) {
        const id =
          String(
            (raw as any)?.imdb_id ||
            (raw as any)?.id ||
            ''
          ).trim();

        const addonId =
          String(
            (raw as any)?.addonId ||
            (raw as any)?._addon_id ||
            ''
          ).trim();

        if (!id || !addonId) {
          continue;
        }

        const identity =
          `${addonId}:${id}`;

        const existing =
          enrichmentByIdentity.get(identity);

        const epg =
          epgById.get(id);

        const stationLogo =
          String(
            epg?.logo ||
            (raw as any)?.logo ||
            existing?.logo ||
            ''
          ).trim();

        const name =
          String(
            (raw as any)?.name ||
            epg?.name ||
            existing?.name ||
            id
          );

        const programs =
          Array.isArray(epg?.programs)
            ? epg.programs
            : (
                Array.isArray(existing?.programs)
                  ? existing!.programs
                  : []
              );

        playableByIdentity.set(
          identity,
          {
            key:
              String(
                existing?.key ||
                identity
              ),

            item: {
              ...(existing?.item || {}),
              ...(raw as any),
              id,
              type: 'tv',
              name,
              poster: stationLogo,
            },

            name,
            logo: stationLogo,

            sourceName:
              String(
                (raw as any)?.sourceName ||
                existing?.sourceName ||
                ''
              ),

            addonId,
            programs,
          }
        );
      }

      const completedChannels =
        Array.from(
          playableByIdentity.values()
        );

      completedChannels.sort(
        (a, b) =>
          String(a.name || '').localeCompare(
            String(b.name || ''),
            undefined,
            {
              sensitivity: 'base',
              numeric: true,
            }
          )
      );

      v788t10gRefreshResultRef.current =
        completedChannels;

      setChannels(
        completedChannels
      );

      console.log(
        '[V788T12K LIVE INVENTORY] stable guide commit',
        'channels=' + completedChannels.length,
        'pages=' + String(inventoryPayload?.pageCount || 0),
        'scanned=' + String(inventoryPayload?.scannedTotal || 0),
        'playable=' + String(inventoryPayload?.playableTotal || 0),
        'deviceCheck=' + String(inventoryPayload?.deviceCheckTotal || 0),
        'devicePassed=' + String(v788t16jDevicePassedCount),
        'deviceRejected=' + String(v788t16jDeviceRejectedCount),
        'empty=' + String(inventoryPayload?.emptyTotal || 0),
        'unknown=' + String(inventoryPayload?.unknownTotal || 0)
      );

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

  // V788T12H_LOAD_ON_AUTHENTICATED_TAB_MOUNT
  //
  // Live TV is eagerly mounted by the tab navigator. Start one inventory
  // generation immediately so loading continues even if another tab is
  // currently selected. guideLoadInFlightRef prevents duplicate work.
  useEffect(() => {
    void loadGuide(false);
  }, [loadGuide]);

  // V788T8V_RETURN_FOCUS_HANDSHAKE
  //
  // W121ZSY26B_ATOMIC_FOCUS_RESTORE_REQUEST
  // Keep explicit restore target independent from
  // preferredFocusIndex.
  const [
    v788t8vFocusRestoreRequest,
    setV788t8vFocusRestoreRequest,
  ] = useState<{
    index: number;
    serial: number;
  }>({
    index: 0,
    serial: 0,
  });

  useFocusEffect(
    useCallback(() => {
      // V785L6B_LIVE_GUIDE_FOCUS_RETURN
      try {
        const {
          getLiveTvCurrent,
        } = require('../../src/liveTvNav');

        const current = getLiveTvCurrent();

        const restoreId = String(
          current?.entry?.id || ''
        ).trim();

        const restoreAddonId = String(
          current?.entry?.addonId || ''
        ).trim();

        const visibleChannels =
          v789gVisibleChannelsRef.current;

        const restoreIndex =
          restoreId && restoreAddonId
            ? visibleChannels.findIndex(
                (channel) => {
                  const id = String(
                    channel.item.imdb_id ||
                    channel.item.id ||
                    ''
                  ).trim();

                  const addonId = String(
                    channel.addonId || ''
                  ).trim();

                  return (
                    id === restoreId &&
                    addonId === restoreAddonId
                  );
                }
              )
            : -1;

        if (restoreIndex >= 0) {
          v788qPreferredFocusArmedRef.current =
            true;

          // W121ZSY26B_SINGLE_OWNER_PLAYBACK_RETURN
          //
          // Playback identity has already been resolved here.
          // Do not also mutate preferredChannelIndex because that
          // independently enters native setPreferredFocusIndex().
          // Playback return uses only the explicit restore request.
          setV788t8vFocusRestoreRequest(
            (request) => ({
              index: restoreIndex,
              serial: request.serial + 1,
            })
          );

          console.log(
            '[W121ZSY3 LIVE RETURN] identity restore',
            'index=' + restoreIndex,
            'id=' + restoreId,
            'addon=' + restoreAddonId,
            'visible=' + visibleChannels.length
          );
        } else if (current) {
          console.warn(
            '[W121ZSY3 LIVE RETURN] identity not visible',
            'id=' + restoreId,
            'addon=' + restoreAddonId,
            'storedIndex=' +
              String(current?.index ?? -1),
            'visible=' + visibleChannels.length
          );
        }
      } catch (error) {
        console.warn(
          '[V785L6B LIVE GUIDE] focus restore lookup failed',
          error
        );
      }

      let v788t10gSourcesDirty = false;

      try {
        const {
          consumeLiveTvSourcesDirty,
        } = require('../../src/liveTvNav');

        v788t10gSourcesDirty =
          consumeLiveTvSourcesDirty();
      } catch (error) {
        console.warn(
          '[V788T10G2 LIVE GUIDE] dirty-state lookup failed',
          error
        );
      }
      const ageMs =
        lastGuideLoadAtRef.current > 0
          ? Date.now() - lastGuideLoadAtRef.current
          : Number.POSITIVE_INFINITY;

      if (
        v788t10gSourcesDirty &&
        guideLoadedRef.current
      ) {
        let restoreId = '';
        let restoreAddonId = '';
        let fallbackIndex = 0;

        try {
          const {
            getLiveTvCurrent,
          } = require('../../src/liveTvNav');

          const current =
            getLiveTvCurrent();

          restoreId = String(
            current?.entry?.id || ''
          ).trim();

          restoreAddonId = String(
            current?.entry?.addonId || ''
          ).trim();

          const visibleBeforeRefresh =
            v789gVisibleChannelsRef.current;

          const visibleCurrentIndex =
            restoreId && restoreAddonId
              ? visibleBeforeRefresh.findIndex(
                  (channel) => {
                    const id = String(
                      channel.item.imdb_id ||
                      channel.item.id ||
                      ''
                    ).trim();

                    const addonId = String(
                      channel.addonId || ''
                    ).trim();

                    return (
                      id === restoreId &&
                      addonId === restoreAddonId
                    );
                  }
                )
              : -1;

          if (visibleCurrentIndex >= 0) {
            fallbackIndex =
              visibleCurrentIndex;
          }
        } catch (error) {
          console.warn(
            '[V788T10G2 LIVE GUIDE] pre-refresh focus capture failed',
            error
          );
        }

        console.log(
          '[V788T10G2 LIVE GUIDE] addon sources dirty - refresh on focus',
          'id=' + restoreId,
          'addon=' + restoreAddonId,
          'fallbackIndex=' + fallbackIndex
        );

        v788t10gRefreshResultRef.current = null;

        void (async () => {
          await Promise.all([
            loadGuide(true),
            fetchLibrary(true),
          ]);

          const refreshed =
            v788t10gRefreshResultRef.current;

          if (!Array.isArray(refreshed)) {
            try {
              const {
                markLiveTvSourcesDirty,
              } = require('../../src/liveTvNav');

              markLiveTvSourcesDirty();
            } catch (_) {}

            console.warn(
              '[V788T10G2 LIVE GUIDE] refresh did not commit - dirty flag restored'
            );

            return;
          }

          const refreshedVisible =
            v789gFilterChannels(
              refreshed,
              v789gCategoryRef.current,
              v788t8xIsFavoriteRef.current
            );

          let restoreIndex = -1;

          if (
            restoreId &&
            restoreAddonId
          ) {
            restoreIndex =
              refreshedVisible.findIndex(
                (channel) => {
                  const id = String(
                    channel.item.imdb_id ||
                    channel.item.id ||
                    ''
                  ).trim();

                  const addonId = String(
                    channel.addonId || ''
                  ).trim();

                  return (
                    id === restoreId &&
                    addonId === restoreAddonId
                  );
                }
              );
          }

          if (
            restoreIndex < 0 &&
            refreshedVisible.length > 0
          ) {
            restoreIndex =
              Math.min(
                Math.max(
                  fallbackIndex,
                  0
                ),
                refreshedVisible.length - 1
              );
          }

          if (restoreIndex < 0) {
            console.log(
              '[V788T10G2 LIVE GUIDE] refreshed guide empty - no focus target'
            );
            return;
          }

          requestAnimationFrame(() => {
            v788qPreferredFocusArmedRef.current =
              true;

            setPreferredChannelIndex(
              restoreIndex
            );

            setV788t8vFocusRestoreRequest(
              (request) => ({
                index: restoreIndex,
                serial: request.serial + 1,
              })
            );

            console.log(
              '[V788T10G2 LIVE GUIDE] post-refresh focus restore',
              'index=' + restoreIndex,
              'visibleChannels=' +
                refreshedVisible.length
            );
          });
        })();
      } else if (!guideLoadedRef.current) {
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
          v789gVisibleChannels.map((entry) => ({
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
          '[W121ZSY3 LIVE SURF] visible snapshot',
          'channels=' +
            v789gVisibleChannels.length,
          'id=' + id,
          'addon=' + addonId
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
  }, [router, v789gVisibleChannels]);

  // V788T8Z_PERSISTED_BOOKMARK_ACK
  // W121ZPLAY10Y24Q_PERSISTED_CHANNEL_ID_ALIASES
  const v788t8zLibraryHasChannel = useCallback(
    (id: string) => {
      const currentLibrary: any =
        useContentStore.getState().library;

      const libraryChannels: any[] =
        ([] as any[]).concat(
          currentLibrary?.channels || [],
          currentLibrary?.tv || []
        );

      return libraryChannels.some(
        (item: any) =>
          [
            item?.content_id,
            item?.imdb_id,
            item?.id,
          ].some(
            (raw) =>
              String(raw || '').trim() === id
          )
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

      // W121ZPLAY10Y23A_DIRECT_GUIDE_FAVORITE_PUSH
      // Feed the favorite-only delta directly to the currently mounted
      // native guide before persistence begins. The native guide's
      // existing favorite-only fast path owns the direct badge repaint.
      const v788y23CurrentGuideItems =
        v788y23GuideItemsRef.current;

      if (v788y23CurrentGuideItems.length > 0) {
        const v788y23NextGuideItems =
          v788y23CurrentGuideItems.map(
            (item: any) =>
              item.key === channel.key
                ? {
                    ...item,
                    favorite: nextFavorite,
                  }
                : item
          );

        v788y23GuideItemsRef.current =
          v788y23NextGuideItems;

        try {
          v788y23GuideRef.current?.setNativeProps({
            items: v788y23NextGuideItems,
          });

          console.log(
            '[W121ZPLAY10Y23A DIRECT GUIDE FAVORITE]',
            channel.key,
            nextFavorite
          );
        } catch (error) {
          console.warn(
            '[W121ZPLAY10Y23A DIRECT GUIDE FAVORITE FAILED]',
            error
          );
        }
      }

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

        // W121ZPLAY10Y24L_SINGLE_LIBRARY_SYNC
        // addToLibrary/removeFromLibrary already await fetchLibrary()
        // in V176J_STORE_FINALLY. Do not issue a second GET here.
        // Verify the authoritative store state they just refreshed.
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
          (previous) =>
            previous[id] === nextFavorite
              ? previous
              : {
                  ...previous,
                  [id]: nextFavorite,
                }
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
    ]
  );

 // V788P5D_POSTER_STYLE_CHANNEL_BOOKMARK
 v788pToggleFavoriteRef.current =
   toggleFavorite;

 // V789H_CATEGORY_BUTTON_RENDERER
 const v789gRenderCategoryButton = (
   category: V789gCategoryDef,
   visualIndex: number
 ) => {
   const selected =
     v789gCategory ===
     category.key;

   const selfTag =
     v789hCategoryTags[
       visualIndex
     ] || undefined;

   const leftTag =
     visualIndex > 0
       ? (
           v789hCategoryTags[
             visualIndex - 1
           ] || selfTag
         )
       : selfTag;

   const rightTag =
     visualIndex <
     v789gVisibleCategoryDefsRef.current.length -
       1
       ? (
           v789hCategoryTags[
             visualIndex + 1
           ] || selfTag
         )
       : selfTag;

   return (
     <Pressable
       key={category.key}
       ref={(node: any) =>
         v789hRegisterCategoryRef(
           visualIndex,
           node
         )
       }
       accessibilityLabel={
         category.label
       }
       // V789N_CATEGORY_LAYOUT
       onLayout={(event: any) => {
         const layout =
           event?.nativeEvent?.layout;

         if (!layout) {
           return;
         }

         const x =
           Number(layout.x);

         const width =
           Number(layout.width);

         if (
           !Number.isFinite(x) ||
           !Number.isFinite(width) ||
           width <= 0
         ) {
           return;
         }

         v789nCategoryLayoutsRef
           .current[visualIndex] = {
             x,
             width,
           };
       }}       focusable={
         v789hCategoryMode
       }
       nextFocusLeft={
         leftTag
       }
       nextFocusRight={
         rightTag
       }
       nextFocusUp={
         selfTag
       }
       // V789M_EXPLICIT_CATEGORY_DOWN
       // Prevent Android spatial search from choosing
       // an arbitrary guide child. JS requests row 0.
       nextFocusDown={
         selfTag
       }       onFocus={() => {
         v789hCategoryModeRef
           .current = true;

         setV789hCategoryMode(
           true
         );

         v789hCategoryFocusedIndexRef
           .current =
           visualIndex;

         // V789K_R6_COMMIT_CATEGORY_HANDOFF
         // Android focus is confirmed here.
         // It is now safe to retire station-only state.
         v788pClearStationLongPress();
         v788t8cFocusAreaRef
           .current = 'none';

         v788t8cFocusedRowRef
           .current = null;

         v788t8cFirstLeftRef
           .current = 0;

         v788t8cRawLeftRef
           .current = 0;

         // V789N_CATEGORY_SCROLL_OWNER
         // Focus already moved to the exact adjacent pill.
         // Only scroll if its real bounds leave the viewport.
         v789nEnsureCategoryVisible(
           visualIndex,
           false
         );
         console.log(
           '[V789H CATEGORY FOCUS] ' +
             'index=' +
             visualIndex +
             ' key=' +
             category.key
         );
       }}
       // V789M_CATEGORY_BLUR_NO_AUTO_EXIT
       //
       // Horizontal category-to-category focus may take
       // longer than one frame on Fire TV. Blur itself is
       // NOT an exit condition anymore.
       onBlur={() => {
         if (
           v789hCategoryFocusedIndexRef
             .current ===
           visualIndex
         ) {
           v789hCategoryFocusedIndexRef
             .current = -1;
         }
       }}       onPress={() =>
         v789gSelectCategory(
           category.key
         )
       }
       style={({
         focused,
       }: any) => [
         styles.v789gCategoryButton,
         selected &&
           styles.v789gCategoryButtonSelected,
         focused &&
           styles.v789gCategoryButtonFocused,
       ]}
     >
       {category.key ===
         'favorites' && (
         <Ionicons
           name="star"
           size={17}
           color={
             selected
               ? '#0c0c0c'
               : '#B8A05C'
           }
         />
       )}

       <Text
         style={[
           styles.v789gCategoryText,
           selected &&
             styles.v789gCategoryTextSelected,
         ]}
       >
         {category.label}
       </Text>
     </Pressable>
   );
 };
 // V788T8L_NATIVE_STATION_ITEMS
  // V789N_NATIVE_CATEGORY_ITEMS
  const v789nNativeCategoryItems =
    useMemo(
      () =>
        v789gVisibleCategoryDefs.map(
          (category) => ({
            id: category.key,
            label: category.label,
            selected:
              category.key ===
              v789gCategory,
          })
        ),
      [
        v789gCategory,
        v789gVisibleCategoryDefs,
      ]
    );

  // V789N_NATIVE_CATEGORY_FOCUS
  const v789nHandleNativeCategoryFocus =
    useCallback(
      (event: any) => {
        const index =
          Number(
            event?.nativeEvent?.index
          );

        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >=
            v789gVisibleCategoryDefsRef.current.length
        ) {
          return;
        }

        const category =
          v789gVisibleCategoryDefsRef.current[index];

        // V789S6_IGNORE_STALE_CATEGORY_FOCUS_DURING_EXIT
        //
        // Runtime proof from V789S5 showed the guide taking row-0 focus,
        // followed by a delayed native category focus callback that turned
        // category mode back on. Ignore category callbacks once an exit is
        // pending or the guide has already retired category mode.
        if (
          v789mCategoryExitPendingRef.current ||
          !v789hCategoryModeRef.current
        ) {
          console.log(
            '[V789S6 STALE CATEGORY FOCUS IGNORED] ' +
              'index=' +
              index +
              ' key=' +
              category.key +
              ' pendingExit=' +
              String(
                v789mCategoryExitPendingRef.current
              ) +
              ' categoryMode=' +
              String(
                v789hCategoryModeRef.current
              )
          );

          return;
        }

        v789hCategoryModeRef.current =
          true;

        setV789hCategoryMode(
          true
        );

        v789hCategoryFocusedIndexRef
          .current =
          index;

        v789mCategoryExitPendingRef.current =
          false;

        // Do NOT feed preferredFocusIndex back on every
        // horizontal focus move. Native RecyclerView owns
        // LEFT/RIGHT from this point forward.
        v788pClearStationLongPress();

        v788t8cFocusAreaRef.current =
          'none';

        v788t8cFocusedRowRef.current =
          null;

        v788t8cFirstLeftRef.current =
          0;

        v788t8cRawLeftRef.current =
          0;

        console.log(
          '[V789N NATIVE CATEGORY FOCUS] ' +
            'index=' +
            index +
            ' key=' +
            category.key
        );
      },
      [
        v788pClearStationLongPress,
      ]
    );

  // V789N_NATIVE_CATEGORY_PRESS
  const v789nHandleNativeCategoryPress =
    useCallback(
      (event: any) => {
        const index =
          Number(
            event?.nativeEvent?.index
          );

        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >=
            v789gVisibleCategoryDefsRef.current.length
        ) {
          return;
        }

        const category =
          v789gVisibleCategoryDefsRef.current[index];

        console.log(
          '[V789N NATIVE CATEGORY PRESS] ' +
            'index=' +
            index +
            ' key=' +
            category.key
        );

        // If the selected-state data refresh momentarily
        // detaches the holder, fallback focus returns to
        // the item the user actually selected.
        setV789nNativeCategoryPreferredIndex(
          index
        );

        v789gSelectCategory(
          category.key
        );
      },
      [
        v789gSelectCategory,
      ]
    );

  const v789nHandleNativeCategoryBlur =
    useCallback(
      () => {
        // V789M owns the category -> guide exit commit.
        // A row blur by itself does not retire category mode.
        console.log(
          '[V789N NATIVE CATEGORY BLUR] ' +
            'pendingExit=' +
            String(
              v789mCategoryExitPendingRef
                .current
            )
        );
      },
      []
    );
 const v788t8lStationItems = useMemo(
   () =>
     v789gVisibleChannels.map((channel) => {
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
   [v789gVisibleChannels, v788t8xIsFavorite]
 );

 // V788T4A_PROGRAM_GEOMETRY
 // Snap the horizontal guide to the focused program.
 // Queued animations can move content underneath native TV focus.
 // V788T8P_WHOLE_ROW_NATIVE_ITEMS
 const v788t8pGuideItems = useMemo(
   () =>
     v789gVisibleChannels.map((channel) => {
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
   [v789gVisibleChannels, v788t8xIsFavorite]
 );

 // W121ZPLAY10Y24X_STABLE_DIRECT_GUIDE_CACHE
 // Y24L intentionally keeps v788t8pGuideItems stable across favorite
 // state changes. Only reseed the mutable direct-guide cache when the
 // structural/native guide-items memo itself actually changes.
 useEffect(() => {
   v788y23GuideItemsRef.current =
     v788t8pGuideItems;
 }, [v788t8pGuideItems]);
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
      {/* V789H_INLINE_LOGO_CATEGORY_ROW */}
      <View
        style={
          styles.v789hTopRow
        }
      >
        <Image
          source={require('../../assets/images/livetv-header-icon.png')}
          style={
            styles.v789hLogo
          }
          resizeMode="contain"
        />

        {/* V789N_NATIVE_CATEGORY_SWITCH */}
        <PrivastreamCategoryRow
          style={{
            flex: 1,
            height: 36, // V789S9_CENTER_CATEGORY_PILLS_WITH_ICON
            marginLeft: 80, // V789S13B_RESTORE_S11_HEADER_GAP
          }}
          items={
            v789nNativeCategoryItems
          }
          itemWidth={156}
          itemHeight={36}
          gap={8}
          leftPadding={4} // V789S13B_FIRST_PILL_SCALE_BLEED_GUARD
          rightPadding={24}
          anchorColumn={5}
          preferredFocusIndex={
            v789nNativeCategoryPreferredIndex
          }
          focusRequest={
            v789nNativeCategoryFocusSerial > 0
              ? `${v789nNativeCategoryPreferredIndex}:${v789nNativeCategoryFocusSerial}`
              : ''
          }
          active={
            v789hCategoryMode
          }
          onItemFocus={
            v789nHandleNativeCategoryFocus
          }
          onItemPress={
            v789nHandleNativeCategoryPress
          }
          onRowBlur={
            v789nHandleNativeCategoryBlur
          }
        />      </View>
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
        ref={v788y23GuideRef}
        key={`livetv-guide:${v789gCategory}`}
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
          v788t8vFocusRestoreRequest.serial > 0
            ? `${v788t8vFocusRestoreRequest.index}:${v788t8vFocusRestoreRequest.serial}`
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
            index >= v789gVisibleChannels.length
          ) {
            return;
          }

          const channel = v789gVisibleChannels[index];
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

          const programToStation =
            previousRow === index &&
            previousArea === 'program' &&
            zone === 'station';

          const stationRowOneToZero =
            previousRow === 1 &&
            previousArea === 'station' &&
            index === 0 &&
            zone === 'station';

          v788t8cFocusedRowRef.current = index;

          if (logicalFocusChanged) {
            v788t8cFirstLeftRef.current = 0;
            v788t8cRawLeftRef.current = 0;

            if (
              v789kSingleLeftTimerRef.current
            ) {
              clearTimeout(
                v789kSingleLeftTimerRef.current
              );

              v789kSingleLeftTimerRef.current =
                null;
            }
          }

          if (programToStation) {
            v789s9ProgramToStationLeftRef.current =
              Date.now();

            console.log(
              '[V789S9 PROGRAM TO STATION] ' +
                'row=' +
                index
            );
          }

          if (stationRowOneToZero) {
            // V789S10_ROW1_TO_ROW0_UP_GUARD
            v789s10RowOneToZeroUpRef.current =
              Date.now();

            console.log(
              '[V789S10 STATION ROW1 TO ROW0] armed'
            );
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
                  console.log(
                    '[V789I HOLD OK FAVORITE] ' +
                      channel.key
                  );

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

          // V789M_R6_EXIT_COMMIT
          //
          // A native guide child now owns Android focus.
          // It is finally safe to make category buttons
          // non-focusable again.
          if (
            v789mCategoryExitPendingRef.current
          ) {
            v789mCategoryExitPendingRef.current =
              false;

            v789hCategoryModeRef.current =
              false;

            v789hCategoryFocusedIndexRef.current =
              -1;

            setV789hCategoryMode(
              false
            );

            console.log(
              '[V789M EXIT COMMIT] ' +
                'guideRow=' +
                index +
                ' zone=' +
                zone
            );
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
            index < v789gVisibleChannels.length
          ) {
            void openChannel(
              v789gVisibleChannels[index]
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
  // V789H_INLINE_CATEGORY_STYLES
  v789hTopRow: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    position: 'relative',
  },
  v789hLogo: {
    // V789S6_LARGER_HEADER_ICON
    // 568x358 artwork uses width as the limiting dimension under contain.
    // 64x48 keeps it inside the 52px header while making the visible art
    // substantially larger; V789S11 starts the category row at x=80 for a 16px box gap.
    width: 64,
    height: 48,
    position: 'absolute',
    left: 0,
    top: 2,
    zIndex: 2,
  },
  v789gCategoryRail: {
    flex: 1,
    flexGrow: 1,
    height: 48,
  },
  v789gCategoryRailContent: {
    alignItems: 'center',
    paddingRight: 24,
  },
  v789gCategoryButton: {
    minHeight: 36,
    paddingHorizontal: 14,
    marginRight: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#333',
    backgroundColor: '#171717',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  v789gCategoryButtonSelected: {
    backgroundColor: '#B8A05C',
    borderColor: '#B8A05C',
  },
  v789gCategoryButtonFocused: {
    borderColor: '#ffffff',
    borderWidth: 3,
    transform: [
      { scale: 1.04 },
    ],
  },
  v789gCategoryText: {
    color: '#e5e5e5',
    fontSize: 14,
    fontWeight: '700',
  },
  v789gCategoryTextSelected: {
    color: '#0c0c0c',
  },
  guideHeader: {
    flexDirection: 'row',
    backgroundColor: '#151515',
  },
  guide: { flexDirection: 'row', flex: 1 },
  stationHeader: {
    // W121ZPLAY10Y24F_SEVEN_FULL_ROWS
    height: 36,
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
    height: 36,
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