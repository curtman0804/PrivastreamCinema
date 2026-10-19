import { v173RegisterLongPress as _v173RegLP,
  /* V176K_POPOVER */ V176kPopover, v176kMeasureAnchor, v176kEmitOpen, v176kBuildActions
} from '../../../src/components/ContentCard';
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Linking,
  FlatList,
  Image as RNImage,
  Animated,
  Easing,
  BackHandler,
  Platform,
  findNodeHandle,
  InteractionManager,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Constants from 'expo-constants';
import { getStoredDevicePlaybackProfile } from '../../../src/native/devicePlaybackCapabilities';
import { useContentStore, getMetaCache, setMetaCache, hydrateMetaFromDisk } from '../../../src/store/contentStore';
import { v311Perf } from '../../../src/utils/v311_perf'; // V311_PERF_PROFILER
import { repairDisplayText } from '../../../src/utils/displayText';

// v238 cache buster â€” append &_t=<ts> to ANY URL handed to the player so
// Firestick's aggressive media cache can't replay a stale wrong-content
// stream URL. Safe for proxy, torrent-video, and external CDN URLs.
function _v237_bustUrl(u: any) {
  if (!u || typeof u !== "string") return u;
  const sep = u.includes("?") ? "&" : "?";
  return u + sep + "_t=" + Date.now();
}


// Fallback image for missing posters
const NO_POSTER_IMAGE = require('../../../assets/images/no-poster.png');

import { api, ContentItem, Stream, Episode } from '../../../src/api/client';
import AsyncStorage, { getItemSyncFast } from '../../../src/utils/mmkvStorage';
import { premiumizeCacheCheck, isPremiumizeConfigured, premiumizeDirectDL, premiumizeMediaProbe, premiumizeSeekReadinessProbe, premiumizeStartupDeliverySample } from '../../../src/services/premiumizeClient';
/* V176C_EPISODE_MENU_IMPORT â€” Stremio-style menu helpers for episode posters. */
import {
  v172IsWatched as _v176cV172IsWatched,
  v172SubscribeWatched as _v176cV172SubWatched,
  v172UnmarkWatched as _v176cV172Unmark,
  v176MarkWatched as _v176cV176Mark,
  v176HasProgress as _v176cV176HasProg,
  v176SubscribeProgress as _v176cV176SubProg,
  v176ClearProgress as _v176cV176Clear,
} from '../../../src/components/ContentCard';
import { Alert as _V176cAlert } from 'react-native';

const { width, height } = Dimensions.get('window');

// V659_DYNAMIC_DEVICE_CAPABILITIES_DIAG
const _v659DeviceCaps = getStoredDevicePlaybackProfile();
try {
  console.log(
    '[W121ZOD117 STORED DEVICE PROFILE]',
    JSON.stringify(_v659DeviceCaps)
  );
} catch (_) {}

// Stremio-style animated indeterminate loading bar. Renders a thin gold
// segment that slides across a dark track. Pure Animated.Value so it runs
// on the native thread and doesn't stutter on Firestick.
// PATCH_V154_MATCH_HELPER â€” sanity check that the stream we are about to play
// actually has SOME word from the requested content title.  Returns count of
// matching significant words; 0 means the filename is unrelated to the request.
function _v154TitleOverlap(requestedTitle: string, streamTitle: string): number {
  try {
    if (!requestedTitle || !streamTitle) return 0;
    const stop = new Set(['THE','A','AN','AND','OR','OF','IN','ON','TO','FOR','VS','VS.','PART','VOL']);
    const norm = (s: string) => s.toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !stop.has(w));
    const reqWords = new Set(norm(requestedTitle));
    if (reqWords.size === 0) return 99; // can't judge; assume ok
    const streamWords = norm(streamTitle);
    let hits = 0;
    for (const w of streamWords) if (reqWords.has(w)) hits++;
    return hits;
  } catch (_) { return 99; }
}

// V744_WRONG_TITLE_FAIL_CLOSED
// Requested movie identity must agree with the release/file identity.
function _v744TitleWords(value: any): string[] {
  try {
    let raw = String(value || '');
    try { raw = decodeURIComponent(raw); } catch (_) {}

    const stop = new Set([
      'THE', 'A', 'AN', 'AND', 'OR', 'OF', 'IN', 'ON',
      'TO', 'FOR', 'VS', 'PART', 'VOL', 'VOLUME'
    ]);

    return raw
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(w => !!w && !stop.has(w));
  } catch (_) {
    return [];
  }
}

function _v744TitleMatches(requestedTitle: any, candidateText: any): boolean {
  try {
    const req = _v744TitleWords(requestedTitle);
    const cand = _v744TitleWords(candidateText);

    if (req.length === 0 || cand.length === 0) return false;

    const reqCompact = req.join('');
    const candCompact = cand.join('');

    if (
      reqCompact.length >= 2 &&
      candCompact.includes(reqCompact)
    ) {
      return true;
    }

    const candidateWords = new Set(cand);
    let hits = 0;

    for (const word of req) {
      if (candidateWords.has(word)) hits++;
    }

    if (req.length === 1) return hits === 1;
    if (req.length === 2) return hits === 2;

    return hits >= Math.ceil(req.length * 0.8);
  } catch (_) {
    return false;
  }
}

function _v744StreamMatchesTitle(requestedTitle: any, stream: any): boolean {
  const identity = String(
    stream?.title ||
    stream?.filename ||
    stream?.name ||
    ''
  );

  return _v744TitleMatches(requestedTitle, identity);
}
// V745_STRICT_CONTENT_IDENTITY
function _v745Year(value: any): string {
  try {
    const m = String(value || '').match(/\b(?:18|19|20|21)\d{2}\b/);
    return m ? m[0] : '';
  } catch (_) {
    return '';
  }
}

function _v745MovieIdentityMatches(
  requestedTitle: any,
  requestedYear: any,
  candidateText: any
): boolean {
  if (!_v744TitleMatches(requestedTitle, candidateText)) {
    return false;
  }

  const year = _v745Year(requestedYear);

  // If canonical metadata has a year, require that year.
  // If metadata has no year, title remains the strongest available signal.
  if (!year) return true;

  let raw = String(candidateText || '');

  try {
    raw = decodeURIComponent(raw);
  } catch (_) {}

  return new RegExp(
    '(?:^|[^0-9])' + year + '(?:[^0-9]|$)'
  ).test(raw);
}

function _v745EpisodeIdentityMatches(
  requestedSeriesTitle: any,
  season: any,
  episode: any,
  candidateText: any
): boolean {
  try {
    const sNum = Number(season);
    const eNum = Number(episode);

    if (
      !requestedSeriesTitle ||
      !Number.isFinite(sNum) ||
      !Number.isFinite(eNum)
    ) {
      return false;
    }

    let raw = String(candidateText || '');

    try {
      raw = decodeURIComponent(raw);
    } catch (_) {}

    if (!_v744TitleMatches(requestedSeriesTitle, raw)) {
      return false;
    }

    const s = String(sNum).padStart(2, '0');
    const e = String(eNum).padStart(2, '0');

    const seCode = `S${s}E${e}`;
    const xCode1 = `${sNum}x${e}`;
    const xCode2 = `${s}x${e}`;

    const upper = raw.toUpperCase();
    const lower = raw.toLowerCase();

    return (
      upper.includes(seCode) ||
      lower.includes(xCode1.toLowerCase()) ||
      lower.includes(xCode2.toLowerCase())
    );
  } catch (_) {
    return false;
  }
}
function AutoPlayLoadingBar() {
  const translateX = useRef(new Animated.Value(-100)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translateX, {
          toValue: 260,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: -100,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [translateX]);

  return (
    <View style={{ width: 260, height: 4, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 2, overflow: 'hidden' }}>
      <Animated.View
        style={{
          position: 'absolute',
          width: 100,
          height: 4,
          backgroundColor: '#B8A05C',
          borderRadius: 2,
          transform: [{ translateX }],
        }}
      />
    </View>
  );
}

// Focusable Button Component
// v238c â€” helper used in both player metadata + autoPlayOverlay text.
// MUST be module-level (was nested inside handleStreamSelect â†’ caused
// ReferenceError when the overlay tried to render).
const _v238ValidNum = (n: any) => (n != null && !Number.isNaN(Number(n)));
// V780E_TPB_JSTRM_IDENTITY
// TPB jstrm IDs contain the authoritative torrent identity
// inside a base64url JSON payload. Decode payload.t only.
function _v780eJstrmTitle(value: any): string {
  try {
    const raw = String(value || '').trim();

    if (!raw.toLowerCase().startsWith('jstrm:')) {
      return '';
    }

    let encoded = raw
      .slice(6)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    while (encoded.length % 4 !== 0) {
      encoded += '=';
    }

    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

    const bytes: number[] = [];

    for (let i = 0; i < encoded.length; i += 4) {
      const c0 = alphabet.indexOf(encoded[i] || '');
      const c1 = alphabet.indexOf(encoded[i + 1] || '');

      if (c0 < 0 || c1 < 0) {
        break;
      }

      const ch2 = encoded[i + 2] || '=';
      const ch3 = encoded[i + 3] || '=';

      const c2 =
        ch2 === '='
          ? -1
          : alphabet.indexOf(ch2);

      const c3 =
        ch3 === '='
          ? -1
          : alphabet.indexOf(ch3);

      bytes.push(
        ((c0 << 2) | (c1 >> 4)) & 0xff
      );

      if (c2 >= 0) {
        bytes.push(
          (((c1 & 0x0f) << 4) | (c2 >> 2)) & 0xff
        );
      }

      if (c2 >= 0 && c3 >= 0) {
        bytes.push(
          (((c2 & 0x03) << 6) | c3) & 0xff
        );
      }
    }

    const escaped = bytes
      .map(
        b =>
          '%' +
          b.toString(16).padStart(2, '0')
      )
      .join('');

    let jsonText = '';

    try {
      jsonText = decodeURIComponent(escaped);
    } catch (_) {
      jsonText = bytes
        .map(b => String.fromCharCode(b))
        .join('');
    }

    const payload = JSON.parse(jsonText);

    return String(payload?.t || '').trim();
  } catch (_) {
    return '';
  }
}

// PATCH_V244_MEMO â€” kill re-render storms during stream loading on Firestick.
// FocusableButton/ChipButton/EpisodeCard each render dozens of times per page;
// without React.memo every parent re-render (stream progress, focus change,
// stream sort) re-renders ALL of them.  React.memo skips when props are equal.
const FocusableButton = React.memo(function FocusableButton({ 
  onPress, 
  style, 
  focusedStyle,
  children,
  disabled = false,
  hasTVPreferredFocus = false,
}: {
  onPress?: () => void;
  style: any;
  focusedStyle?: any;
  children: React.ReactNode;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
}) {
  const [isFocused, setIsFocused] = useState(false);
  
  return (
    <Pressable
      style={[style, isFocused && (focusedStyle || styles.defaultFocused)]}
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
    >
      {children}
    </Pressable>
  );
});

// Clickable chip for genre/cast/director - routes to search
// PATCH_V244_MEMO â€” see FocusableButton above.
const ChipButton = React.memo(function ChipButton({ label, onPress, hasTVPreferredFocus = false }: { label: string; onPress: () => void; hasTVPreferredFocus?: boolean }) {
  const [isFocused, setIsFocused] = useState(false);
  return (
    <Pressable
      style={[styles.chipButton, isFocused && styles.chipButtonFocused]}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onPress={onPress}
      hasTVPreferredFocus={hasTVPreferredFocus}
    >
      <Text style={[styles.chipText, isFocused && styles.chipTextFocused]}>{repairDisplayText(label)}</Text>
    </Pressable>
  );
});


// Parse stream info helper - used by StreamCard and sorting
// PATCH_V11A_PARSE_CACHE â€” module-level cache so each Stream object is parsed exactly once.
// PATCH_V19A_PARSE_CACHE â€” module-level WeakMap cache for parseStreamInfo.
const _parseStreamInfoCache = new WeakMap<Stream, any>();

function parseStreamInfo(stream: Stream) {
  {
    const _v19Cached = _parseStreamInfoCache.get(stream);
    if (_v19Cached) return _v19Cached;
  }
  const _cached = _parseStreamInfoCache.get(stream);
  if (_cached) return _cached;
  const name = stream.name || '';
  const title = stream.title || '';
  const combined = `${name} ${title}`.toUpperCase();
  
  // Extract quality
  let quality = 'SD';
  if (name.includes('4K') || name.includes('2160') || title.includes('2160')) quality = '4K';
  else if (name.includes('1080') || title.includes('1080')) quality = '1080p';
  else if (name.includes('720') || title.includes('720')) quality = '720p';
  else if (name.toUpperCase().includes('HD') && !name.toUpperCase().includes('SD')) quality = 'HD';

  // PATCH_V9_CODEC_DETECTION â€” Firestick decodes H.264/AVC reliably; HEVC/x265 stutters or shows black frames
  const isHEVC = combined.includes('HEVC') || combined.includes('X265') || combined.includes('H265') || combined.includes('H.265');
  // PATCH_V153_HDR_BROAD â€” wide detection: explicit HDR tags, 10-bit signaling,
  // wide-color-gamut metadata names, and a presumption that any UNTAGGED 4K HEVC
  // release is HDR (true for ~95% of 4K HEVC encodes in the wild).
  const _v153HasExplicitSDR = combined.includes('SDR')
    || combined.includes('8BIT') || combined.includes('8-BIT') || combined.includes('8 BIT');
  const _v153HasExplicitHDR = (
    combined.includes('HDR')              // catches HDR, HDR10, HDR10+, HDR-10, HDR PLUS
    || combined.includes('DOLBY VISION') || combined.includes('DOLBYVISION')
    || combined.includes('DV.') || combined.includes(' DV ') || combined.includes('-DV-') || combined.includes('.DV.')
    || combined.includes('10BIT') || combined.includes('10-BIT') || combined.includes('10 BIT') || combined.includes('X265.10')
    || combined.includes('HLG')
    || combined.includes('BT2020') || combined.includes('BT.2020')
    || combined.includes('REC2020') || combined.includes('REC.2020')
    || combined.includes('WCG')
    || combined.includes('PQ10') || combined.includes('SMPTE2084')
  );
  const _v153IsPresumed4KHEVC = (quality === '4K' && isHEVC && !_v153HasExplicitSDR);
  const isHDR = _v153HasExplicitHDR || _v153IsPresumed4KHEVC;

  // PATCH_V12_COMMENTARY_DETECT â€” exclude commentary tracks (creator/director/audio commentary).
  // Heavy penalty in computeScore guarantees these sink to the bottom of the list.
  const isCommentary = (
    combined.includes('COMMENTARY') ||
    combined.includes('COMM TRACK') ||
    combined.includes('COMM-TRACK') ||
    combined.includes('CREATOR COMM') ||
    combined.includes('DIRECTOR COMM') ||
    combined.includes('WRITER COMM') ||
    combined.includes('WRITERS COMM') ||
    combined.includes('WITH COMM') ||
    combined.includes('AUDIO COMM') ||
    /\[\s*COMM[^\]]*\]/.test(combined) ||
    /\bCOMM\.\b/.test(combined)
  );
  
  // Extract source
  let source = stream.addon || 'Unknown';
  if (stream.provider) {
    source = stream.provider;
  } else if (name.includes('TPB') || name.includes('ðŸ´â€â˜ ï¸')) source = 'TPB+';
  else if (name.includes('âš¡') || name.includes('Torrentio')) source = 'Torrentio';
  else if (name.includes('EZTV')) source = 'EZTV';
  else if (name.includes('YTS') || name.includes('YIFY')) source = 'YTS';
  
  // Extract size from title
  let size = '';
  const sizeMatch = title.match(/ðŸ’¾\s*([\d.]+\s*[GM]B)/i);
  if (sizeMatch) size = sizeMatch[1];
  if (!size) {
    const sizeMatch2 = title.match(/([\d.]+)\s*(GB|MB)/i);
    if (sizeMatch2) size = `${sizeMatch2[1]} ${sizeMatch2[2].toUpperCase()}`;
  }
  
  // Extract seeders
  let seeders = stream.seeders || 0;
  if (!seeders) {
    const seederMatch = title.match(/ðŸ‘¤\s*(\d+)/);
    if (seederMatch) seeders = parseInt(seederMatch[1], 10);
  }
  if (!seeders) {
    const peerMatch = title.match(/ðŸŒ±\s*(\d+)/);
    if (peerMatch) seeders = parseInt(peerMatch[1], 10);
  }
  
  // Detect language
  const FOREIGN_KEYWORDS = [
    'FRENCH', 'TRUEFRENCH', 'VFF', 'VFQ', 'VOSTFR',
    'SPANISH', 'LATINO', 'CASTELLANO',
    'GERMAN', 'DEUTSCH',
    'ITALIAN', 'ITALIANO',
    'RUSSIAN', 'DUBBED', 'DUBLADO',
    'PORTUGUESE', 'HINDI', 'TAMIL', 'TELUGU',
    'KOREAN', 'JAPANESE', 'CHINESE', 'MANDARIN',
    'TURKISH', 'ARABIC', 'POLISH', 'DUTCH', 'CZECH',
    'THAI', 'INDONESIAN', 'VIETNAMESE', 'SWEDISH',
    'MULTI',
  ];
  const FOREIGN_FLAGS = ['ðŸ‡«ðŸ‡·', 'ðŸ‡ªðŸ‡¸', 'ðŸ‡²ðŸ‡½', 'ðŸ‡§ðŸ‡·', 'ðŸ‡©ðŸ‡ª', 'ðŸ‡®ðŸ‡¹', 'ðŸ‡·ðŸ‡º', 'ðŸ‡µðŸ‡¹', 'ðŸ‡µðŸ‡±', 'ðŸ‡³ðŸ‡±', 'ðŸ‡¨ðŸ‡³', 'ðŸ‡¯ðŸ‡µ', 'ðŸ‡°ðŸ‡·', 'ðŸ‡®ðŸ‡³', 'ðŸ‡¹ðŸ‡·'];
  const HAS_ENGLISH = combined.includes('ENGLISH') || combined.includes('ðŸ‡¬ðŸ‡§') || combined.includes('ðŸ‡ºðŸ‡¸') || combined.includes('EN/') || combined.includes('/EN');
  
  // v472d - collect ALL detected language flags (multi-audio support)
  const _v472_flagSet = new Set<string>();
  let isForeign = false;
  const _V470_KW_TO_FLAG: Record<string, string> = {
    'FRENCH': '\u{1F1EB}\u{1F1F7}', 'TRUEFRENCH': '\u{1F1EB}\u{1F1F7}', 'VFF': '\u{1F1EB}\u{1F1F7}', 'VFQ': '\u{1F1EB}\u{1F1F7}', 'VOSTFR': '\u{1F1EB}\u{1F1F7}',
    'SPANISH': '\u{1F1EA}\u{1F1F8}', 'CASTELLANO': '\u{1F1EA}\u{1F1F8}', 'LATINO': '\u{1F1F2}\u{1F1FD}',
    'GERMAN': '\u{1F1E9}\u{1F1EA}', 'DEUTSCH': '\u{1F1E9}\u{1F1EA}',
    'ITALIAN': '\u{1F1EE}\u{1F1F9}', 'ITALIANO': '\u{1F1EE}\u{1F1F9}',
    'RUSSIAN': '\u{1F1F7}\u{1F1FA}',
    'HINDI': '\u{1F1EE}\u{1F1F3}', 'TAMIL': '\u{1F1EE}\u{1F1F3}', 'TELUGU': '\u{1F1EE}\u{1F1F3}',
    'PORTUGUESE': '\u{1F1F5}\u{1F1F9}', 'DUBLADO': '\u{1F1E7}\u{1F1F7}', 'BRAZILIAN': '\u{1F1E7}\u{1F1F7}',
    'DUBBED': '\u{1F399}\uFE0F',
    'MULTI': '\u{1F310}',
    'KOREAN': '\u{1F1F0}\u{1F1F7}', 'JAPANESE': '\u{1F1EF}\u{1F1F5}',
    'CHINESE': '\u{1F1E8}\u{1F1F3}', 'MANDARIN': '\u{1F1E8}\u{1F1F3}', 'CANTONESE': '\u{1F1ED}\u{1F1F0}',
    'TURKISH': '\u{1F1F9}\u{1F1F7}', 'ARABIC': '\u{1F1F8}\u{1F1E6}',
    'POLISH': '\u{1F1F5}\u{1F1F1}', 'DUTCH': '\u{1F1F3}\u{1F1F1}', 'CZECH': '\u{1F1E8}\u{1F1FF}',
    'THAI': '\u{1F1F9}\u{1F1ED}', 'INDONESIAN': '\u{1F1EE}\u{1F1E9}', 'VIETNAMESE': '\u{1F1FB}\u{1F1F3}',
    'SWEDISH': '\u{1F1F8}\u{1F1EA}', 'NORWEGIAN': '\u{1F1F3}\u{1F1F4}', 'DANISH': '\u{1F1E9}\u{1F1F0}', 'FINNISH': '\u{1F1EB}\u{1F1EE}',
    'HUNGARIAN': '\u{1F1ED}\u{1F1FA}', 'GREEK': '\u{1F1EC}\u{1F1F7}', 'HEBREW': '\u{1F1EE}\u{1F1F1}',
    'ROMANIAN': '\u{1F1F7}\u{1F1F4}', 'UKRAINIAN': '\u{1F1FA}\u{1F1E6}', 'BULGARIAN': '\u{1F1E7}\u{1F1EC}',
  };
  for (const kw of FOREIGN_KEYWORDS) {
    if (combined.includes(kw)) {
      isForeign = true;
      _v472_flagSet.add(_V470_KW_TO_FLAG[kw] || '\u{1F30D}');
    }
  }
  for (const flag of FOREIGN_FLAGS) {
    if (title.includes(flag) || name.includes(flag)) {
      isForeign = true;
      _v472_flagSet.add(flag);
    }
  }
  if (HAS_ENGLISH) _v472_flagSet.add('\u{1F1FA}\u{1F1F8}');
  if (_v472_flagSet.size === 0) _v472_flagSet.add('\u{1F1FA}\u{1F1F8}');
  const languages: string[] = Array.from(_v472_flagSet);
  const language: string = languages[0];
  
  // PATCH_V11A_PARSE_CACHE_SET
  const _result = { quality, source, size, seeders, title, language, languages, isForeign, isHEVC, isHDR, isCommentary };
  _parseStreamInfoCache.set(stream, _result);
  const _v19Result = _result;
  _parseStreamInfoCache.set(stream, _v19Result);
  return _v19Result;
}

// Sort streams: English first (by seeds desc), then other languages (by seeds desc)
// V157_WRONG_TITLE_GUARD â€” module-level mutable meta holder.  The
// details screen writes its current content here every render (before
// any useMemo runs), and sortStreamsByLanguage reads it as its first
// step.  This keeps the sort function's signature unchanged across
// the ~5 existing callsites.
let _v157_currentMeta: { title: string; year: string; isMovie: boolean; isSeries: boolean; seriesWords: string[] } = {
  title: '', year: '', isMovie: false, isSeries: false, seriesWords: [],
};

// V296_PM_CACHE_AWARENESS_BUILD_TAG â€” verification marker, never rendered.
//
// Module-level map of infoHash (lowercase) -> known-cached-on-PM boolean.
// Populated by a useEffect in the details component on streams load:
// calls PM's /cache/check API once per content, then sets entries here.
// sortStreamsByLanguage reads this to (a) only HARD-DROP watermarked
// streams when a clean+cached alternative exists, and (b) score cached
// streams much higher than uncached ones.
//
// Rationale (v296):
//   Pre-V292: Project Hail Mary picked the 1xbet stream because it was
//   the ONLY PM-cached torrent on the user's account.  V292 hard-filtered
//   it â†’ fell back to clean+uncached â†’ PM returned null â†’ "unable to
//   play video".  V296 makes the watermark filter conditional: only drop
//   dirty streams when at least one clean stream is cached.  Otherwise
//   keep dirty as a last-resort playable option.
const _V296_BUILD_TAG = 'V296_PM_CACHE_AWARENESS_BUILD_TAG';
void _V296_BUILD_TAG;
const _v296_cacheMap = new Map<string, boolean>();
// Per-content cache-check fingerprint so we only POST PM once per content
// per app session (not on every render).
const _v296_checkedKeys = new Set<string>();

// V161_SERIES_TITLE_GUARD â€” for series, build the set of required title
// words (length >= 3, non-stopword) and reject streams whose pre-SxxExx
// part is missing any of them.  Catches the "How It's Made" â†’ "How the
// States Got Their Shapes" case.
const _V161_STOPWORDS = new Set(['the','and','for','from','your','that','this','with','into']);
function _v161_seriesTitleWords(title: string): string[] {
  if (!title) return [];
  // strip trailing year suffix like " (2001)"
  const stripped = title.replace(/\s*\(\d{4}\)\s*$/, '');
  const tokens = stripped.toLowerCase().split(/[^a-z0-9]+/);
  return tokens.filter((w: string) => w.length >= 3 && !_V161_STOPWORDS.has(w));
}
function _v161_isWrongSeriesStream(stream: any, meta: { isSeries: boolean; seriesWords: string[] }): boolean {
  return false; // v233 client filters disabled â€” backend already returns only id-matched streams
  if (!meta.isSeries || !meta.seriesWords || meta.seriesWords.length === 0) return false;
  const raw = ((stream && (stream.title || '')) + ' ' + (stream && (stream.name || ''))).trim();
  if (!raw) return false;
  // Take the part BEFORE the first SxxExx so addon prefixes are kept
  // but episode/quality suffix is excluded.
  const m = raw.match(/^([\s\S]*?)\bS\d{1,2}E\d{1,3}\b/i);
  const head = m ? m[1] : raw;
  const headTokens = new Set(head.toLowerCase().split(/[^a-z0-9]+/).filter((w: string) => w.length >= 1));
  // Require ALL meta significant words to appear in the head tokens.
  for (const w of meta.seriesWords) {
    if (!headTokens.has(w)) return true; // reject
  }
  return false;
}

function _v157_romanToInt(s: string): number | null {
  const t = s.toUpperCase().trim();
  const vals: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  if (!t) return null;
  for (let i = 0; i < t.length; i++) { if (!(t[i] in vals)) return null; }
  let tot = 0, prev = 0;
  for (let i = t.length - 1; i >= 0; i--) {
    const v = vals[t[i]];
    tot += v < prev ? -v : v;
    prev = v;
  }
  return (tot >= 1 && tot <= 20) ? tot : null;
}

function _v157_extractSequelMarkers(text: string): Set<number> {
  const out = new Set<number>();
  if (!text) return out;
  const re = /\b(?:vol(?:ume)?\.?|part|chapter|episode|book)\s*(\d{1,2}|[IVXLC]{1,5})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tok = m[1];
    let n: number | null = null;
    if (/^\d+$/.test(tok)) n = parseInt(tok, 10);
    else n = _v157_romanToInt(tok);
    if (n !== null && n >= 1 && n <= 20) out.add(n);
  }
  // Trailing standalone number: "Rocky 4", "John Wick 2"
  const tm = text.trim().match(/(?:^|[^A-Za-z0-9])(\d{1,2})\s*$/);
  if (tm) {
    const n = parseInt(tm[1], 10);
    if (n >= 2 && n <= 20) out.add(n);
  }
  return out;
}

function _v157_isWrongTitleStream(stream: any, meta: { title: string; year: string; isMovie: boolean }): boolean {
  return false; // v233 client filters disabled â€” backend already returns only id-matched streams
  if (!meta.isMovie || !meta.title) return false;
  const txt = ((stream && (stream.title || '')) + ' ' + (stream && (stream.name || ''))).trim();
  if (!txt) return false;

  // 1) YEAR CHECK
  const reqYearN = parseInt((meta.year || '').slice(0, 4), 10);
  if (!isNaN(reqYearN) && reqYearN >= 1900 && reqYearN <= 2099) {
    const yMatches = txt.match(/\b(19\d{2}|20\d{2})\b/g);
    if (yMatches && yMatches.length > 0) {
      const years = yMatches.map(y => parseInt(y, 10));
      let anyOk = false;
      for (const y of years) { if (Math.abs(y - reqYearN) <= 1) { anyOk = true; break; } }
      if (!anyOk) return true; // reject â€” year mismatch
    }
  }

  // 2/3) SEQUEL MARKER CHECK
  const reqSeq = _v157_extractSequelMarkers(meta.title);
  const strSeq = _v157_extractSequelMarkers(txt);
  if (reqSeq.size > 0) {
    // Requested has a marker.  If stream has marker(s) and none overlap, reject.
    if (strSeq.size > 0) {
      let overlap = false;
      for (const n of strSeq) { if (reqSeq.has(n)) { overlap = true; break; } }
      if (!overlap) return true;
    }
  } else {
    // Requested has NO marker.  If stream has one, reject.
    if (strSeq.size > 0) return true;
  }
  return false;
}

// V312_SORT_MEMO - single-entry cache keyed by the input array IDENTITY.
// Same `streams` ref returns the cached output instantly, eliminating the
// 3-4 redundant sort passes that fire from inline (non-memoized) call
// sites within a single render.  When streams state updates (new ref),
// the cache misses and we recompute exactly once.
let _v312_sortCacheInput: Stream[] | null = null;
let _v312_sortCacheOutput: Stream[] | null = null;
// V747_PORNTUBE_NATIVE_TRUST
function _v747TrustedPornTubeStream(
  contentId: any,
  contentMeta: any,
  stream: any
): boolean {
  try {
    const key = String(contentId || '')
      .trim()
      .toLowerCase();

    if (
      !key.startsWith('pt:') &&
      !key.startsWith('porndb:')
    ) {
      return false;
    }

    const metaKey = String(
      contentMeta?.id ||
      contentMeta?.imdb_id ||
      ''
    )
      .trim()
      .toLowerCase();

    if (!metaKey || metaKey !== key) {
      return false;
    }

    const addon = String(
      stream?.addon ||
      ''
    )
      .trim()
      .toLowerCase();

    if (addon !== 'porn tube') {
      return false;
    }

    const hash = String(
      stream?.infoHash ||
      stream?.info_hash ||
      ''
    )
      .trim()
      .toLowerCase();

    return /^[a-f0-9]{40}$/.test(hash);
  } catch (_) {
    return false;
  }
}

// V783P_ASA_NATIVE_TRUST
function _v783pTrustedAsaStream(
  contentId: any,
  contentMeta: any,
  stream: any
): boolean {
  try {
    const key = String(contentId || '')
      .trim()
      .toLowerCase();

    if (
      !key.startsWith('knaben:') &&
      !key.startsWith('pornrips:')
    ) {
      return false;
    }

    const metaKey = String(
      contentMeta?.id ||
      contentMeta?.imdb_id ||
      ''
    )
      .trim()
      .toLowerCase();

    if (!metaKey || metaKey !== key) {
      return false;
    }

    const addon = String(
      stream?.addon ||
      ''
    )
      .trim()
      .toLowerCase();

    if (addon !== 'adult videos') {
      return false;
    }

    const hash = String(
      stream?.infoHash ||
      stream?.info_hash ||
      ''
    )
      .trim()
      .toLowerCase();

    return /^[a-f0-9]{40}$/.test(hash);
  } catch (_) {
    return false;
  }
}

function _v783pTrustedAdultNativeStream(
  contentId: any,
  contentMeta: any,
  stream: any
): boolean {
  return (
    _v747TrustedPornTubeStream(
      contentId,
      contentMeta,
      stream
    ) ||
    _v783pTrustedAsaStream(
      contentId,
      contentMeta,
      stream
    )
  );
}
// V759_ADULT_TRANSCODE_ROUTE
function _v759AdultNeedsTranscode(
  contentId: any,
  contentMeta: any,
  stream: any,
  file: any
): boolean {
  if (
    !_v747TrustedPornTubeStream(
      contentId,
      contentMeta,
      stream
    )
  ) {
    return false;
  }

  const probe = [
    file?.path,
    file?.name,
    file?.filename,
    stream?.title,
    stream?.name,
    contentMeta?.name,
    contentMeta?.title,
    contentMeta?.releaseInfo,
  ]
    .map(
      (value) => String(value || '')
    )
    .join(' ');

  return (
    /(?:^|[^A-Z0-9])8K(?:[^A-Z0-9]|$)/i.test(probe) ||
    /(?:^|[^A-Z0-9])6K(?:[^A-Z0-9]|$)/i.test(probe) ||
    /(?:^|[^A-Z0-9])5(?:\.7)?K(?:[^A-Z0-9]|$)/i.test(probe) ||
    /\b(?:4096|4320|5760)P\b/i.test(probe) ||
    /\b(?:8192|7680|6144|5760)[xX]\d+\b/.test(probe)
  );
}


async function _v759MaybeCreateAdultTranscodeUrl(
  contentId: any,
  contentMeta: any,
  stream: any,
  file: any
): Promise<string> {
  const directUrl =
    String(
      file?.link || ''
    ).trim();

  if (!directUrl) {
    return directUrl;
  }

  if (
    !_v759AdultNeedsTranscode(
      contentId,
      contentMeta,
      stream,
      file
    )
  ) {
    return directUrl;
  }

  try {
    const authToken =
      await AsyncStorage.getItem(
        'auth_token'
      );

    const backendUrl =
      String(
        process.env.EXPO_PUBLIC_BACKEND_URL ||
        Constants.expoConfig?.extra?.backendUrl ||
        ''
      )
        .trim()
        .replace(/\/+$/, '');

    if (!authToken || !backendUrl) {
      console.warn(
        '[V759 ADULT TRANSCODE] unavailable; using original URL'
      );

      return directUrl;
    }

    const response =
      await fetch(
        backendUrl +
          '/api/adult/transcode/session',
        {
          method: 'POST',
          headers: {
            'Authorization':
              'Bearer ' + authToken,
            'Accept':
              'application/json',
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            source_url: directUrl,
            content_id: String(
              contentId || ''
            ),
          }),
        }
      );

    if (!response.ok) {
      console.warn(
        '[V759 ADULT TRANSCODE] session rejected',
        response.status
      );

      return directUrl;
    }

    const payload: any =
      await response.json();

    const path =
      String(
        payload?.path || ''
      ).trim();

    if (
      !path.startsWith(
        '/api/adult/transcode/'
      )
    ) {
      console.warn(
        '[V759 ADULT TRANSCODE] invalid session response'
      );

      return directUrl;
    }

    const playbackUrl =
      backendUrl + path;

    console.log(
      '[V759 ADULT TRANSCODE] route',
      String(contentId || ''),
      _v672MediaBasename(
        file?.path ||
        file?.name ||
        file?.link ||
        ''
      ),
      '->1920w H264/AAC'
    );

    return playbackUrl;

  } catch (error: any) {
    console.warn(
      '[V759 ADULT TRANSCODE] setup failed',
      String(
        error?.message ||
        error ||
        ''
      )
    );

    return directUrl;
  }
}


function _v747MovieIdentityMatches(
  contentId: any,
  contentMeta: any,
  stream: any,
  requestedTitle: any,
  requestedYear: any,
  candidateIdentity: any
): boolean {
  return (
    _v745MovieIdentityMatches(
      requestedTitle,
      requestedYear,
      candidateIdentity
    ) ||
    _v783pTrustedAdultNativeStream(
      contentId,
      contentMeta,
      stream
    )
  );
}

// V441_MOVIE_TITLE_MATCH_PACK_GUARD - stronger than v440. See patch_v441.ps1.
function _v441_movieTitleMatch(filePath: string, movieTitle: string, movieYear: any): number {
  if (!filePath || !movieTitle) return 0;
  const _norm = (s: string) => String(s || '')
    .toLowerCase()
    .replace(/\[.*?\]|\(.*?\)/g, ' ')
    .replace(/[._\-:'!,?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const _stop = new Set(['the','a','an','of','and','in','on','for','to','with','part','vol','volume']);
  const _tokens = (s: string) => _norm(s).split(' ').filter((t: string) => t.length >= 2 && !_stop.has(t));
  const fileTokens = new Set(_tokens(filePath));
  const titleTokens = _tokens(movieTitle);
  if (titleTokens.length === 0) return 1; // no title -> no penalty
  let hits = 0;
  for (const t of titleTokens) if (fileTokens.has(t)) hits++;
  const ratio = hits / titleTokens.length;

  // W121ZOD5A_MOVIE_IDENTITY_GATE
  // A year match alone must never make an unrelated title valid.
  if (ratio <= 0) {
    return 0;
  }

  // When both canonical metadata and the candidate advertise
  // a movie year, require the exact canonical year.
  const _v441CanonicalYear =
    parseInt(String(movieYear || '').slice(0, 4), 10);

  if (
    !isNaN(_v441CanonicalYear) &&
    _v441CanonicalYear >= 1900 &&
    _v441CanonicalYear <= 2099
  ) {
    const _v441CandidateYears =
      String(filePath || '').match(/\b(19\d{2}|20\d{2})\b/g);

    if (
      _v441CandidateYears &&
      _v441CandidateYears.length > 0
    ) {
      const _v441ExactYear =
        _v441CandidateYears.some(
          (candidateYear: string) =>
            parseInt(candidateYear, 10) === _v441CanonicalYear
        );

      if (!_v441ExactYear) {
        return 0;
      }
    }
  }

  let yearBonus = 0;
  if (movieYear) {
    const y = parseInt(String(movieYear).slice(0, 4), 10);
    if (!isNaN(y)) {
      const fileYears = String(filePath).match(/\b(19\d{2}|20\d{2})\b/g);
      if (fileYears) {
        for (const fy of fileYears) {
          if (Math.abs(parseInt(fy, 10) - y) <= 1) { yearBonus = 0.5; break; }
        }
      }
    }
  }
  return ratio + yearBonus;
}
function _v441_pickMovieFile(videos: any[], movieTitle: string, movieYear: any): any | null {
  if (!videos || videos.length === 0) return null;
  const _norm = (s: string) => String(s || '').toLowerCase().replace(/[._\-:'!,?]+/g,' ').replace(/\s+/g,' ').trim();
  const _stop = new Set(['the','a','an','of','and','in','on','for','to','with','part','vol','volume']);
  const _tokens = (s: string) => _norm(s).split(' ').filter((t: string) => t.length >= 2 && !_stop.has(t));
  const titleTokens = _tokens(movieTitle);
  const scored = videos.map((v: any) => ({
    v,
    score: _v441_movieTitleMatch(v.path || v.link || '', movieTitle, movieYear),
    size: v.size || 0,
  }));
  scored.sort((a: any, b: any) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.size - a.size;
  });
  const top = scored[0];
  // Strict refuse: title provided, has >=2 significant tokens, top file
  // matches less than half of them.  This catches BOTH multi-file packs
  // (Marvel MCU pack containing an Iron Man mkv) and single-file torrents
  // that are grossly mislabelled at the tracker level.
  if (titleTokens.length >= 2 && top.score < 0.5) {
    try { console.log('[V441] REFUSE: title="' + movieTitle + '" (' + titleTokens.length + ' toks) topScore=' + top.score.toFixed(2) + ' files=' + scored.length + ' topPath=' + String(top.v.path || '').slice(0, 100)); } catch (_) {}
    return null;
  }
  try { console.log('[V441] pick score=' + top.score.toFixed(2) + ' size=' + Math.round(top.size / 1e6) + 'MB path=' + String(top.v.path || '').slice(0, 100)); } catch (_) {}
  return top.v;
}
// Back-compat alias so any leftover v440 references keep working
const _v440_movieTitleMatch = _v441_movieTitleMatch;
const _v440_pickMovieFile = _v441_pickMovieFile;
// V441_END
/*
 * V672_HARD_REJECT_SAMPLE_MEDIA
 *
 * Sample/trailer/preview media is never valid episode/movie playback.
 * Explicitly labelled stream cards are removed before paint. Premiumize
 * file selection uses the actual basename so a parent torrent folder
 * cannot make sample.mp4 look like S03E03.
 */
function _v672MediaBasename(value: any): string {
  const raw = String(value || '').split(/[?#]/)[0].replace(/\\/g, '/');
  const base = raw.split('/').pop() || raw;
  try {
    return decodeURIComponent(base);
  } catch (_) {
    return base;
  }
}

function _v672IsSampleLikeMedia(value: any): boolean {
  const base = _v672MediaBasename(value);

  // W121ZOD108H4AF_ANIMATIC_HARD_REJECT
  // Featurettes and animatics are supplemental/pre-production media,
  // never the canonical movie/episode requested for automatic playback.
  return /(?:^|[._\-\s])(sample|trailer|preview|teaser|featurettes?|animatics?)(?:[._\-\s]|$)/i.test(base);
}

function _v672IsSampleLikeStream(stream: any): boolean {
  const blob = [
    stream?.title,
    stream?.name,
    stream?.filename,
    stream?.url,
    stream?.externalUrl,
    stream?.directUrl,
  ].filter(Boolean).join(' ');

  // W121ZOD108H4AF_ANIMATIC_HARD_REJECT
  // Keep parent-path metadata in this check: the proven bad S1E2
  // candidate was labelled Featurettes/Animatics even though its
  // basename alone was simply "02 - Lawnmower Dog.mkv".
  return /(?:^|[._\-\s\/\\])(sample|trailer|preview|teaser|featurettes?|animatics?)(?:[._\-\s\/\\]|$)/i.test(blob);
}

function _v672CleanStreamPool(input: Stream[]): Stream[] {
  const source = Array.isArray(input) ? input : [];
  const clean = source.filter((s: any) => !_v672IsSampleLikeStream(s));

  if (clean.length !== source.length) {
    console.log(
      '[V672 SAMPLE FILTER] dropped',
      source.length - clean.length,
      'explicit sample/trailer stream(s) of',
      source.length
    );
  }

  return clean;
}

function sortStreamsByLanguage(streams: Stream[]): Stream[] {
  /* V324_FORCE_4K - quality histogram of input streams so we can see
     whether 4K options are even reaching the scorer. */
  try {
    const _v324hist: { [k: string]: number } = {};
    let _v324bigCount = 0;
    let _v324big4kCount = 0;
    for (const _s of (streams || [])) {
      const _t = (((_s as any)?.title || '') + ' ' + ((_s as any)?.name || '')).toUpperCase();
      let _q = 'SD';
      if (_t.includes('4K') || _t.includes('2160')) _q = '4K';
      else if (_t.includes('1080')) _q = '1080p';
      else if (_t.includes('720')) _q = '720p';
      _v324hist[_q] = (_v324hist[_q] || 0) + 1;
      const _szm = _t.match(/([\d.]+)\s*GB/);
      const _sz = _szm ? parseFloat(_szm[1]) : 0;
      if (_sz >= 15) _v324bigCount++;
      if (_sz >= 15 && _q === '4K') _v324big4kCount++;
    }
    false && console.log('[V324 INPUT]', 'total=' + (streams || []).length, 'hist=' + JSON.stringify(_v324hist), 'bigStreams(>=15GB)=' + _v324bigCount, 'big4K=' + _v324big4kCount);
  } catch (_) {}
  // V312_SORT_MEMO fast-path
  if (_v312_sortCacheInput === streams && _v312_sortCacheOutput) {
    return _v312_sortCacheOutput;
  }
  const _v312_result = _v312_sortStreamsByLanguageImpl(streams);
  _v312_sortCacheInput = streams;
  _v312_sortCacheOutput = _v312_result;
  return _v312_result;
}
function _v312_sortStreamsByLanguageImpl(streams: Stream[]): Stream[] {
  streams = _v672CleanStreamPool(streams);
  // V292/V296 â€” gambling/spam watermark detection.  These rips have
  // hard-burned 1xbet/etc logos that ruin viewing.  We DETECT them
  // with these regexes so V296 can decide whether to hard-drop them
  // (only if a clean+cached PM alternative exists) or keep them as
  // last-resort fallback (avoids "unable to play video" on titles
  // whose only cached stream is watermarked, e.g. Project Hail Mary).
  // V317_STRICT_SPAM_DROP - expanded affiliate list seen on Torrentio.
  const _V292_WATERMARK_RE = /(1xbet|1xstavka|melbet|mostbet|parimatch|4rabet|dafabet|betway|bet365|22bet|stake\.com|ftcam|fxgg|hcam|ctcam|cam\.rip|hdcam|telesync|tsrip|tcrip|tc-?rip|cam-rip|new\.?source|sourceqr|sourcetv|x-?cam|hd-?cam)/i;
  // Be slightly less strict for the literal token "cam" (could be in a
  // legit URL) â€” require word boundaries for that one.
  const _V292_CAM_RE = /\b(cam|ts|tc)\b.*\b(rip|new|source)\b|\b(rip|new|source)\b.*\b(cam|ts|tc)\b/i;
  const _v296_isWatermark = (s: any): boolean => {
    // V317_STRICT_SPAM_DROP - also scan stream.url to catch spam URLs.
    const blob = `${s?.title || ''} ${s?.name || ''} ${s?.filename || ''} ${s?.url || ''}`;
    return _V292_WATERMARK_RE.test(blob) || _V292_CAM_RE.test(blob);
  };
  // V296 â€” check whether any CLEAN (non-watermarked) stream is known
  // PM-cached.  Only then is it safe to hard-drop the watermarked ones.
  // _v296_cacheMap is populated by the component's PM /cache/check effect.
  const _v296_cleanStreams = streams.filter((s: any) => !_v296_isWatermark(s));
  // V317_STRICT_SPAM_DROP - was a per-stream cached-check via some().
  // Now: any clean stream qualifies for the hard-drop (cached or not).
  // Renamed semantically (still uses _v296_hasCleanCached var so the
  // existing if/else block keeps compiling) - now means "hasCleanAny".
  const _v296_hasCleanCached = _v296_cleanStreams.length > 0;
  if (_v296_hasCleanCached) {
    const _before = streams.length;
    streams = _v296_cleanStreams;
    if (_before !== streams.length) {
      console.log('[v296] CLEAN+CACHED available â€” dropped', _before - streams.length, 'watermarked streams (of', _before + ')');
    }
  } else {
    // No clean+cached. Keep ALL streams (clean + watermarked) so the user
    // still gets playback â€” the score sort below ensures clean ranks
    // higher than watermarked.  This rescues titles like Project Hail Mary
    // whose only cached option is watermarked.
    const _wm = streams.filter(_v296_isWatermark).length;
    if (_wm > 0) {
      console.log('[v296] no clean+cached â€” keeping', _wm, 'watermarked stream(s) as fallback');
    }
  }
  // V337_ROBUST_BAIT_FILTER â€” fixes V334 misses by checking multiple fields and
  // normalizing the input. V334 only checked stream.name and assumed real
  // newlines; real Torrentio streams sometimes carry literal '\n' sequences
  // (escaped) instead of '\n' (newline char), which slipped past V334.
  //
  // V337 also drops bait DOMAINS in the URL itself (1xbet/melbet/etc.) in case
  // a bait stream's metadata is laundered clean but the URL still points at
  // an affiliate redirector.
  const _v337_normalize = (s: any): string => {
    return String(s || '')
      .replace(/\\n/g, ' ')
      .replace(/\\r/g, ' ')
      .replace(/\r|\n|\t/g, ' ')
      .replace(/[\[\]\(\)\|\.\-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();
  };
  const _V337_CAM_TOKENS = ['cam', 'hdcam', 'camrip', 'cam rip', 'hdts', 'hd ts', 'hdtc', 'hd tc', 'telesync', 'tsrip', 'ts rip', 'tcrip', 'tc rip', 'workprint', 'preair', 'screener', 'dvdscr', 'r5'];
  const _V337_BAIT_DOMAINS = /(1xbet|1xstavka|melbet|mostbet|parimatch|4rabet|dafabet|22bet|betway|bet365|stake\.com|olymptrade)/i;
  const _v337_isBait = (s: any): { bad: boolean; reason: string } => {
    const nameN  = _v337_normalize(s?.name);
    const titleN = _v337_normalize(s?.title);
    const fileN  = _v337_normalize(s?.filename);
    const url    = String(s?.url || '');
    // Look for CAM-class tokens as whole-word tokens in any normalized field.
    const blob = ' ' + nameN + ' | ' + titleN + ' | ' + fileN + ' ';
    for (const tok of _V337_CAM_TOKENS) {
      if (blob.indexOf(' ' + tok + ' ') !== -1) return { bad: true, reason: 'CAM:' + tok };
    }
    if (_V337_BAIT_DOMAINS.test(url))   return { bad: true, reason: 'bait-url-domain' };
    if (_V337_BAIT_DOMAINS.test(blob))  return { bad: true, reason: 'bait-name-mention' };
    return { bad: false, reason: '' };
  };
  {
    const _v337_before = streams.length;
    const _v337_kept: any[] = [];
    for (const s of streams) {
      const v = _v337_isBait(s);
      if (v.bad) {
        console.log('[v337 DROP]', v.reason, '|', String(s?.name || '').slice(0, 80).replace(/\s+/g, ' '));
      } else {
        _v337_kept.push(s);
      }
    }
    if (_v337_kept.length !== _v337_before) {
      console.log('[v337] kept', _v337_kept.length, 'of', _v337_before, 'streams');
    }
    streams = _v337_kept;
  }
  // V334_HARD_DROP_CAM â€” unconditionally drop CAM/HDCAM/TS/TC/TELESYNC/WORKPRINT/
  // SCR/DVDSCR quality streams. Unlike V296 (which keeps watermarked streams as
  // last-resort fallback), V334 hard-drops them. Reasoning: CAM-class streams
  // are 100% bait for unreleased titles (1xbet overlays burned in) and Premiumize
  // cannot resolve them â€” they cause 30-sec "stream timeout" errors.
  const _V334_CAM_QUALITY_RE = /(?:^|\n|\[|\||\s)(cam|hdcam|cam-?rip|camrip|hd-?ts|hdtc|telesync|tsrip|tcrip|workprint|preair|scr|dvdscr|screener|r5)(?:\s|\n|\]|\||$)/i;
  {
    const _v334_before = streams.length;
    streams = streams.filter((s: any) => {
      const name = String(s?.name || '');
      return !_V334_CAM_QUALITY_RE.test(name);
    });
    if (_v334_before !== streams.length) {
      console.log('[v334] dropped', _v334_before - streams.length, 'CAM-quality streams (of', _v334_before + ')');
    }
  }
  // V157_FILTER_APPLIED â€” reject streams from other movies (wrong year /
  // wrong sequel volume) before any sort runs.  Conservative: only
  // applies for movies, never for series.  Reads _v157_currentMeta
  // which is set by the details component on every render.
  if (_v157_currentMeta.isMovie && _v157_currentMeta.title) {
    const _v157_before = streams.length;
    const _v157_kept: Stream[] = [];
    let _v157_rej = 0;
    for (const _s of streams) {
      if (_v157_isWrongTitleStream(_s as any, _v157_currentMeta)) { _v157_rej++; continue; }
      _v157_kept.push(_s);
    }
    if (_v157_rej > 0) {
      console.log('[v157] wrong-title filter for', JSON.stringify(_v157_currentMeta.title), 'year=', _v157_currentMeta.year, 'kept', _v157_kept.length + '/' + _v157_before, '(rejected', _v157_rej + ')');
    }
    streams = _v157_kept;
  }
  // V161_SERIES_FILTER_APPLIED â€” same idea as v157, but for series.
  // Reject streams whose pre-SxxExx prefix is missing any of the
  // required series-title words.
  if (_v157_currentMeta.isSeries && _v157_currentMeta.seriesWords && _v157_currentMeta.seriesWords.length > 0) {
    const _v161_before = streams.length;
    const _v161_kept: Stream[] = [];
    let _v161_rej = 0;
    for (const _s of streams) {
      if (_v161_isWrongSeriesStream(_s as any, _v157_currentMeta)) { _v161_rej++; continue; }
      _v161_kept.push(_s);
    }
    if (_v161_rej > 0) {
      console.log('[v161] series-title filter for', JSON.stringify(_v157_currentMeta.title), 'words=', JSON.stringify(_v157_currentMeta.seriesWords), 'kept', _v161_kept.length + '/' + _v161_before, '(rejected', _v161_rej + ')');
    }
    streams = _v161_kept;
  }
  // PATCH_V16A_COMMENTARY_SINK â€” local commentary detector. Independent of V12/V9.
  // Tested: 'Commentary', 'Audio Commentary', 'Director Commentary',
  // 'Creator Comm', '[COMM]', 'Comm.', 'with commentary', etc.
  const _isCommentaryStream = (s: any): boolean => {
    const t = (((s?.title || '') + ' ' + (s?.name || '')).toUpperCase());
    if (!t) return false;
    if (t.includes('COMMENTARY')) return true;
    if (t.includes('CREATOR COMM')) return true;
    if (t.includes('DIRECTOR COMM')) return true;
    if (t.includes('WRITERS COMM') || t.includes('WRITER COMM')) return true;
    if (t.includes('WITH COMM')) return true;
    if (t.includes('AUDIO COMM')) return true;
    if (t.includes('COMM TRACK') || t.includes('COMM-TRACK') || t.includes('COMM.TRACK')) return true;
    if (/\[\s*COMM[^\]]*\]/.test(t)) return true;
    if (/\bCOMM\.\s/.test(t)) return true;
    return false;
  };
  // Parse all stream info first
  const parsed = streams.map(s => ({ stream: s, info: parseStreamInfo(s) }));

  // Language priority: ENG > MULTI > everything else alphabetically
  const langPriority = (lang: string): number => {
    if (lang === 'ENG') return 0;
    if (lang === 'MULTI') return 1;
    return 2;
  };

  // Sort priority (topâ†’bottom):
  //   1. Streams with a DIRECT URL (debrid-cached, e.g. Premiumize) â€” instant play
  //   2. Streams with infoHash only (uncached torrent, needs debrid resolve or BT)
  //   3. Within each group: ENG â†’ MULTI â†’ other languages, then higher seeders first
  //
  // This was the root cause of "all streams failed" after RD premium expired â€”
  // the previous sort put infoHash streams FIRST, so every Play click tried RD
  // (which 403'd) instead of a cached Premiumize URL that would have played instantly.
  // PATCH_V9_SCORED_SORT â€” produces a stable, consistent best pick across every episode.
  // English+quality dominate; codec/HDR penalties keep Firestick happy; direct URL is
  // a tiebreaker (instant Premiumize) that never overrides quality.
  /* v121b-quality-boost */ const QUALITY_PTS: Record<string, number> = { '4K': 400, '1080p': 1200, '720p': 400, 'HD': 300, 'SD': 0 }; /* V453_PREFER_1080P_SDR_QUALITY_PTS */
  const computeScore = (info: ReturnType<typeof parseStreamInfo>, stream: Stream): number => {
    let s = 0;
    // V296_PM_CACHE_BONUS â€” huge boost for streams known cached on Premiumize
    // and corresponding penalty for known-uncached.  Unknown = neutral.
    // This guarantees we pick a cached stream when one exists, even if a
    // non-cached one has slightly higher technical quality.
    if (stream && stream.infoHash) {
      const _v296cached = _v296_cacheMap.get(String(stream.infoHash).toLowerCase());
      if (_v296cached === true) s += 5000;
      else if (_v296cached === false) s -= 2000;
    }
    // V296_WATERMARK_SOFT_PENALTY â€” keeps watermarked streams in the pool
    // but ranks them last.  Combined with the conditional hard-drop above,
    // they only ever get picked when no cleaner alternative exists.
    {
      // V317_STRICT_SPAM_DROP - blob now includes stream.url; penalty
      // bumped from -1500 to -12000 so a watermarked stream can never
      // outrank a clean one even when it has every other bonus stacked.
      const _v296wmBlob = `${(stream as any)?.title || ''} ${(stream as any)?.name || ''} ${(stream as any)?.filename || ''} ${(stream as any)?.url || ''}`;
      const _V296_WM_RE = /(1xbet|1xstavka|melbet|mostbet|parimatch|4rabet|dafabet|betway|bet365|22bet|stake\.com|ftcam|fxgg|hcam|ctcam|cam\.rip|hdcam|telesync|tsrip|tcrip|tc-?rip|cam-rip|new\.?source|sourceqr|sourcetv|x-?cam|hd-?cam)/i;
      const _V296_CAM_RE = /\b(cam|ts|tc)\b.*\b(rip|new|source)\b|\b(rip|new|source)\b.*\b(cam|ts|tc)\b/i;
      if (_V296_WM_RE.test(_v296wmBlob) || _V296_CAM_RE.test(_v296wmBlob)) s -= 12000;
    }
    // PATCH_V12_COMMENTARY_PENALTY â€” guarantee commentary tracks rank LAST
    if (info.isCommentary) s -= 2000;
    // PATCH_V18_BLURAY_SERIES_PENALTY â€” Blu-ray rips of series often have creator commentary as the
    // DEFAULT audio track (R&M, Family Guy, Rick & Morty, etc.). expo-av can't
    // switch tracks, so we deprioritize series Blu-rays in favor of WEB-DL/WEBRip
    // which come from streaming services that never include commentary.
    {
      const _t18 = ((stream.title || '') + ' ' + (stream.name || '')).toUpperCase();
      const _isSeriesEp = /S\d{1,2}E\d{1,2}\b/i.test(_t18) || /\b\d{1,2}X\d{1,2}\b/i.test(_t18);
      const _isBluRayLike = _t18.includes('BLURAY') || _t18.includes('BLU-RAY') || _t18.includes('BDRIP') || _t18.includes('BD-RIP') || _t18.includes('REMUX');
      if (_isSeriesEp && _isBluRayLike) s -= 300;
    }
    if (info.language === 'ENG') s += 1000;
    else if (info.language === 'MULTI') s += 900;
    else s += 100;
    s += QUALITY_PTS[info.quality] || 0;
    /* V320_SIZE_BONUS - bigger files = better visual quality
       (higher bitrate REMUX/BluRay vs low-bitrate WEB-DL). */
    {
      const _v320size = (info.size || '').toString().toUpperCase();
      const _v320m = _v320size.match(/([\d.]+)\s*(GB|MB)/);
      if (_v320m) {
        const _v320n = parseFloat(_v320m[1]);
        const _v320GB = _v320m[2] === 'GB' ? _v320n : (_v320n / 1024);
        if (_v320GB > 20)      s += 1500;
        else if (_v320GB > 10) s += 800;
        else if (_v320GB > 5)  s += 300;
        // V321_SANITY_MIN_SIZE - minimum-size floors per quality tier.
        // Anything claiming 4K under 10GB is almost guaranteed a fake/
        // transcoded torrent.  Heavily penalize so they lose to real
        // uncached high-bitrate rips even with the PM cache bonus.
        if (info.quality === '4K') {
          if (_v320GB > 0 && _v320GB < 6)        s -= 8000;
          else if (_v320GB > 0 && _v320GB < 10)  s -= 4000;
        } else if (info.quality === '1080p') {
          if (_v320GB > 0 && _v320GB < 1.5)      s -= 3000;
          else if (_v320GB > 0 && _v320GB < 2.5) s -= 1000;
        } else if (info.quality === '720p') {
          if (_v320GB > 0 && _v320GB < 0.5)      s -= 1500;
        }
        // V322_DEBUG_SCORER - log size/quality/score every stream parsed.
        try {
          const _v322name = ((stream as any)?.title || (stream as any)?.name || '').slice(0, 60).replace(/\n/g, ' ');
          false && console.log('[V322] q=' + info.quality + ' size="' + (info.size || '') + '" GB=' + (_v320m ? _v320GB.toFixed(2) : 'NONE') + ' cached=' + (!!stream.url) + ' score=' + s + ' | ' + _v322name);
        } catch (_) {}
      } else {
        try {
          const _v322name = ((stream as any)?.title || (stream as any)?.name || '').slice(0, 60).replace(/\n/g, ' ');
          false && console.log('[V322 NO-SIZE] q=' + info.quality + ' cached=' + (!!stream.url) + ' score=' + s + ' | ' + _v322name);
        } catch (_) {}
      }
    }
    /* V323_STRICT_ENGLISH - aggressive foreign-language detection.
       parseStreamInfo missed VOSTFR / Cyrillic / MULTi, so apply a
       heavy penalty here in computeScore where we have the raw text. */
    {
      const _v323blob = ((stream as any)?.title || '') + ' ' + ((stream as any)?.name || '') + ' ' + ((stream as any)?.filename || '');
      const _v323upper = _v323blob.toUpperCase();
      // Cyrillic char range U+0400..U+04FF
      const _v323HasCyrillic = /[\u0400-\u04FF]/.test(_v323blob);
      // CJK ranges (Korean Hangul, Japanese Hiragana/Katakana, Chinese)
      const _v323HasCJK = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(_v323blob);
      const _v323foreignTags = (
        /\bVOSTFR\b|\bVOSTA\b|\bVFF\b|\bVFQ\b|\bVO\b|\bVF\b/.test(_v323upper) ||
        /\bFRENCH\b|\bFRA\b|\bFR-?[\d]+\b/.test(_v323upper) ||
        /\bITALIAN\b|\bITA\b|\bIT\b\.|\.IT\.|\bITA-/.test(_v323upper) ||
        /\bGERMAN\b|\bGER\b|\bDEU\b|\bDEUTSCH\b/.test(_v323upper) ||
        /\bSPANISH\b|\bESP\b|\bESPANOL\b|\bLATIN\b|\bLATINO\b|\bCASTELLANO\b/.test(_v323upper) ||
        /\bRUSSIAN\b|\bRUS\b|\bUKR\b|\bUKRAINIAN\b/.test(_v323upper) ||
        /\bKOREAN\b|\bKOR\b|\bJAPANESE\b|\bJPN\b|\bJAP\b/.test(_v323upper) ||
        /\bPOLISH\b|\bPL\b\.|\.PL\.|\bPL-/.test(_v323upper) ||
        /\bTURKISH\b|\bTUR\b|\bTRK\b/.test(_v323upper) ||
        /\bHINDI\b|\bHIN\b|\bTAMIL\b|\bTAM\b|\bTELUGU\b|\bTEL\b/.test(_v323upper) ||
        /\bPORTUGUESE\b|\bPOR\b|\bPT-BR\b|\bBRAZILIAN\b/.test(_v323upper) ||
        /\bDUTCH\b|\bNLD\b|\bNED\b/.test(_v323upper) ||
        /\bMULTI\b|\bMULTI-AUDIO\b|\bDUAL\b|\bDUAL-AUDIO\b|\bMULTI-LANG\b/.test(_v323upper)
      );
      const _v323isForeign = _v323HasCyrillic || _v323HasCJK || _v323foreignTags;
      if (_v323isForeign) {
        s -= 5000;
        try {
          false && console.log('[V323] FOREIGN penalty -5000 (cyrillic=' + _v323HasCyrillic + ' cjk=' + _v323HasCJK + ' tags=' + _v323foreignTags + ') | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
        } catch (_) {}
      }
      /* V324_FORCE_4K - lock auto-pick to large 4K English streams.
         A legit big 4K rip in English now beats every other option by
         margin >2000.  Foreign 4K streams still lose because V323
         already subtracted 5000 above. */
      if (info.quality === '4K' && !_v323isForeign) {
        // Parse size from the same blob we already built.
        const _v324szM = (_v323blob + ' ' + (info.size || '')).toUpperCase().match(/([\d.]+)\s*GB/);
        const _v324GB = _v324szM ? parseFloat(_v324szM[1]) : 0;
        if (_v324GB >= 15) {
          s += 0; /* V453_KILL_V324_BIG - was +6000 */
          try {
            false && console.log('[V324] BIG-4K bonus +6000 size=' + _v324GB + 'GB | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
          } catch (_) {}
        } else if (_v324GB >= 8) {
          s += 0; /* V453_KILL_V324_MID - was +2000 */
          try {
            false && console.log('[V324] MID-4K bonus +2000 size=' + _v324GB + 'GB | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
          } catch (_) {}
        }
      }
      /* V325_WEBDL_OVER_WEBRIP - prefer clean WEB-DL rips over
         screen-captured WEBRip torrents (which often carry burned-in
         1xbet/affiliate overlays even when filename looks clean). */
      {
        const _v325upper = _v323blob.toUpperCase();
        const _v325isWebDl = /\bWEB-?DL\b/.test(_v325upper);
        const _v325isWebRip = /\bWEBRIP\b|\bWEB-?RIP\b/.test(_v325upper) && !_v325isWebDl;
        const _v325hasAtmos = /\bATMOS\b/.test(_v325upper);
        const _v325hasHevc = /\bH\.?265\b|\bHEVC\b|\bX265\b/.test(_v325upper);
        if (_v325isWebDl && !_v323isForeign) {
          s += 4000;
          if (_v325hasAtmos && _v325hasHevc) {
            s += 1500;
            /* V366_KILL_SCORER_LOGS_BUILD_TAG - silenced: fired per-stream
               inside the sort; 24+ bridge logs per details open. */
            try {
              false && console.log('[V325] WEB-DL+Atmos+HEVC combo +5500 | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
            } catch (_) {}
          } else {
            try {
              false && console.log('[V325] WEB-DL bonus +4000 | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
            } catch (_) {}
          }
        }
        if (_v325isWebRip) {
          s -= 3000;
          try {
            false && console.log('[V325] WEBRip penalty -3000 (often burned ad overlay) | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
          } catch (_) {}
        }
      }
    }
    /* v121e-codec-penalty */ /* v127-codec-rebalance */ /* V272_FIRESTICK_HEVC â€” Firestick's HEVC decoder is unreliable; bump non-HEVC bonus from +100 to +300 and add explicit HEVC penalty. */ /* V319_QUALITY_FIRST */ if (!info.isHEVC) s += 0; else s += 200;
    /* PATCH_V150_HDR â€” keep SDR bonus, add real HDR penalty so SDR at any
       resolution always wins over HDR (display can't tone-map â†’ dark image).
       V272_SDR_FIRESTICK â€” Firestick output washes HDR colors on SDR TVs.
       Bumped HDR penalty -800 â†’ -3000 so SDR ALWAYS wins when both exist,
       while still allowing HDR-only titles to play (cascading fallback). */
    /* V351b_HDR_NUKE */ if (!info.isHDR) s += 0; else s -= 8000;
    /* V272_DOLBY_VISION â€” DV is worst on non-DV displays (green/purple tint).
       Extra penalty so HDR10 beats DV when both are available. */
    {
      const _v272t = ((stream.title || '') + ' ' + (stream.name || '')).toUpperCase();
      const _v272IsDV = (
        _v272t.includes('DOLBY VISION') || _v272t.includes('DOLBYVISION')
        || /\bDV\b/.test(_v272t) || /[\.\- ]DV[\.\- ]/.test(_v272t)
      );
      /* V339_STRONGER_DV */ if (_v272IsDV) s -= 5000;
    }
    /* V339_QXR_PENALTY - QxR/r00t MKVs use ContentCompAlgo compression that
       ExoPlayer 2.18.1 cannot parse. Playback fails immediately with a source
       error even when the file is otherwise fine. Bump these down so they
       only get picked when nothing else exists. */
    {
      const _v339t = (String(stream.title || '') + ' ' + String(stream.name || '')).toUpperCase();
      const _v339IsProblematic = (
        _v339t.indexOf('[QXR]') !== -1 || _v339t.indexOf(' QXR ') !== -1 || _v339t.indexOf('.QXR.') !== -1
        || _v339t.indexOf('[R00T]') !== -1 || _v339t.indexOf(' R00T') !== -1 || _v339t.indexOf('R00T)') !== -1
      );
      if (_v339IsProblematic) {
        s -= 2500;
        /* V370_KILL_HOT_LOG - fired inside computeScore (hot path). */
        false && console.log('[V339] QxR/r00t penalty -2500 |', String(stream.name || '').slice(0, 80));
      }
    }
    /* V158_AUDIO_PENALTY â€” reject lossless / ExoPlayer-incompatible audio.
       Triggered by the real bug: GOTG 2 picked a BluRay REMUX with
       DTS-HD MA 7.1, and ExoPlayer's AudioTrack.init() failed with
       Config(48000, 6396, 47998).  Penalize -1500 so any AC3/AAC
       WEB-DL/BluRay stream ranks above. */
    {
      const _t158 = ((stream.title || '') + ' ' + (stream.name || '')).toUpperCase();
      const _v158_badAudio = (
        _t158.includes('DTS-HD MA') || _t158.includes('DTS-HD.MA') || _t158.includes('DTS HD MA')
        || _t158.includes('DTSHD-MA') || _t158.includes('DTSHD.MA')
        || _t158.includes('DTS-HD ') || _t158.includes('DTS-HD.') || _t158.includes('DTS.HD')
        || _t158.includes('DTS-HR') || _t158.includes('DTS-HRA')
        || _t158.includes('DTS-X') || _t158.includes('DTS:X') || _t158.includes('DTSX')
        || _t158.includes('TRUEHD') || _t158.includes('TRUE-HD') || _t158.includes('TRUE.HD')
        || _t158.includes('ATMOS')
        || _t158.includes('LPCM') || _t158.includes(' PCM ') || _t158.includes('.PCM.')
        || _t158.includes('REMUX')
      );
      /* V358_KILL_LOSSLESS */ if (_v158_badAudio) s -= 20000;
    }
    /* PATCH_V146_AUDIO_PENALTY â€” penalize audio codecs that the Google TV
       Streamer / Firestick can't initialize at runtime even when ExoPlayer
       reports format_supported=YES.  Order matters: most specific first. */
    {
      const _v146t = ((stream.title || '') + ' ' + (stream.name || '')).toUpperCase();
      /* V358_STRONG_AUDIO */
        if (/\bDTS[\s\-:]?X\b|\bDTSX\b/.test(_v146t)) {
          s -= 8000;
        } else if (/\bTRUEHD\b|\bTRUE[\s\-]?HD\b/.test(_v146t)) {
          s -= 8000;
        } else if (/\bATMOS\b/.test(_v146t)) {
          s -= 6000;
        } else if (/\bDTS[\s\-]?HD(\s*MA)?\b/.test(_v146t)) {
          s -= 10000;
        } else if (/\bDTS\b/.test(_v146t)) {
          s -= 2000;
        }
    }
    /* v141-cached-first-seeds-matter */
    // Cached / direct URL boost is now a partition gate â€” see below.  Keep
    // a small intra-bucket nudge so tied cached streams prefer ones with
    // a working URL set.
    if (stream.url) s += 50;
    const sd = info.seeders || 0;
    // V351: boosted seeder cap from +240 to +500 â€” high-seed streams reliable
    /* V354_SEEDER_HEAVY â€” seeders scale up to +1200; a 1000-seed stream
       beats a 5-seed one by ~1000pts. Reliability > quality tags. */
    if (sd > 0) s += Math.min(Math.log10(sd + 1) * 320, 1200);
    /* V354_LOW_SEED_PENALTY â€” <3 seeders is essentially dead. Nuke them
       from contention so they never win auto-play. */
    if (sd < 3) s -= 10000;
    /* V351_TPB_BOOST â€” ThePirateBay + torrentio-with-tpb-in-title streams
       are the most reliable historically. Boost source explicitly. */
    {
      const _v351t = (info.title || stream.title || stream.name || '').toLowerCase();
      const _v351src = (info.source || '').toLowerCase();
      if (_v351src.includes('thepiratebay') || _v351src === 'tpb' ||
          /\btpb\b|thepiratebay|pirate\s*bay/.test(_v351t)) {
        s += 2000;
      }
    }
    /* V171_STABLE_TIEBREAKER â€” add a tiny deterministic value from a
       stable hash of infoHash/URL/title.  Magnitude < 0.1 so it CANNOT
       override any real score difference (quality / codec / language /
       seeders all weigh hundreds of points), but it pins the order of
       tied streams so back-nav + re-pick gives the SAME result every
       time regardless of which addon source happened to respond first. */
    {
      const _v171Key = String((stream as any).infoHash || stream.url || stream.title || stream.name || '');
      if (_v171Key) {
        let _v171H = 0;
        const _v171N = Math.min(_v171Key.length, 40);
        for (let _v171i = 0; _v171i < _v171N; _v171i++) {
          _v171H = ((_v171H << 5) - _v171H + _v171Key.charCodeAt(_v171i)) | 0;
        }
        s += ((Math.abs(_v171H) % 1000) / 10000); // range [0, 0.0999]
      }
    }
    return s;
  };
  // v141: HARD partition â€” every CACHED stream (stream.url present) sorts
  // above every UNCACHED stream, regardless of quality/score.  Inside each
  // bucket the score sort (cached-first, then quality, then seeders) wins.
  // V357_SDR_HARD_PARTITION - SDR always beats HDR
    const _v357_isHdr = (p) => !!(p && p.info && p.info.isHDR);
    /* V398_ENGLISH_WALL - language is now the TOPMOST wall. The cached
       partition used to run above language, so a PM-cached foreign release
       always beat every uncached English stream (V323's -5000 only reorders
       WITHIN a bucket). All foreign streams now go to the very back.
       Detection widened: flag emojis, CJK, MULTi/DUAL, short lang tags. */
    const _v398IsForeign = (p: any): boolean => {
      try {
        if (p && p.info && p.info.isForeign === true) return true;
        const _raw = String((p && p.stream && ((p.stream as any).title || (p.stream as any).name || (p.stream as any).filename)) || '');
        if (/[\u0400-\u04FF]/.test(_raw)) return true; /* Cyrillic */
        if (/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(_raw)) return true; /* CJK */
        const _fl = _raw.match(/\uD83C[\uDDE6-\uDDFF]\uD83C[\uDDE6-\uDDFF]/g) || [];
        const _engFl = ['\uD83C\uDDEC\uD83C\uDDE7', '\uD83C\uDDFA\uD83C\uDDF8', '\uD83C\uDDE8\uD83C\uDDE6', '\uD83C\uDDE6\uD83C\uDDFA', '\uD83C\uDDF3\uD83C\uDDFF', '\uD83C\uDDEE\uD83C\uDDEA'];
        for (let _i = 0; _i < _fl.length; _i++) { if (_engFl.indexOf(_fl[_i]) === -1) return true; }
        const _u = _raw.toUpperCase().replace(/MULTI[\s.\-]?SUBS?/g, '');
        if (/\bVOSTFR\b|\bVOSTA\b|\bVFF\b|\bVFQ\b|\bTRUEFRENCH\b|\bFRENCH\b|\bFRA\b/.test(_u)) return true;
        if (/\bGERMAN\b|\bDEUTSCH\b|\bGER\b|\bDEU\b/.test(_u)) return true;
        if (/\bITALIAN\b|\bITALIANO\b|\bITA\b/.test(_u)) return true;
        if (/\bSPANISH\b|\bESPANOL\b|\bCASTELLANO\b|\bLATINO\b/.test(_u)) return true;
        if (/\bRUSSIAN\b|\bRUS\b|\bUKRAINIAN\b|\bUKR\b/.test(_u)) return true;
        if (/\bKOREAN\b|\bKOR\b|\bJAPANESE\b|\bJPN\b|\bCHINESE\b|\bCHS\b|\bCHT\b/.test(_u)) return true;
        if (/\bPOLISH\b|\bLEKTOR\b|\bTURKISH\b|\bHINDI\b|\bTAMIL\b|\bTELUGU\b|\bDUBLADO\b|\bPORTUGUESE\b|\bDUTCH\b/.test(_u)) return true;
        if (/\bMULTI\b|\bMULTI[\s.\-]?AUDIO\b|\bDUAL\b|\bDUAL[\s.\-]?AUDIO\b|\bDUBBED\b/.test(_u)) return true;
        return false;
      } catch (_) { return false; }
    };
    let _v398eng = parsed.filter((p) => !_v398IsForeign(p));
    const _v398for = parsed.filter((p) => _v398IsForeign(p));
    const _v357_cSdr = _v398eng.filter((p) => !!p.stream.url && !_v357_isHdr(p));
    const _v357_cHdr = _v398eng.filter((p) => !!p.stream.url && _v357_isHdr(p));
    const _v357_uSdr = _v398eng.filter((p) => !p.stream.url && !_v357_isHdr(p));
    const _v357_uHdr = _v398eng.filter((p) => !p.stream.url && _v357_isHdr(p));
    const _v398f_c = _v398for.filter((p) => !!p.stream.url);
    const _v398f_u = _v398for.filter((p) => !p.stream.url);
    /* V370_PRECOMPUTED_SCORES - computeScore (~50 regex tests + ~8 string
       allocations per call) ran INSIDE the sort comparator: ~700 calls for
       59 streams instead of 59.  That was the 850ms JS stall between
       [v337] and [V357 PARTITION] plus the 505ms GC pause in
       lag_capture.log.  Score each stream ONCE, then sort by the number. */
    const _v370Score = (p: any) => {
      if (p.__v370Score === undefined) p.__v370Score = computeScore(p.info, p.stream);
      return p.__v370Score;
    };
    for (const _p of _v357_cSdr) _v370Score(_p);
    for (const _p of _v357_cHdr) _v370Score(_p);
    for (const _p of _v357_uSdr) _v370Score(_p);
    for (const _p of _v357_uHdr) _v370Score(_p);
    const _v357_sortScore = (a: any, b: any) => _v370Score(b) - _v370Score(a);
    _v357_cSdr.sort(_v357_sortScore); _v357_cHdr.sort(_v357_sortScore);
    _v357_uSdr.sort(_v357_sortScore); _v357_uHdr.sort(_v357_sortScore);
    parsed.length = 0;
    for (const p of _v357_cSdr) parsed.push(p);
    for (const p of _v357_cHdr) parsed.push(p);
    for (const p of _v357_uSdr) parsed.push(p);
    for (const p of _v357_uHdr) parsed.push(p);
    _v398f_c.sort(_v357_sortScore);
    _v398f_u.sort(_v357_sortScore);
    /* V400_ENGLISH_HARD_GUARD - v398b left foreign at the tail of `parsed`,
       but the play flow uses .find(p => p.stream.url) which walks past
       English UNCACHED entries (no URL) and lands on the first foreign
       CACHED entry. Result: German/Russian still auto-played whenever
       there was no English cached release. Fix: when ANY English stream
       exists, drop foreign from `parsed` entirely. Foreign is only
       appended when the English pool is completely empty. */
    // v471: unconditionally append foreign to tail so ALL streams render.
    // English still ranks higher due to V323's -5000 foreign penalty upstream.
    for (const p of _v398f_c) parsed.push(p);
    for (const p of _v398f_u) parsed.push(p);
    if (_v398eng.length === 0) {
      console.log('[V471] no english - only foreign (' + (_v398f_c.length + _v398f_u.length) + ')');
    } else {
      console.log('[V471] eng=' + _v398eng.length + ' + foreign appended=' + (_v398f_c.length + _v398f_u.length));
    }
    console.log('[V398 ENGLISH WALL] eng=' + _v398eng.length + ' foreign=' + _v398for.length);
    /* V403_ENG_GROUP_PROMOTE - regex-based english-only release-group boost.
       Detector on release title alone cannot distinguish an English-titled
       release with foreign audio from a real English release. Instead we
       promote streams whose title contains a known English-only p2p/scene
       group tag to the very front of `parsed`, and demote known multi-
       audio Blu-Ray packagers (CtrlHD) below them. */
    try {
      var _v403GetTitle = function (p) {
        try {
          var s = (p && p.stream) || {};
          return String((s.title || s.name || s.filename || '') + ' ' + ((p && p.info && p.info.title) || '')).toUpperCase();
        } catch (_) { return ''; }
      };
      /* English-only groups: web-p2p and scene releases that virtually
         never carry foreign audio tracks. Conservative on purpose. */
      var _v403Whitelist = /\b(?:PSA|EDITH|FLUX|NTB|NTG|PLAYWEB|PLAYHD|GALAXYRG|GALAXYTV|KOGI|TEPES|RUBIK|ETHEL|HONE|TRUFFLE|ELITE|INSPIRE|EMBER|RCVR|SMURF|ORENJI|TERMINAL|MEMENTO|DEFLATE|LAZY|SVA|JYK|KRALIMARKO|TSAHDMI|MZABI|SPARKS|DIMENSION|LOL|KILLERS|ASAP|EVOLVE|FLEET|TBS|RARBG|YIFY|YTS|SUCCESSFULCRAB|MINX|FTP|KOGI|W4F|CAKES|PUBLICHD|CBFM|GGWP|WELP|SYNCOPY|CADAVER|FLUX|MEECH|FGT|SHORTBREHD)\b/;
      /* Groups whose titles look English but often ship multi-audio Blu-Ray
         (default track may not be English via debrid transcode). */
      /* V404_DISCRIP_DEMOTE - widen demote list. These markers mean the
         file is a whole Blu-Ray disc, season pack, or contains extras
         (featurettes, commentary, fireside chats, deleted scenes, etc.).
         When Torrentio matches such a file to a single episode request,
         it just serves the concatenated disc as-is - which is why South
         Park S1E1 played through a "fireside chat with the creators"
         before the episode. Always demote below clean single-file rips. */
      var _v403Demote = /(?:\bCTRLHD\b|\bIMMERSE\b|\bWIKI\b|\bD-Z0N3\b|\bUSURY\b|\bCOMPLETE\b|\bSEASON\.?\s?\d\b|\bSEASONS?\b|\bBOXSET\b|\bBOX\.SET\b|\bBDMV\b|\bBD(?:25|50|66|100)\b|\bBLURAY-FULL\b|\bDISC\.?\d?\b|\bDISK\.?\d?\b|\bEXTRAS?\b|\bFEATURETTES?\b|\bCOMMENTAR(?:Y|IES)\b|\bBEHIND\.?THE\.?SCENES\b|\bDELETED\.?SCENES\b|\bCREATORS?\b|\bMAKING\.?OF\b|\bREMUX\b|\bUHD\.?BLURAY\.?COMPLETE\b|\bALL\.EPISODES\b)/;
      var _promo = [];
      var _demoted = [];
      var _mid = [];
      for (var _i = 0; _i < parsed.length; _i++) {
        var _t = _v403GetTitle(parsed[_i]);
        /* V404 - check demote FIRST so a disc-rip tagged with a good
           group name (e.g. S01.COMPLETE.BluRay-PSA) still gets demoted. */
        if (_v403Demote.test(_t)) _demoted.push(parsed[_i]);
        else if (_v403Whitelist.test(_t)) _promo.push(parsed[_i]);
        else _mid.push(parsed[_i]);
      }
      /* V405_BEST_QUALITY_FIRST - user wants "english + best quality."
         Merge promo + mid into one pool and sort by:
           1) resolution DESC (2160 > 1440 > 1080 > 720 > 480)
           2) whitelist tie-breaker (english-only group wins)
           3) cached tie-breaker (has URL wins)
         Demoted bucket stays at the bottom, also sorted by res DESC. */
      var _v405Res = function (p) {
        var t = _v403GetTitle(p);
        if (/\b2160P\b|\b4K\b|\bUHD\b/.test(t)) return 2160;
        if (/\b1440P\b|\bQHD\b/.test(t))         return 1440;
        if (/\b1080P\b|\bFHD\b/.test(t))         return 1080;
        if (/\b720P\b|\bHD\b/.test(t))           return 720;
        if (/\b480P\b|\bSD\b/.test(t))           return 480;
        return 0;
      };
      var _v405Cached = function (p) {
        try { return (p && p.stream && p.stream.url) ? 1 : 0; } catch (_) { return 0; }
      };
      var _v405Cmp = function (a, b) {
        var ra = _v405Res(a), rb = _v405Res(b);
        if (rb !== ra) return rb - ra;
        var wa = _v403Whitelist.test(_v403GetTitle(a)) ? 1 : 0;
        var wb = _v403Whitelist.test(_v403GetTitle(b)) ? 1 : 0;
        if (wb !== wa) return wb - wa;
        return _v405Cached(b) - _v405Cached(a);
      };
      var _v405Pool = _promo.concat(_mid);
      _v405Pool.sort(_v405Cmp);
      _demoted.sort(function (a, b) { return _v405Res(b) - _v405Res(a); });
      parsed.length = 0;
      for (var _k = 0; _k < _v405Pool.length;   _k++) parsed.push(_v405Pool[_k]);
      for (var _k = 0; _k < _demoted.length;    _k++) parsed.push(_demoted[_k]);
      try {
        console.log('[V405 QUALITY] top3=' + _v405Pool.slice(0, 3).map(function (p) {
          return _v405Res(p) + 'p' + (_v405Cached(p) ? '(c)' : '');
        }).join(', ') + ' | demoted=' + _demoted.length);
      } catch (_) {}
      console.log('[V404 PROMOTE] promoted=' + _promo.length + ' demoted=' + _demoted.length + ' mid=' + _mid.length);
    } catch (_) {}
    console.log('[V357 PARTITION]', 'cached_sdr=' + _v357_cSdr.length, 'cached_hdr=' + _v357_cHdr.length, 'uncached_sdr=' + _v357_uSdr.length, 'uncached_hdr=' + _v357_uHdr.length);
  if (parsed.length > 0) {
    const _top = parsed[0];
    const _topInfo = _top.info;
    /* PATCH_V154_LOG_SORT â€” content mismatch trace */
    try {
      const _v154Req = (((content as any)?.name || (content as any)?.title || (name as any) || '') as string);
      const _v154Pick = ((_top.stream?.title || _top.stream?.name || '') as string);
      const _v154Hits = _v154TitleOverlap(_v154Req, _v154Pick);
      console.log('[MATCH v154]', _v154Hits === 0 ? 'WARNING-NO-OVERLAP' : 'ok-overlap=' + _v154Hits, '| requested=', _v154Req.slice(0,60), '| pick=', _v154Pick.slice(0,80), '| hash=', (_top.stream?.infoHash || '').slice(0,8), 'fileIdx=', (_top.stream as any)?.fileIdx ?? null);
    } catch (_) {}
    /* V367_FIX_V141_REF_BUILD_TAG - _v141_cached/_v141_uncached were deleted
       by V357's SDR/HDR partition but this log still referenced them ->
       ReferenceError -> details white screen on EVERY title. Counts now come
       from the V357 buckets. */
    console.log('[SORT v141_V367] picked top:', _topInfo.quality || '?', 'cached=' + (!!_top.stream.url), 'seeders=' + (_topInfo.seeders || 0), 'lang=' + (_topInfo.language || '?'), '| cached_n=' + (_v357_cSdr.length + _v357_cHdr.length), 'uncached_n=' + (_v357_uSdr.length + _v357_uHdr.length));
  }

  // PATCH_V16A_COMMENTARY_SINK â€” partition commentary tracks to the end of the result.
  // Whatever score-based sort ran above, commentary always sinks last so
  // the Play button (sorted[0]) and auto-play never select a commentary
  // track even if it scored highest by language/quality/seeders.
  const _sorted = parsed.map(p => p.stream);
  const _nonComm: Stream[] = [];
  const _comm: Stream[] = [];
  for (const s of _sorted) {
    if (_isCommentaryStream(s)) _comm.push(s); else _nonComm.push(s);
  }
  return [..._nonComm, ..._comm];
}

/*
 * V651_ENGLISH_1080_AUDIO_FIRST
 *
 * One selector owns BOTH normal Play and automatic episode Play.
 *
 * Required priority:
 *   1. If any non-foreign playable stream exists, foreign streams
 *      are excluded completely from automatic selection.
 *   2. Prefer 1080p.
 *   3. Within 1080p, prefer the best advertised audio format.
 *   4. Then prefer reliable/healthy streams.
 *   5. Foreign is fallback-only when no English/neutral candidate exists.
 *
 * Important:
 * parseStreamInfo() does not recognize every tracker-language spelling.
 * In particular, "DUBBING PL" was incorrectly treated as English and
 * caused South Park S1E1 to auto-play Polish audio.
 */
// V767D_AUTHORITATIVE_RUNTIME_CODEC_PROOF
function _v767dGetBadHashSet(): Set<string> {
  try {
    const raw = getItemSyncFast('v766m_eac3_bad_hashes_v1');
    const parsed = raw ? JSON.parse(raw) : [];

    if (Array.isArray(parsed)) {
      return new Set(
        parsed
          .map((h: any) => String(h || '').trim().toLowerCase())
          .filter(Boolean)
      );
    }
  } catch (_) {}

  return new Set<string>();
}

function _v769GetSeekHealthMap(): Record<string, any> {
  try {
    const raw =
      getItemSyncFast('v769_seek_health_v1');

    const parsed =
      raw ? JSON.parse(raw) : {};

    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return parsed;
    }
  } catch (_) {}

  return {};
}

// W121ZOD106G_PLAYBACK_HEALTH_POLICY
// 106F proved that six seconds of playback is not enough to certify a source:
// af81 played cleanly long enough to earn "pass" and then repeatedly exhausted
// its buffer around 20-22 minutes. Under 106G, an observed post-start OD
// rebuffer is immediately sticky for FUTURE automatic selection, while the
// existing six-second watchdog remains the authority for in-session failover.
// Only natural EOF explicitly rehabilitates a current-policy source.
const _W121ZOD106G_PLAYBACK_HEALTH_POLICY = 'od106g-v1';

// W121ZOD106H_REJECTED_106F_QUARANTINE
// 106F was never promoted. Its six-second pass criterion was disproven by
// runtime evidence, so every record produced by od106f-v1 is experimental
// data and must not make a source eligible for automatic selection.
// This is policy-based quarantine: no torrent hash is hard-coded.
function _w121zod106gPlaybackBadForSelection(health: any): boolean {
  const policy =
    String(health?.playbackPolicy || '');

  if (policy === 'od106f-v1') {
    return true;
  }

  // W121ZOD108H4Q_SUSTAINED_FAILURE_SELECTION_AUTHORITY
  // A transient degraded record is telemetry only. It must not
  // permanently quarantine a source for future automatic selection.
  // The existing J27 sustained-buffer failure remains authoritative.
  return (
    policy ===
      _W121ZOD106G_PLAYBACK_HEALTH_POLICY &&
    health?.playback === 'fail'
  );
}

function _v767dIsEac3Tagged(value: any): boolean {
  try {
    const t = String(value || '').toUpperCase();

    // Tracker forms: DDP, DDP5.1, DDP 5.1, DDP7.1,
    // EAC3, EAC3.5.1, E-AC-3 5.1, DD+5.1.
    return /(?:^|[^A-Z0-9])(?:E-?AC-?3|DDP|DD\+)(?:[ ._-]?\d(?:\.\d)?)?(?=$|[^A-Z0-9])/.test(t);
  } catch (_) {
    return false;
  }
}

// W121ZOD108E1_STRICT_AUTO_FOREIGN
function _w121zod108e1IsStrictForeignStream(stream: any): boolean {
  try {
    const info: any = parseStreamInfo(stream);
    if (info?.isForeign) return true;

    const t = String(
      (stream?.title || '') + ' ' +
      (stream?.name || '') + ' ' +
      (stream?.filename || '')
    )
      .replace(/\\n/g, ' ')
      .replace(/\\r/g, ' ')
      .replace(/\r|\n|\t/g, ' ')
      .toUpperCase();

    if (
      /\bDUBBING[\s._-]+(?:PL|POL|POLISH)\b/.test(t) ||
      /\b(?:PLDUB|PLSUBBED)\b/.test(t) ||
      /\bLEKTOR\b/.test(t) ||
      /\bPOLISH\b/.test(t) ||
      /\bPOLSKI\b/.test(t) ||
      /\bPOLSKA\b/.test(t)
    ) {
      return true;
    }

    // W121ZOD118H1_RELEASE_LANGUAGE_HYGIENE
    // A bare .PL./.POL. release without an advertised English track is
    // Polish-only for automatic Play. PL/EN remains eligible here.
    const _w121zod118h1HasExplicitEnglish =
      /\b(?:EN|ENG|ENGLISH)\b/.test(t);

    if (
      !_w121zod118h1HasExplicitEnglish &&
      /\b(?:PL|POL)\b/.test(t)
    ) {
      return true;
    }

    return /\b(?:RUS|RUSSIAN|HINDI|TAMIL|TELUGU|VOSTFR|VOSTA|VFF|VFQ|TRUEFRENCH|FRENCH|FRA|LATINO|CASTELLANO|SPANISH|ESPANOL|GERMAN|DEUTSCH|GER|DEU|ITALIAN|ITALIANO|ITA|DUBLADO|PORTUGUESE|KOREAN|KOR|JAPANESE|JPN|CHINESE|CHS|CHT|UKRAINIAN|UKR|TURKISH|DUTCH|DUBBED|MULTI|DUAL)\b/.test(t) ||
      /[\u0400-\u04FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(t);
  } catch (_) {
    return true;
  }
}

// W121ZOD108E1_ACTUAL_MEDIA_COMPAT
function _w121zod108e1ActualAudioDecision(probe: any): {
  ok: boolean;
  reason: string;
  codec: string;
  videoCodec: string;
} {
  try {
    if (!probe || probe.status !== 'success') {
      return {
        ok: false,
        reason: 'probe-invalid',
        codec: '',
        videoCodec: '',
      };
    }

    const video = Array.isArray(probe.video) ? probe.video : [];
    const audio = Array.isArray(probe.audio) ? probe.audio : [];

    if (video.length === 0) {
      return {
        ok: false,
        reason: 'no-video-track',
        codec: '',
        videoCodec: '',
      };
    }

    if (audio.length === 0) {
      return {
        ok: false,
        reason: 'no-audio-track',
        codec: '',
        videoCodec: '',
      };
    }

    const allCaps: any = (_v659DeviceCaps as any) || {};
    const videoCaps: any = allCaps?.video || {};
    const audioCaps: any = allCaps?.audio || {};

    const videoTrack =
      video.find(
        (track: any) =>
          Number(track?.default || 0) === 1
      ) ||
      video[0];

    const videoCodec = String(videoTrack?.codec_name || '')
      .trim()
      .toLowerCase();

    if (!videoCodec) {
      return {
        ok: false,
        reason: 'video-codec-missing',
        codec: '',
        videoCodec: '',
      };
    }

    const videoKey: Record<string, string> = {
      h264: 'h264',
      hevc: 'hevc',
      vp9: 'vp9',
      av1: 'av1',
    };

    const resolvedVideoKey = videoKey[videoCodec];

    if (!resolvedVideoKey) {
      return {
        ok: false,
        reason: 'video-codec-unmapped',
        codec: '',
        videoCodec,
      };
    }

    const selectedVideoCaps =
      videoCaps?.[resolvedVideoKey];

    if (
      Number(selectedVideoCaps?.decoderCount || 0) <= 0
    ) {
      return {
        ok: false,
        reason: 'video-codec-unsupported',
        codec: '',
        videoCodec,
      };
    }

    const videoWidth =
      Number(videoTrack?.width || 0);

    const videoHeight =
      Number(videoTrack?.height || 0);

    const actual4k =
      videoWidth >= 3500 ||
      videoHeight >= 2000;

    if (actual4k) {
      const displayWidth =
        Number(allCaps?.display?.maxWidth || 0);

      const displayHeight =
        Number(allCaps?.display?.maxHeight || 0);

      const displayIs4k =
        displayWidth >= 3840 &&
        displayHeight >= 2160;

      const decoderCan4k =
        selectedVideoCaps?.supports4k30 === true ||
        selectedVideoCaps?.supports4k60 === true;

      if (!displayIs4k) {
        return {
          ok: false,
          reason: 'actual-4k-display-unsupported',
          codec: '',
          videoCodec,
        };
      }

      if (!decoderCan4k) {
        return {
          ok: false,
          reason: 'actual-4k-decoder-unsupported',
          codec: '',
          videoCodec,
        };
      }
    }

    // W121ZOD108H4AY_EXACT_HASH_EAC3_AUTHORITY
    // Runtime decoder failures are authoritative only for the exact hash that
    // failed. A device-wide EAC3 kill switch incorrectly blocks hashes already
    // proven playable on this same device.
    const eac3RuntimeBroken = false;

    const codecOf = (track: any): string =>
      String(track?.codec_name || '')
        .trim()
        .toLowerCase();

    const profileOf = (track: any): string =>
      String(track?.profile || '')
        .trim()
        .toLowerCase();

    const isEnglish = (track: any): boolean => {
      const language =
        String(track?.language || '')
          .trim()
          .toLowerCase();

      const title =
        String(track?.title || '')
          .trim()
          .toLowerCase();

      return (
        language === 'en' ||
        language === 'eng' ||
        language === 'english' ||
        language.startsWith('en-') ||
        language.startsWith('en_') ||
        /\benglish\b/.test(title) ||
        /\beng\b/.test(title)
      );
    };

    let selected: any = null;

    if (eac3RuntimeBroken) {
      const safeTracks =
        audio.filter((track: any) => codecOf(track) !== 'eac3');

      if (safeTracks.length === 0) {
        return {
          ok: false,
          reason: 'eac3-runtime-broken-no-safe-track',
          codec: 'eac3',
          videoCodec,
        };
      }

      selected =
        safeTracks.find(isEnglish) ||
        safeTracks[0];
    } else {
      const englishTracks =
        audio.filter(isEnglish);

      const trueHdSupported =
        audioCaps?.trueHd === true;

      selected =
        englishTracks.find(
          (track: any) =>
            trueHdSupported ||
            codecOf(track) !== 'truehd'
        ) ||
        englishTracks[0] ||
        audio.find(
          (track: any) =>
            Number(track?.default || 0) === 1
        ) ||
        audio[0];
    }

    const codec = codecOf(selected);

    if (!codec) {
      return {
        ok: false,
        reason: 'audio-codec-missing',
        codec: '',
        videoCodec,
      };
    }

    let key = '';

    if (codec === 'aac') {
      key = 'aac';
    } else if (codec === 'ac3') {
      key = 'ac3';
    } else if (codec === 'eac3') {
      key = 'eac3';
    } else if (codec === 'opus') {
      key = 'opus';
    } else if (codec === 'truehd') {
      key = 'trueHd';
    } else if (codec === 'dts') {
      const profile = profileOf(selected);

      key =
        /dts[- ]?hd|master audio|high resolution/.test(profile)
          ? 'dtsHd'
          : 'dts';
    }

    if (!key) {
      return {
        ok: false,
        reason: 'audio-codec-unmapped',
        codec,
        videoCodec,
      };
    }

    if (audioCaps?.[key] !== true) {
      return {
        ok: false,
        reason: 'audio-codec-unsupported',
        codec,
        videoCodec,
      };
    }

    return {
      ok: true,
      reason: 'actual-media-supported',
      codec,
      videoCodec,
    };
  } catch (_) {
    return {
      ok: false,
      reason: 'probe-evaluation-error',
      codec: '',
      videoCodec: '',
    };
  }
}


function _v503PickReliableAutoStream(streams: Stream[], usePlaybackHealth: boolean = false): Stream | null {
  const _v767dBadHashes = _v767dGetBadHashSet();
  const _v769SeekHealth = _v769GetSeekHealthMap();
  if (usePlaybackHealth && (_v659DeviceCaps as any)?.isTelevision === true) {
    const audit = (streams || []).map((s: any) => {
      const hash = String(s?.infoHash || s?.info_hash || '').toLowerCase();
      const h = _v769SeekHealth[hash] || {};
      const info: any = parseStreamInfo(s);

      // W121ZOD108H4AB_CANDIDATE_IDENTITY_DIAGNOSTIC
      // Logging only: expose exact candidate identity before ranking.
      // No mutation, filtering, scoring, ordering, or selection change.
      try {
        console.log(
          '[W121ZOD108H4AB CANDIDATE]',
          'hash=' + hash,
          'quality=' + String(info?.quality || ''),
          'size=' + String(info?.size || ''),
          'filename=' + String(s?.filename || '')
            .replace(/\s+/g, ' ')
            .slice(0, 220),
          'title=' + String(s?.title || '')
            .replace(/\s+/g, ' ')
            .slice(0, 300),
          'name=' + String(s?.name || '')
            .replace(/\s+/g, ' ')
            .slice(0, 160)
        );
      } catch (_) {}

      return { hash: hash.slice(0, 12), q: info?.quality, size: info?.size,
        foreign: !!info?.isForeign, hdr: !!info?.isHDR, codecBad: _v767dBadHashes.has(hash),
        ff: h.ff || '?', rw: h.rw || '?', playback: h.playback || '?',
        playbackPolicy: h.playbackPolicy || 'legacy',
        playbackQuarantined:
          _w121zod106gPlaybackBadForSelection(h),
        healthAt:
          h.playbackFailedAt ||
          h.playbackDegradedAt ||
          h.playbackPassedAt ||
          h.updatedAt ||
          0 };
    });
    for (let i = 0; i < audit.length; i += 8) {
      console.log('[W121ZOD106C OD CANDIDATES]', JSON.stringify(audit.slice(i, i + 8)));
    }
  }

  const playable = (streams || []).filter((s: any) => {
    if (
      !s ||
      !(
        s.url ||
        s.externalUrl ||
        s.direct_url ||
        s.infoHash ||
        s.info_hash
      )
    ) {
      return false;
    }

    const hash = String(
      s.infoHash || s.info_hash || ''
    ).trim().toLowerCase();

    if (hash && _v767dBadHashes.has(hash)) {
      return false;
    }

    return true;
  });

  if (playable.length === 0) return null;

  const blob = (s: any): string =>
    String(
      (s?.title || '') + ' ' +
      (s?.name || '') + ' ' +
      (s?.filename || '')
    )
      .replace(/\\n/g, ' ')
      .replace(/\\r/g, ' ')
      .replace(/\r|\n|\t/g, ' ')
      .toUpperCase();

  const isStrictForeign = (s: any): boolean => {
    const info: any = parseStreamInfo(s);

    if (info?.isForeign) return true;

    const t = blob(s);

    // V651: tracker/release language spellings that the base parser
    // does not reliably identify.
    /*
     * V665H_PLDUB_FOREIGN_GATE
     *
     * Runtime proof: tracker release token "PLDUB" is Polish-dubbed
     * content but was not recognized by the strict automatic-language
     * wall. Keep it fallback/manual-only when English/neutral exists.
     */
    if (
      /\bDUBBING[\s._-]+(?:PL|POL|POLISH)\b/.test(t) ||
      /\b(?:PLDUB|PLSUBBED)\b/.test(t) ||
      /\bLEKTOR\b/.test(t) ||
      /\bPOLISH\b/.test(t) ||
      /\bPOLSKI\b/.test(t) ||
      /\bPOLSKA\b/.test(t)
    ) {
      return true;
    }

    // Same strict-language wall already used elsewhere in the app.
    // MULTI/DUAL are fallback-only because their default audio is
    // not guaranteed to be English.
    if (
      /\b(?:RUS|RUSSIAN|HINDI|TAMIL|TELUGU|VOSTFR|VOSTA|VFF|VFQ|TRUEFRENCH|FRENCH|FRA|LATINO|CASTELLANO|SPANISH|ESPANOL|GERMAN|DEUTSCH|GER|DEU|ITALIAN|ITALIANO|ITA|DUBLADO|PORTUGUESE|KOREAN|KOR|JAPANESE|JPN|CHINESE|CHS|CHT|UKRAINIAN|UKR|TURKISH|DUTCH|DUBBED|MULTI|DUAL)\b/.test(t)
    ) {
      return true;
    }

    if (
      /[\u0400-\u04FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(t)
    ) {
      return true;
    }

    return false;
  };

  const nonForeign = playable.filter((s: any) => !isStrictForeign(s));

  // Hard wall: when English/neutral candidates exist, foreign releases
  // are not allowed to compete on score at all.
  let pool = nonForeign.length > 0 ? nonForeign : playable;

  // Commentary is fallback-only as well.
  const nonCommentary = pool.filter(
    (s: any) => !(parseStreamInfo(s) as any)?.isCommentary
  );

  if (nonCommentary.length > 0) {
    pool = nonCommentary;
  }

  /*
   * V665_DEVICE_AWARE_AUTOPICK
   *
   * One native capability profile drives automatic stream selection.
   * No model-name blacklist and no global Fire TV penalty.
   *
   * Automatic priority:
   *   English -> SDR -> device-safe resolution -> supported video codec
   *   -> supported audio -> reliability.
   *
   * Manual stream cards remain untouched.
   */
  const _v665Caps: any = _v659DeviceCaps;

  const _v665MemoryClassMb =
    Number(_v665Caps?.memoryClassMb || 0);

  const _v665IsTv =
    _v665Caps?.isTelevision === true;

  const _v665DisplayWidth =
    Number(_v665Caps?.display?.maxWidth || 0);

  const _v665DisplayHeight =
    Number(_v665Caps?.display?.maxHeight || 0);

  const _v665DisplayIs4k =
    _v665DisplayWidth >= 3840 &&
    _v665DisplayHeight >= 2160;

  const _v665HasVideoCaps = !!(
    _v665Caps?.video?.h264 ||
    _v665Caps?.video?.hevc ||
    _v665Caps?.video?.vp9 ||
    _v665Caps?.video?.av1
  );

  const _v665AudioCaps: any =
    _v665Caps?.audio || {};

  /*
   * V767C_EFFECTIVE_RUNTIME_AUDIO_CAPS
   *
   * Native codec enumeration is only the starting capability.
   * V766 provides stronger runtime proof: if this exact device
   * actually failed EAC3 initialization, automatic selection must
   * stop treating EAC3/EAC3-JOC as playable on that device.
   *
   * This flag is local to each device. A Google Streamer that plays
   * EAC3 successfully remains fully EAC3-capable.
   */
  // W121ZOD108H4AY_EXACT_HASH_EAC3_SELECTOR
  // _v767dBadHashes already contains exact runtime-proven EAC3 decoder failures.
  // Do not poison every EAC3/DDP source on this device because one hash failed.
  const _v767Eac3RuntimeBroken = false;

  const _v665HasAudioCaps = [
    'aac',
    'ac3',
    'eac3',
    'eac3Joc',
    'opus',
    'dts',
    'dtsHd',
    'trueHd',
  ].some(
    (k: string) =>
      typeof _v665AudioCaps?.[k] === 'boolean'
  );

  const _v665HasH264 =
    Number(_v665Caps?.video?.h264?.decoderCount || 0) > 0;

  const _v665HasHevc =
    Number(_v665Caps?.video?.hevc?.decoderCount || 0) > 0;

  const _v665HasVp9 =
    Number(_v665Caps?.video?.vp9?.decoderCount || 0) > 0;

  const _v665HasAv1 =
    Number(_v665Caps?.video?.av1?.decoderCount || 0) > 0;

  const _v665H264Can4k =
    _v665Caps?.video?.h264?.supports4k30 === true ||
    _v665Caps?.video?.h264?.supports4k60 === true;

  const _v665HevcCan4k =
    _v665Caps?.video?.hevc?.supports4k30 === true ||
    _v665Caps?.video?.hevc?.supports4k60 === true;

  const _v665Vp9Can4k =
    _v665Caps?.video?.vp9?.supports4k30 === true ||
    _v665Caps?.video?.vp9?.supports4k60 === true;

  const _v665Av1Can4k =
    _v665Caps?.video?.av1?.supports4k30 === true ||
    _v665Caps?.video?.av1?.supports4k60 === true;

  // Preserve the proven V662 constrained-TV boundary.
  const _v665LowMemoryTv =
    _v665IsTv &&
    _v665MemoryClassMb > 0 &&
    _v665MemoryClassMb <= 192 &&
    _v665HasH264;

  // Strong 4K TVs can promote 4K only when the actual stream codec
  // is explicitly reported as 4K-capable by this device.
  const _v665DeviceCanPrefer4k =
    _v665IsTv &&
    !_v665LowMemoryTv &&
    _v665DisplayIs4k &&
    _v665HasVideoCaps;

  const _v665CanAuto4kStream = (s: any): boolean => {
    if (!_v665DeviceCanPrefer4k) return false;

    const t = blob(s);

    if (/\b(?:H\.?264|AVC|X264)\b/.test(t)) {
      return _v665HasH264 && _v665H264Can4k;
    }

    if (/\b(?:H\.?265|HEVC|X265)\b/.test(t)) {
      return _v665HasHevc && _v665HevcCan4k;
    }

    if (/\bVP9\b/.test(t)) {
      return _v665HasVp9 && _v665Vp9Can4k;
    }

    if (/\bAV1\b/.test(t)) {
      return _v665HasAv1 && _v665Av1Can4k;
    }

    // Unknown codec: do not guess that automatic 4K is safe.
    return false;
  };

  /*
   * V665A_KNOWN_UNSUPPORTED_VIDEO_WALL
   *
   * Automatic playback must not choose an explicitly advertised codec
   * or resolution that this device explicitly reports it cannot decode
   * when another compatible candidate exists.
   *
   * Unknown/untagged codecs are NOT treated as unsupported.
   * Manual stream cards remain untouched.
   */
  const _v665aKnownVideoUnsupported = (s: any): boolean => {
    if (!_v665HasVideoCaps) return false;

    const t = blob(s);
    const info: any = parseStreamInfo(s);
    const q = String(info?.quality || '');

    const checkCaps = (caps: any): boolean => {
      // Advertised codec but no native decoder entry.
      if (!caps) return true;

      const decoderCount =
        Number(caps?.decoderCount || 0);

      if (decoderCount <= 0) {
        return true;
      }

      // Only reject resolution capability when native reporting gives
      // us an explicit boolean answer. Null/unknown is not rejection.
      if (q === '4K') {
        const has4kAnswer =
          typeof caps?.supports4k30 === 'boolean' ||
          typeof caps?.supports4k60 === 'boolean';

        if (
          has4kAnswer &&
          caps?.supports4k30 !== true &&
          caps?.supports4k60 !== true
        ) {
          return true;
        }
      }

      if (q === '1080p') {
        if (
          typeof caps?.supports1080p30 === 'boolean' &&
          caps?.supports1080p30 !== true
        ) {
          return true;
        }
      }

      return false;
    };

    if (/\b(?:H\.?264|AVC|X264)\b/.test(t)) {
      return checkCaps(_v665Caps?.video?.h264);
    }

    if (/\b(?:H\.?265|HEVC|X265)\b/.test(t)) {
      return checkCaps(_v665Caps?.video?.hevc);
    }

    if (/\bVP9\b/.test(t)) {
      return checkCaps(_v665Caps?.video?.vp9);
    }

    if (/\bAV1\b/.test(t)) {
      return checkCaps(_v665Caps?.video?.av1);
    }

    // Codec not advertised: unknown, not unsupported.
    return false;
  };

  const _v665aVideoSafePool = pool.filter(
    (s: any) =>
      !_v665aKnownVideoUnsupported(s)
  );

  const _v665aUsingVideoSafePool =
    _v665aVideoSafePool.length > 0;

  if (_v665aUsingVideoSafePool) {
    pool = _v665aVideoSafePool;
  }

  /*
   * V652_COMPATIBLE_AUDIO_AUTOPICK
   *
   * V651 correctly created the English wall, but ranked TrueHD as the
   * highest audio format. Google TV Streamer then rejected audio/true-hd
   * with MediaCodecAudioRenderer NO_UNSUPPORTED_TYPE.
   *
   * Automatic playback therefore uses a compatibility wall:
   *   EAC3/DDP/DD+ / AC3 / AAC / Opus = preferred automatic formats
   *   TrueHD / DTS-X / DTS-HD / DTS = fallback-only
   *
   * Manual stream cards are NOT removed or changed.
   */
  const isAutoAudioUnsafe = (s: any): boolean => {
    const t = blob(s);

    // If native audio reporting is unavailable, retain the proven
    // V652 safe-audio behavior exactly.
    if (!_v665HasAudioCaps) {
      return (
        /\bTRUE[\s._-]?HD\b/.test(t) ||
        /\bDTS[\s._-]?X\b/.test(t) ||
        /\bDTSX\b/.test(t) ||
        /\bDTS[\s._-]?HD[\s._-]?MA\b/.test(t) ||
        /\bDTS[\s._-]?HD\b/.test(t) ||
        /\bDTS\b/.test(t)
      );
    }

    const a: any = _v665AudioCaps;

    if (/\bTRUE[\s._-]?HD\b/.test(t)) {
      return a.trueHd !== true;
    }

    // Native capability module does not expose DTS-X separately.
    if (
      /\bDTS[\s._-]?X\b/.test(t) ||
      /\bDTSX\b/.test(t)
    ) {
      return true;
    }

    if (
      /\bDTS[\s._-]?HD[\s._-]?MA\b/.test(t) ||
      /\bDTS[\s._-]?HD\b/.test(t)
    ) {
      return a.dtsHd !== true;
    }

    if (/\bDTS\b/.test(t)) {
      return a.dts !== true;
    }

    /*
     * V665E_EAC3_ATMOS_JOC_GATE
     *
     * Runtime proof: eac3=true alone does not guarantee an
     * E-AC3 Atmos/JOC track can initialize. Atmos over E-AC3/DDP
     * requires native eac3Joc support for automatic selection.
     */
    if (
      /\bATMOS\b/.test(t) &&
      _v767dIsEac3Tagged(t)
    ) {
      return _v767Eac3RuntimeBroken || a.eac3 !== true || a.eac3Joc !== true;
    }

    /*
     * V665G_GENERIC_ATMOS_CARRIER_GATE
     *
     * "Atmos" by itself does not identify whether the carrier is
     * E-AC3/JOC, TrueHD, or something else. Automatic playback must
     * not guess. Explicit supported carrier tags are handled above;
     * unqualified Atmos remains manual/fallback-only.
     */
    if (/\bATMOS\b/.test(t)) {
      return true;
    }

    if (_v767dIsEac3Tagged(t)) {
      return _v767Eac3RuntimeBroken || a.eac3 !== true;
    }

    if (/\b(?:AC-?3|DD ?5)\b/.test(t)) {
      return a.ac3 !== true;
    }

    if (/\bAAC\b/.test(t)) {
      return a.aac !== true;
    }

    if (/\bOPUS\b/.test(t)) {
      return a.opus !== true;
    }

    // Untagged audio remains eligible. Do not invent a codec.
    return false;
  };

  const _v652SafeAudioPool = pool.filter(
    (s: any) => !isAutoAudioUnsafe(s)
  );

  const _v652UsingSafeAudio =
    _v652SafeAudioPool.length > 0;

  if (_v652UsingSafeAudio) {
    pool = _v652SafeAudioPool;
  }

  /*
   * W121ZOD108H4AW_BEST_AVAILABLE_SAFE_BEFORE_SDR
   *
   * Device-safe video/audio is a correctness wall. SDR is only a preference
   * inside that safe pool so a broken SDR audio source cannot outrank a
   * better playable 1080p/4K candidate.
   */
  // W121ZOD118H2_HDRIP_IS_NOT_HDR
  // "HDRip" is a release-source label, not HDR video. The legacy parser can
  // see the letters HDR inside HDRip and incorrectly push compact x264 files
  // out of the SDR pool. Only explicit HDR/DV/HLG signaling counts here.
  const _w121zod118h2IsRealHdr =
    (s: any): boolean => {
      const text = blob(s)
        .toUpperCase()
        .replace(/\bHDRIP\b/g, ' ');

      if (
        /\b(?:HDR10\+?|HDR|HLG)\b/.test(text) ||
        /\bDOLBY[ ._-]?VISION\b/.test(text) ||
        /(?:^|[^A-Z0-9])DV(?:$|[^A-Z0-9])/.test(text)
      ) {
        return true;
      }

      const legacyHdr =
        (parseStreamInfo(s) as any)?.isHDR === true;

      return legacyHdr &&
        !/\bHDRIP\b/.test(blob(s).toUpperCase());
    };

  const _v665SdrPool = pool.filter(
    (s: any) =>
      !_w121zod118h2IsRealHdr(s)
  );

  const _v665UsingSdr =
    _v665SdrPool.length > 0;

  if (_v665UsingSdr) {
    pool = _v665SdrPool;
  }
  const qualityRank = (s: any): number => {
    const q = String(
      (parseStreamInfo(s) as any)?.quality || ''
    );

    /*
     * W121ZOD104H2_RESTORE_1080_FIRST
     *
     * Restore the proven V652 automatic resolution policy:
     * 1080p outranks 4K for automatic Play.
     *
     * Manual stream cards are unchanged.
     * Device capability logic remains available elsewhere.
     */
    // W121ZOD117A_1080P_SUSTAINABLE_DEFAULT
    //
    // Automatic Play prefers 1080p as the universal high-quality,
    // sustainable TV target. 4K remains available manually and remains
    // an automatic fallback when no suitable 1080p exists.
    if (q === '1080p') return 5;
    if (q === '4K')    return _v665DeviceCanPrefer4k ? 4 : 2;
    if (q === '720p')  return 3;
    if (q === 'HD')    return 2;
    if (q === 'SD')    return 1;

    return 0;
  };

  /*
   * V665D_SOURCE_MASTER_PRIORITY
   *
   * Equal-resolution automatic-selection preference:
   *   WEB-DL > ordinary > BluRay/BDRip/BRRip/REMUX > DCPRip
   *
   * This is ranking only. Nothing is filtered and manual selection
   * remains unchanged. HDR/SDR policy remains owned by V665.
   */
  const _v665bMasterRank = (s: any): number => {
    const t = blob(s);

    if (/\bDCP[\s._-]?RIP\b/.test(t)) {
      return 0;
    }

    if (
      /\b(?:BLURAY|BLU-RAY|BDRIP|BD-RIP|BRRIP|BR-RIP|REMUX)\b/.test(t)
    ) {
      return 1;
    }

    if (/\bWEB-?DL\b/.test(t)) {
      return 3;
    }

    return 2;
  };

  const audioRank = (s: any): number => {
    const t = blob(s);

    // V767C: runtime decoder failure outranks static codec enumeration.
    if (
      _v767Eac3RuntimeBroken &&
      _v767dIsEac3Tagged(t)
    ) {
      return -100;
    }

    // Missing native capability data => preserve V652 ranking.
    if (!_v665HasAudioCaps) {
      if (
        /\bATMOS\b/.test(t) &&
        _v767dIsEac3Tagged(t)
      ) {
        return 100;
      }

      if (_v767dIsEac3Tagged(t)) return 90;
      if (/\b(?:AC-?3|DD ?5)\b/.test(t))       return 80;
      if (/\bAAC\b/.test(t))                   return 70;
      if (/\bOPUS\b/.test(t))                  return 60;
      if (/\bDTS\b/.test(t))                   return 30;
      if (/\bTRUE[\s._-]?HD\b/.test(t))        return 20;

      return 0;
    }

    const a: any = _v665AudioCaps;

    // W121ZOD104H2_RESTORE_KNOWN_GOOD_AUDIO_ORDER
    //
    // Restore the proven V652 Google TV Streamer automatic preference:
    // E-AC3/DDP -> AC3 -> AAC -> Opus.
    //
    // Existing capability checks, bad-hash filtering and the
    // E-AC3 runtime-broken circuit breaker remain authoritative.
    const _v121zod9bKirkwood =
      String((_v659DeviceCaps as any)?.device || '')
        .toLowerCase() === 'kirkwood' ||
      String((_v659DeviceCaps as any)?.model || '')
        .toLowerCase() === 'google tv streamer';

    if (_v121zod9bKirkwood) {
      if (
        /\bATMOS\b/.test(t) &&
        _v767dIsEac3Tagged(t) &&
        a.eac3 === true
      ) {
        return 100;
      }

      if (
        _v767dIsEac3Tagged(t) &&
        a.eac3 === true
      ) {
        return 90;
      }

      if (
        /\b(?:AC-?3|DD ?5)\b/.test(t) &&
        a.ac3 === true
      ) {
        return 80;
      }

      if (
        /\bAAC\b/.test(t) &&
        a.aac === true
      ) {
        return 70;
      }

      if (
        /\bOPUS\b/.test(t) &&
        a.opus === true
      ) {
        return 60;
      }
    }

    if (
      /\bTRUE[\s._-]?HD\b/.test(t) &&
      a.trueHd === true
    ) {
      return 120;
    }

    if (
      (
        /\bDTS[\s._-]?HD[\s._-]?MA\b/.test(t) ||
        /\bDTS[\s._-]?HD\b/.test(t)
      ) &&
      a.dtsHd === true
    ) {
      return 115;
    }

    if (
      /\bATMOS\b/.test(t) &&
      _v767dIsEac3Tagged(t) &&
      a.eac3 === true
    ) {
      return a.eac3Joc === true ? 110 : 100;
    }

    if (
      _v767dIsEac3Tagged(t) &&
      a.eac3 === true
    ) {
      return 100;
    }

    if (
      /\bDTS\b/.test(t) &&
      a.dts === true
    ) {
      return 90;
    }

    if (
      /\b(?:AC-?3|DD ?5)\b/.test(t) &&
      a.ac3 === true
    ) {
      return 80;
    }

    if (
      /\bAAC\b/.test(t) &&
      a.aac === true
    ) {
      return 70;
    }

    if (
      /\bOPUS\b/.test(t) &&
      a.opus === true
    ) {
      return 60;
    }

    return 0;
  };
  // W121ZOD106A_COMPACT_TV_AUTOPLAY
  // Cached/debrid media is delivered by HTTPS, so swarm seed counts do
  // not predict its playback speed. Preserve the existing format and
  // reliability preferences; break equivalent OD-TV ties by file size.
  // W121ZOD115I_PHONE_OD_POLICY: restore W121ZSA TV autoplay ranking semantics.
  const _v106aCompactAuto = false;
  const _v106aTransferBytes = (s: any): number => {
    if (!_v106aCompactAuto) return 0;
    const hintedBytes = Number(s?.behaviorHints?.videoSize || s?.videoSize || 0);
    if (Number.isFinite(hintedBytes) && hintedBytes > 0) return hintedBytes;
    const text = String((parseStreamInfo(s) as any)?.size || '') || blob(s);
    const match = text.match(/(?:^|[^\d.])([\d]+(?:[.,][\d]+)?)\s*(GI?B|MI?B|TI?B)\b/i);
    if (!match) return Number.POSITIVE_INFINITY;
    const amount = Number(match[1].replace(',', '.'));
    const exponent = match[2].toUpperCase().startsWith('T') ? 4
      : match[2].toUpperCase().startsWith('G') ? 3 : 2;
    const bytes = amount * Math.pow(1024, exponent);
    return Number.isFinite(bytes) && bytes > 0 ? bytes : Number.POSITIVE_INFINITY;
  };
  const reliabilityRank = (s: any): number => {
    const info: any = parseStreamInfo(s);
    const t = blob(s);

    let n = 0;

    // Direct/debrid-resolved stream is useful only as a tie-breaker.
    if (s?.url || s?.externalUrl || s?.direct_url) n += 1000;

    // Prefer streaming-service releases for TV reliability.
    if (/\bWEB-?DL\b/.test(t)) n += 700;
    else if (/\bWEB-?RIP\b/.test(t)) n += 350;

    // V665 low-memory TV reliability tiebreaker.
    // More capable devices do not inherit Fire TV codec penalties.
    if (_v665LowMemoryTv) {
      if (/\b(?:H\.?264|AVC|X264)\b/.test(t)) n += 250;
      if (/\b(?:H\.?265|HEVC|X265)\b/.test(t)) n -= 100;
    }

    // W121ZOD8_CAPABLE_DEVICE_CODEC_RELIABILITY
    // Restore the proven September-7 H264-vs-HEVC
    // reliability tiebreaker on capable devices.
    // This executes only at the final reliability level;
    // it cannot override quality/audio/source preference.
    if (!_v665LowMemoryTv) {
      if (/\b(?:H\.?264|AVC|X264)\b/.test(t)) n += 250;
      if (/\b(?:H\.?265|HEVC|X265)\b/.test(t)) n -= 100;
    }

    // SDR is already preferred by the V665 automatic-selection wall.
    if (info?.isHDR) n -= 150;

    if (
      /\b(?:BLURAY|BLU-RAY|BDRIP|BD-RIP|BRRIP|BR-RIP|REMUX|BDMV|COMPLETE)\b/.test(t)
    ) {
      n -= 100;
    }

    // W121ZOD104I7_RAW_SEEDER_TIEBREAKER
    // Read current raw-stream seeders at decision time. parseStreamInfo
    // can contain an earlier cached value from progressive discovery.
    const _v104i7SeedText = String(
      (s as any)?.title || (s as any)?.name || ''
    );
    const _v104i7SeedMatch = _v104i7SeedText.match(
      /(?:\uD83D\uDC64|\uD83C\uDF31)\s*(\d+)/
    );
    const seeders = Number(
      (s as any)?.seeders ||
      info?.seeders ||
      (_v104i7SeedMatch ? _v104i7SeedMatch[1] : 0)
    );

    if (!_v106aCompactAuto && Number.isFinite(seeders) && seeders > 0) {
      n += Math.min(seeders, 500);
    }

    return n;
  };

  /*
   * V665_DEVICE_VIDEO_COMPAT_RANK
   *
   * Constrained TVs preserve V662's proven preference:
   *   H264 > unknown > HEVC.
   *
   * Other devices rank codecs using their actual native decoder inventory.
   * No stream is removed here.
   */
  const _v665VideoCompatRank = (s: any): number => {
    if (!_v665HasVideoCaps) return 0;

    const t = blob(s);

    const isH264 =
      /\b(?:H\.?264|AVC|X264)\b/.test(t);

    const isHevc =
      /\b(?:H\.?265|HEVC|X265)\b/.test(t);

    const isVp9 =
      /\bVP9\b/.test(t);

    const isAv1 =
      /\bAV1\b/.test(t);

    if (_v665LowMemoryTv) {
      if (isH264) return _v665HasH264 ? 4 : 0;
      if (isHevc) return _v665HasHevc ? 1 : 0;
      if (isVp9)  return _v665HasVp9  ? 2 : 0;
      if (isAv1)  return _v665HasAv1  ? 2 : 0;

      return 2;
    }

    if (isH264) return _v665HasH264 ? 3 : 0;
    if (isHevc) return _v665HasHevc ? 3 : 0;
    if (isVp9)  return _v665HasVp9  ? 3 : 0;
    if (isAv1)  return _v665HasAv1  ? 3 : 0;

    // Untagged video codec is unknown, not automatically unsupported.
    return 2;
  };

  // W121ZOD116S1B_DEVICE_LOCAL_SUSTAINABILITY_PRIORITY
  //
  // English/title/device-compatibility gates execute before this rank.
  //
  // Within the safe pool:
  //   PROVEN SUSTAINED > UNKNOWN > DEGRADED > FAILED
  //
  // Health is local app storage, so each physical device learns
  // independently which torrent/source is sustainable on that device.
  const _v769SeekHealthRank = (s: any): number => {
    if (!usePlaybackHealth) return 0;

    const hash = String(
      s?.infoHash || s?.info_hash || ''
    )
      .trim()
      .toLowerCase();

    const health =
      hash ? _v769SeekHealth[hash] : null;

    // Required FF/RW behavior remains a hard compatibility signal.
    if (
      health?.ff === 'fail' ||
      health?.rw === 'fail'
    ) {
      return -1;
    }

    const policy =
      String(health?.playbackPolicy || '');

    // Rejected experimental six-second proof.
    if (policy === 'od106f-v1') {
      return -1;
    }

    if (
      policy === _W121ZOD106G_PLAYBACK_HEALTH_POLICY &&
      health?.playback === 'fail'
    ) {
      return -1;
    }

    const seekBonus =
      health?.ff === 'pass' && health?.rw === 'pass'
        ? 4
        : health?.ff === 'pass' || health?.rw === 'pass'
          ? 2
          : 0;

    const sustainedPass =
      policy === _W121ZOD106G_PLAYBACK_HEALTH_POLICY &&
      health?.playback === 'pass' &&
      (
        health?.playbackPassReason === 'natural-eof' ||
        health?.playbackPassReason === 'sustained-120s'
      );

    if (sustainedPass) {
      return 60 + seekBonus;
    }

    if (
      policy === _W121ZOD106G_PLAYBACK_HEALTH_POLICY &&
      health?.playback === 'degraded'
    ) {
      return 10 + seekBonus;
    }

    // Untested on THIS device gets a chance before retrying a source
    // already known to buffer here.
    return 30 + seekBonus;
  };
  /*
   * A proven FF/RW failure is excluded from automatic
   * selection whenever another candidate remains.
   *
   * Unknown sources stay eligible so new hashes can
   * still be tested and learned.
   *
   * If every available source is already marked bad,
   * retain the original pool instead of producing
   * "no stream".
   */
  const _v769NonFailedPool =
    pool.filter(
      (s: any) =>
        _v769SeekHealthRank(s) >= 0
    );

  const _v769UsingNonFailed =
    _v769NonFailedPool.length > 0;

  if (_v769UsingNonFailed) {
    pool = _v769NonFailedPool;
  }

  // W121ZOD125_DEGRADED_LAST_RESORT
  //
  // A source that THIS physical device has already observed rebuffering is
  // not allowed to win automatic preparation while any non-degraded clean
  // candidate remains. If every surviving source is degraded, retain the
  // pool so OD can still make progress instead of manufacturing no media.
  const _w121zod125NonDegradedPool =
    usePlaybackHealth
      ? pool.filter((s: any) => {
          const hash = String(
            s?.infoHash || s?.info_hash || ''
          )
            .trim()
            .toLowerCase();

          const health =
            hash ? _v769SeekHealth[hash] : null;

          const policy =
            String(health?.playbackPolicy || '');

          return !(
            policy ===
              _W121ZOD106G_PLAYBACK_HEALTH_POLICY &&
            health?.playback === 'degraded'
          );
        })
      : pool;

  const _w121zod125UsingNonDegraded =
    usePlaybackHealth &&
    _w121zod125NonDegradedPool.length > 0;

  if (_w121zod125UsingNonDegraded) {
    pool = _w121zod125NonDegradedPool;
  }

  if (usePlaybackHealth) {
    try {
      console.log(
        '[W121ZOD125 DEGRADED LAST RESORT]',
        'eligible=' + String(pool.length),
        'nonDegraded=' +
          String(_w121zod125NonDegradedPool.length),
        'usingNonDegraded=' +
          String(_w121zod125UsingNonDegraded)
      );
    } catch (_) {}
  }

  // W121ZOD117A_PROVIDER_SEED_RANK
  //
  // Title/language/device/audio/SDR walls have already executed.
  // This only orders surviving candidates.
  const _w121zod117ProviderRank =
    (s: any): number => {
      const info: any =
        parseStreamInfo(s);

      const text =
        (
          blob(s) +
          ' ' +
          String(info?.source || '')
        ).toUpperCase();

      if (
        /\bTHEPIRATEBAY\b/.test(text) ||
        /\bTPB\+?\b/.test(text) ||
        /PIRATE\s*BAY/.test(text)
      ) {
        return 4;
      }

      if (
        /\bTORRENTGALAXY\b/.test(text) ||
        /\bTGX\b/.test(text)
      ) {
        return 3;
      }

      if (
        /\bYTS(?:\.MX)?\b/.test(text) ||
        /\bYIFY\b/.test(text)
      ) {
        return 2;
      }

      if (/\bTORRENTIO\b/.test(text)) {
        return 1;
      }

      return 0;
    };

  const _w121zod117SeederRank =
    (s: any): number => {
      const info: any =
        parseStreamInfo(s);

      const seeders =
        Number(
          s?.seeders ||
          s?.seeds ||
          info?.seeders ||
          0
        );

      if (
        !Number.isFinite(seeders) ||
        seeders <= 0
      ) {
        return 0;
      }

      return Math.min(
        seeders,
        100000
      );
    };

  const ranked = pool
    .map((s: any, i: number) => ({
      s,
      i,
      q: qualityRank(s),
      m: _v665bMasterRank(s),
      c: _v665VideoCompatRank(s),
      a: audioRank(s),
      h: _v769SeekHealthRank(s),
      p: _w121zod117ProviderRank(s),
      z: _w121zod117SeederRank(s),
      r: reliabilityRank(s),
      d: _v106aTransferBytes(s),
    }))
    .sort((x: any, y: any) =>
      // W121ZOD110D_RELIABILITY_BEFORE_QUALITY
      //
      // Correct/device-safe candidates have already passed the hard walls above.
      // Within that safe pool:
      //   1. proven playback / FF / RW health wins first,
      //   2. source reliability wins before prettier quality/audio metadata,
      //   3. quality/audio optimize only among similarly healthy sources.
      //
      // A 1080p source with negative reliability must not outrank another
      // device-safe 1080p source with strong reliability simply because its
      // audio score is slightly higher.
      // W121ZOD115I_PHONE_OD_POLICY
      // W121ZSA order: quality -> FF/RW health -> source master ->
      // device video compatibility -> audio -> reliability.
      // W121ZOD117A_FINAL_AUTOPLAY_ORDER
      //
      // English/device/audio/SDR safety are hard walls above.
      // Then:
      // 1080p -> decoder fit -> proven local sustainability ->
      // preferred source -> seeders -> release -> audio -> reliability.
      (y.q - x.q) ||
      (y.c - x.c) ||
      (y.h - x.h) ||
      (
        Number.isFinite(x.d) &&
        Number.isFinite(y.d) &&
        x.d > 0 &&
        y.d > 0
          ? (x.d - y.d)
          : 0
      ) ||
      (y.p - x.p) ||
      (y.z - x.z) ||
      (y.m - x.m) ||
      (y.a - x.a) ||
      (y.r - x.r) ||
      (x.i - y.i)
    );

  const pick = ranked[0];

  if (_v106aCompactAuto) {
    console.log('[W121ZOD106A OD COMPACT PICK]',
      'hash=' + String(pick.s?.infoHash || pick.s?.info_hash || '').slice(0, 12),
      'transferBytes=' + (Number.isFinite(pick.d) ? String(Math.round(pick.d)) : 'UNKNOWN'),
      'seeders=not-used-for-https');
  }

  try {
    const info: any = parseStreamInfo(pick.s);

    console.log(
      '[V652 AUTO PICK]',
      'pool=' + (nonForeign.length > 0 ? 'ENGLISH' : 'FOREIGN_FALLBACK'),
      'audioPool=' + (_v652UsingSafeAudio ? 'SAFE' : 'UNSAFE_FALLBACK'),
      'videoOrder=ENGLISH>DEVICE_SAFE>SDR>1080P>CODEC>SUSTAINABILITY>COMPACT_RELATIVE>PROVIDER>SEEDERS>MASTER>AUDIO>RELIABILITY',
      'master=' + pick.m,
      'deviceProfile=' + (
        _v665LowMemoryTv
          ? 'LOW_MEMORY_TV_1080_H264'
          : _v665DeviceCanPrefer4k
            ? '4K_TV_DEVICE_AWARE'
            : '1080_DEFAULT'
      ),
      'memoryClassMb=' + _v665MemoryClassMb,
      'sdrPool=' + (_v665UsingSdr ? 'SDR' : 'HDR_FALLBACK'),
      'videoCompat=' + pick.c,
      'english=' + nonForeign.length,
      'playable=' + playable.length,
      'quality=' + String(info?.quality || '?'),
      'audio=' + pick.a,
      'sustainability=' + (
        pick.h >= 60
          ? 'PROVEN_SUSTAINED'
          : pick.h >= 30
            ? 'UNKNOWN'
            : pick.h >= 10
              ? 'DEGRADED'
              : pick.h < 0
                ? 'FAILED'
                : 'N/A'
      ),
      'seekHealth=' + (
        pick.h === 5
          ? 'EOF+FF+RW_PASS'
          : pick.h === 4
            ? 'FF+RW_PASS'
            : pick.h === 3
              ? 'NATURAL_EOF_PASS'
              : pick.h === 2
                ? 'PARTIAL_SEEK_PASS'
                : pick.h < 0
                  ? 'FAIL_ONLY_FALLBACK'
                  : 'UNKNOWN'
      ),
      'seekPool=' + (
        _v769UsingNonFailed
          ? 'NON_FAILED'
          : 'FAILED_ONLY'
      ),
      'reliability=' + pick.r,
      '|',
      String(pick.s?.title || pick.s?.name || '').slice(0, 140)
    );
  } catch (_) {}

  return pick.s as Stream;
}
// Stream Card Component - 3-row vertical layout (PATCH_V19A_STREAMCARD_MEMO React.memo)
// V302_STREAMCARD_REDESIGN_BUILD_TAG â€” top-center play button, removes the
// "Stream" label row, moves size into the bottom badge row right of
// quality, bumps card font sizes for legibility on TV/Firestick at 10ft.
//
// Layout:
//   [        â–¶  (large, centered, gold)        ]
//   [  [LANG]  [QUALITY]  9.1 GB                ]
//
// Verification: findstr /C:"V302_STREAMCARD_REDESIGN_BUILD_TAG"
const _V301_BUILD_TAG = 'V301_UI_TERMINOLOGY_CLEANUP_BUILD_TAG';
const _V302_BUILD_TAG = 'V302_STREAMCARD_REDESIGN_BUILD_TAG';
void _V301_BUILD_TAG; void _V302_BUILD_TAG;
const StreamCard = React.memo(function StreamCardInner({ 
  stream, 
  onPress 
}: { 
  stream: Stream; 
  onPress: () => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const { quality, size, language, isForeign, isCommentary, languages } = parseStreamInfo(stream) as any;
  // V301/V302: source + seeders intentionally NOT destructured â€” they used
  // to surface provider names (e.g. "Torrentio") and seed counts which leak
  // torrent terminology to end users.  parseStreamInfo still computes them
  // for use by the sort/score logic, but the card no longer renders them.

  // V277_STREAMS_NO_OVERSCROLL â€” when the user is on a stream card and
  // presses DOWN, Android TV searches for a focusable below.  Because
  // there's nothing below the streams row but ScrollView empty space,
  // the system was scrolling the ScrollView a few pixels further before
  // giving up.  Pin nextFocusDown to THIS card's own native tag so the
  // system sees an explicit "stay here" and never tries to scroll.
  const cardRef = useRef<any>(null);
  const [selfTag, setSelfTag] = useState<number | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const t = cardRef.current ? findNodeHandle(cardRef.current) : null;
    if (t) setSelfTag(t);
  }, []);
  
  return (
    <Pressable
      ref={cardRef}
      testID="V647_STREAM_CARD"
      style={[styles.streamCard, isFocused && styles.streamCardFocused]}
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      // V277_STREAMS_NO_OVERSCROLL â€” block DOWN so ScrollView can't shift.
      nextFocusDown={selfTag ?? undefined}
    >
      {/* PATCH_V18_TOPRIGHT_BUBBLE â€” gold chat-bubble at top-right when stream is commentary */}
      {isCommentary && (
        <View style={styles.commentaryBadgeTopRight} pointerEvents="none">
          <Ionicons name="chatbubble" size={12} color="#B8A05C" />
        </View>
      )}
            {/* v474 TOP row: quality | play | size, centered */}
      <View style={styles.v472cTopRow}>
        <View style={[styles.qualityBadge, quality === '4K' && styles.qualityBadge4K]}>
          <Text style={styles.qualityText}>{quality}</Text>
        </View>
        <Ionicons name="play-circle" size={34} color="#B8A05C" style={styles.v474PlayIcon} />
        {size ? (<Text style={styles.v472cSizeText} numberOfLines={1}>{size}</Text>) : null}
      </View>
      {/* v472c BOTTOM row: language flag pills */}
      <View style={styles.streamCardFooter}>
        <View style={styles.v472cFlagRow}>
          {(Array.isArray(languages) && languages.length > 0 ? languages : [language]).map(function(f, i) {
            return (
              <View key={i} style={[styles.langBadge, isForeign ? styles.langBadgeForeign : styles.langBadgeEnglish]}>
                <Text style={styles.langBadgeText}>{f}</Text>
              </View>
            );
          })}
        </View>
      </View>
    </Pressable>
  );
});

// Episode Card Component
// Placeholder component for missing posters/thumbnails
function ComingSoonPlaceholder({ width, height }: { width: number | string; height: number | string }) {
  // V274_LOGO_PLACEHOLDER â€” strip "Coming Soon" wordmark, show ONLY the
  // Privastream logo centered on a dark card so the same placeholder is
  // reused as a skeleton everywhere (poster fallbacks, missing thumbs,
  // cold-boot skeleton).
  return (
    <View
      style={{
        width: width as any,
        height: height as any,
        backgroundColor: '#1a1a1a',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <RNImage
        source={require('../../../assets/images/logo_header.png')}
        style={{ width: '60%', height: '35%', opacity: 0.55 }}
        resizeMode="contain"
      />
    </View>
  );
}

// PATCH_V244_MEMO â€” EpisodeCard re-renders on every parent state change.
// With ~20+ episodes per series page, that's 20+ Pressable re-renders per
// D-pad tick on Firestick.  React.memo skips when episode/onPress identity
// doesn't change â€” Episodes are passed by reference from a memoized list.
const EpisodeCard = React.memo(function EpisodeCard({
  episode,
  fallbackPoster,
  onPress,
  isWatched,
  onMarkUnwatched,
  autoFocus,
  onFocused,
}: {
  episode: Episode;
  fallbackPoster?: string;
  onPress: () => void;
  isWatched?: boolean;
  onMarkUnwatched?: () => void;
  autoFocus?: boolean;
  onFocused?: () => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const [thumbError, setThumbError] = useState(false);
  // v124ab-inject-useref: declare pressableRef + retry-focus effect for EpisodeCard.
  /* v128-focus-cancel */
  const pressableRef = useRef<any>(null);
  // V278_EPISODES_NO_OVERSCROLL â€” pin nextFocusDown to self so Android TV
  // doesn't shift the ScrollView past the episode row.  Same approach as
  // V277 for StreamCard.
  const [selfTag, setSelfTag] = useState<number | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const t = pressableRef.current ? findNodeHandle(pressableRef.current) : null;
    if (t) setSelfTag(t);
  }, []);
  /* v135-focus-unlock */
  // v128 tracked "user moved away" via onBlur to stop the retry timers
  // re-grabbing focus, but on Android TV onBlur races the next focus event
  // and the guard fails intermittently.  v135 instead uses a hard one-shot
  // flag: once we successfully grabbed focus ONCE, never re-grab.
  // Plus we drop the setNativeProps({ hasTVPreferredFocus: true }) line --
  // that's the call that was re-applying the native focus lock and
  // snapping focus back when the user pressed D-pad.
  const hasFocusedRef = useRef(false);
  const userMovedRef = useRef(false);
  const focusGrabbedOnceRef = useRef(false);
  // hasTVPreferredFocus is a one-shot request on Android TV but RN re-applies
  // it on every render of this Pressable.  Tie it to a state flag that flips
  // off after the initial-grab window so RN stops re-asserting the native
  // focus-preferred bit on every re-render.
  const [tvPreferred, setTvPreferred] = useState(!!autoFocus);
  useEffect(() => {
    if (!autoFocus) {
      hasFocusedRef.current = false;
      userMovedRef.current = false;
      focusGrabbedOnceRef.current = false;
      setTvPreferred(false);
      return;
    }
    hasFocusedRef.current = false;
    userMovedRef.current = false;
    focusGrabbedOnceRef.current = false;
    setTvPreferred(true);
    const tryFocus = (delay: number) => {
      if (userMovedRef.current || focusGrabbedOnceRef.current) {
        console.log('[FOCUS v135] skip retry@' + delay + 'ms (moved=' + userMovedRef.current + ' grabbed=' + focusGrabbedOnceRef.current + ')');
        return;
      }
      try {
        const p: any = pressableRef.current;
        if (!p) return;
        if (typeof p.focus === 'function') {
          console.log('[FOCUS v135] retry@' + delay + 'ms p.focus() ep=' + episode.episode);
          try { p.focus(); } catch (_) {}
        }
      } catch (_) {}
    };
    const tries = [60, 200, 500];
    const timers = tries.map((delay) => setTimeout(() => tryFocus(delay), delay));
    // Release the React-level hasTVPreferredFocus flag after the initial
    // grab window so RN stops re-applying the native focus lock on every
    // subsequent render.
    const releaseTimer = setTimeout(() => {
      console.log('[FOCUS v135] releasing hasTVPreferredFocus for ep=' + episode.episode);
      setTvPreferred(false);
    }, 600);
    return () => {
      timers.forEach((t) => clearTimeout(t));
      clearTimeout(releaseTimer);
    };
  }, [autoFocus, episode.episode]);
  const thumbUri = episode.thumbnail || fallbackPoster;

  /* V176C_EPISODE_MENU â€” press-timing long-press (Pressable.onLongPress
     is unreliable on Firestick / Android TV) opens a Stremio-style menu
     for this episode.  The id must match what the player writes to
     AsyncStorage[privastream_watched]. */
  const _v176cEpId = ((episode as any).content_id || (episode as any).id) as string | undefined;
  const [, _v176cBump] = useState(0);
  useEffect(() => _v176cV172SubWatched(() => _v176cBump((x) => (x + 1) & 0xff)), []);
  useEffect(() => _v176cV176SubProg(() => _v176cBump((x) => (x + 1) & 0xff)), []);

  const _v176cOpenEpMenu = useCallback(async () => {
    const id = _v176cEpId;
    if (!id) return;
    const title = `S${(episode as any).season ?? '?'} \u00B7 E${(episode as any).episode ?? '?'}`
      + ((episode as any).name ? ` \u2014 ${(episode as any).name}` : '');
    /* V176K_POPOVER_MOUNTED â€” episodes use a custom action set (no Library). */
    const actions: any[] = [];
    const hasProg = _v176cV176HasProg(id);
    if (hasProg) {
      actions.push({ id: 'clear', label: 'Clear Progress', icon: 'refresh-circle-outline',
        onPress: () => { _v176cV176Clear(id); } });
    }
    const watchedNow = !!isWatched || _v176cV172IsWatched(id);
    if (watchedNow) {
      actions.push({ id: 'unwatch', label: 'Mark as Unwatched', icon: 'eye-off-outline',
        onPress: () => { _v176cV172Unmark(id); try { onMarkUnwatched && onMarkUnwatched(); } catch (_) {} } });
    } else {
      actions.push({ id: 'watch', label: 'Mark as Watched', icon: 'checkmark-circle-outline',
        onPress: () => { _v176cV176Mark(id); } });
    }
    if (!actions.length) return;
    let anchor: any = null;
    try { anchor = await v176kMeasureAnchor(pressableRef.current); } catch (_) {}
    v176kEmitOpen({ anchor, title, actions });
  }, [episode, isWatched, onMarkUnwatched, _v176cEpId]);

  /* V176I_EPISODE_PAINT â€” ref-of-latest-opener so the v173 dispatcher
     never holds a stale watched-state closure between long-presses. */
  const _v176iEpLpRef = useRef<(() => void) | null>(null);
  _v176iEpLpRef.current = _v176cOpenEpMenu;

  const _v176cLpTimer = useRef<any>(null);
  const _v176cLpFired = useRef<boolean>(false);
  const _v176cPressIn = useCallback(() => {
    _v176cLpFired.current = false;
    if (_v176cLpTimer.current) clearTimeout(_v176cLpTimer.current);
    _v176cLpTimer.current = setTimeout(() => {
      _v176cLpFired.current = true;
      try { _v176cOpenEpMenu(); } catch (_) {}
    }, 500);
  }, [_v176cOpenEpMenu]);
  const _v176cPressOut = useCallback(() => {
    if (_v176cLpTimer.current) {
      clearTimeout(_v176cLpTimer.current);
      _v176cLpTimer.current = null;
    }
  }, []);
  const _v176cOnPress = useCallback(() => {
    if (_v176cLpFired.current) { _v176cLpFired.current = false; return; }
    try { onPress && onPress(); } catch (_) {}
  }, [onPress]);
  
  return (
    <Pressable
      ref={pressableRef}
      testID="V647_EPISODE_CARD"
      style={[styles.episodeCard, isFocused && styles.episodeCardFocused]}
      onPress={_v176cOnPress}
      onPressIn={_v176cPressIn}
      onPressOut={_v176cPressOut}
      onLongPress={_v176cOpenEpMenu}
      // V278_EPISODES_NO_OVERSCROLL â€” stop Android TV from shifting the
      // ScrollView past the episode row when DOWN is pressed.
      nextFocusDown={selfTag ?? undefined}
      /* V176H2_EPISODE_FOCUS_MERGE â€” ONE merged onFocus that does BOTH
         the v135 focus-state bookkeeping AND the v173 long-press
         registration.  The previous build had TWO onFocus props on the
         same Pressable, so React dropped the v173 registration and
         TV remote OK long-press never reached this card.  Now unified.
         Also always registers (no isWatched guard) so unwatched episodes
         can be marked watched. */
      onFocus={() => {
        setIsFocused(true);
        hasFocusedRef.current = true;
        focusGrabbedOnceRef.current = true;
        try { onFocused && onFocused(); } catch (_) {}
        console.log('[FOCUS v135] onFocus ep=' + episode.episode + ' (one-shot guard set)');
        /* V176I_EPISODE_PAINT â€” register a stable wrapper that reads
           the latest opener from the ref, so toggling watched in the
           menu doesn't strand the next long-press with a stale value. */
        try { _v173RegLP(() => { try { _v176iEpLpRef.current && _v176iEpLpRef.current(); } catch (_) {} }); } catch (_) {}
      }}
      onBlur={() => {
        setIsFocused(false);
        if (hasFocusedRef.current) {
          userMovedRef.current = true;
          console.log('[FOCUS v135] onBlur ep=' + episode.episode + ' (userMoved=true)');
        }
        try { _v173RegLP(null); } catch (_) {}
      }}
      delayLongPress={600}
      hasTVPreferredFocus={tvPreferred}
    >
      <View style={{ position: 'relative' }}>
        {thumbUri && !thumbError ? (
          <Image
            source={{ uri: thumbUri }}
            style={styles.episodeThumbnail}
            contentFit="cover"
            onError={() => setThumbError(true)}
          />
        ) : (
          <ComingSoonPlaceholder width="100%" height={90} />
        )}
        {/* V176I_EPISODE_PAINT â€” also consult the in-memory _v172WatchedSet
            so Mark-as-Watched lights up the gold check the instant the menu
            closes, no parent state refresh required. */}
        {(isWatched || (!!_v176cEpId && _v176cV172IsWatched(_v176cEpId))) && (
          <View style={styles.watchedBadge}>
            <Ionicons name="checkmark" size={14} color="#B8A05C" />
          </View>
        )}
      </View>
      <View style={styles.episodeInfo}>
        <Text style={styles.episodeTitle} numberOfLines={2}>
          {repairDisplayText(v643bEpisodePosterTitle(episode))}
        </Text>
      </View>
    </Pressable>
  );
});


// V643B_EPISODE_TITLE
// Episode metadata can expose the useful label as title or name.
// The SxEy code is already rendered separately on the episode card.
function v643bEpisodePosterTitle(ep: any): string {
  const season = Number(ep?.season);
  const episodeNo = Number(ep?.episode);

  const validNumbers =
    Number.isFinite(season) &&
    Number.isFinite(episodeNo);

  const exactPrefix =
    validNumbers
      ? new RegExp(
          '^\\s*S0?' + season +
          '\\s*E0?' + episodeNo +
          '\\s*(?:[-??:?]\\s*)?',
          'i'
        )
      : null;

  const pureCode =
    /^S\d+\s*E\d+$/i;

  for (const value of [ep?.title, ep?.name]) {
    const raw = String(value ?? '').trim();

    if (!raw) continue;

    let cleaned = raw;

    if (exactPrefix) {
      // Handles:
      // S1E3
      // S1E3 - S1E3
      // S1E3 - Actual Episode Title
      for (let i = 0; i < 3; i += 1) {
        const next =
          cleaned.replace(exactPrefix, '').trim();

        if (next === cleaned) break;

        cleaned = next;
      }
    }

    if (
      cleaned &&
      !pureCode.test(cleaned)
    ) {
      return cleaned;
    }
  }

  return Number.isFinite(episodeNo)
    ? 'Episode ' + episodeNo
    : 'Episode';
}

export default function DetailsScreen() {
  // V311_PERF_PROFILER - capture details-page lifecycle marks and ship
  // them to the backend /api/debug/perf endpoint for offline analysis.
  /* V369_PERF_ONCE - start()/mark() ran in the component BODY, so every
     re-render (6x per open in lag_capture.log) reset the profiler and
     shipped another bridge log.  Ref-guarded to fire once per mount. */
  const _v369PerfStarted = React.useRef(false);
  if (!_v369PerfStarted.current) {
    _v369PerfStarted.current = true;
    v311Perf.start('details');
    v311Perf.mark('MOUNT');
  }
  React.useLayoutEffect(() => { v311Perf.mark('FIRST_RENDER'); }, []);
  React.useEffect(() => {
    v311Perf.mark('FIRST_EFFECT');
    return () => { v311Perf.mark('UNMOUNT'); v311Perf.flush({ reason: 'unmount' }); };
  }, []);
  const { 
    type, 
    id: rawId, 
    resumeEpisodeId,
    resumePosition,
    resumeSeason,
    resumeEpisode,
    // Display data passed via route params for INSTANT rendering
    name: paramName, poster: paramPoster,
    // v238 â€” accept backdrop + logo from caller for INSTANT detail-page paint
    background: paramBackground,
    logo: paramLogo,
    autoPlay: autoPlayParam,
    fromEpisodeBack: fromEpisodeBackParam,
    selectedSeason: paramSelectedSeason,
    selectedEpisode: paramSelectedEpisode,
    nextTitle: nextTitleParam,
    nextPoster: nextPosterParam,
    nextBackdrop: nextBackdropParam,
  } = useLocalSearchParams<{ 
    type: string; 
    id: string;
    resumeEpisodeId?: string;
    resumePosition?: string;
    resumeSeason?: string;
    resumeEpisode?: string;
    name?: string; poster?: string;
    background?: string;
    logo?: string;
    autoPlay?: string;
    fromEpisodeBack?: string;
    nextTitle?: string;
    nextPoster?: string;
    nextBackdrop?: string;
    selectedSeason?: string;
    selectedEpisode?: string;
  }>();

  const router = useRouter();

  /* V508_EPISODE_ROW_VISIBLE - measured vertical return position; no fixed pixel offset. */
  const _v508DetailsScrollRef = useRef<any>(null);
  const _v508SeasonSectionYRef = useRef<number | null>(null);
  const _v508ScrollEpisodeRowIntoView = useCallback(() => {
    if (fromEpisodeBackParam !== 'true') return;
    const y = _v508SeasonSectionYRef.current;
    if (y == null) return;
    requestAnimationFrame(() => {
      try {
        _v508DetailsScrollRef.current?.scrollTo({ y, animated: false });
        console.log('[V508_EPISODE_ROW_VISIBLE] scrollTo measured season y=' + y);
      } catch (e) { console.log('[V508_EPISODE_ROW_VISIBLE] scroll error', e); }
    });
  }, [fromEpisodeBackParam]);

  // === ANDROID-TV BACK BUTTON FIX =========================================
  // Hardware back from any episode-details page teleports straight to the
  // SERIES ROOT page (with selectedSeason / selectedEpisode set) regardless
  // of how polluted the navigation stack got from auto-binge-watching.
  const navigation = useNavigation();

  const goToSeriesRootWithFocus = useCallback(() => {
    // v124w-clean-stack: with the autoplay v124w fix, the binge stack stays
    // clean at [..., RMroot, currentEpisodePage, player]. A plain router.back()
    // from the episode page lands on RMroot in one press. Then setParams to
    // focus the just-watched episode on the series-root selector.
    const idStr = String(id || '');
    if (type !== 'series' || !idStr.includes(':')) {
      console.log('[BACK-UI v124w] not an episode page, no-op');
      return false;
    }
    const parts = idStr.split(':');
    const s = parts[1] || '';
    const e = parts[2] || '';
    console.log('[BACK-UI v124w] fired idStr=' + idStr + ' season=' + s + ' episode=' + e);
    /* V386_BACK_TO_SERIES_ROOT - Continue Watching (and other deep links)
       push the EPISODE page directly from Discover, so the series root is
       NOT underneath us in the stack and a plain router.back() lands on
       Discover. Inspect the nav state: if the previous route IS this
       series' root, back() as before; otherwise REPLACE this episode page
       with the series root so back always lands on episode selection. */
    const _v386Base = parts[0] || idStr;
    let _v386PrevIsRoot = false;
    try {
      const _st: any = (navigation as any).getState ? (navigation as any).getState() : null;
      const _routes: any[] = (_st && _st.routes) ? _st.routes : [];
      const _idx = (typeof _st?.index === 'number') ? _st.index : (_routes.length - 1);
      const _prev = _idx > 0 ? _routes[_idx - 1] : null;
      const _prevId = (_prev && _prev.params) ? decodeURIComponent(String((_prev.params as any).id || '')) : '';
      _v386PrevIsRoot = !!_prev && _prevId === _v386Base;
      console.log('[V386_BACK] prevId=' + _prevId + ' base=' + _v386Base + ' prevIsRoot=' + _v386PrevIsRoot);
    } catch (_e386) { console.log('[V386_BACK] state inspect failed'); }
    try {
      if (_v386PrevIsRoot) { /* V731_REAL_SERIES_ROOT_BACK - reuse existing series root */
        router.back();
        // After back lands us on RMroot, push focus params so the selector
        // highlights the just-watched episode.
        setTimeout(() => {
          try { router.setParams({ selectedSeason: s, selectedEpisode: e } as any); }
          catch (err) { console.log('[BACK-UI v124w] setParams error', err); }
        }, 80);
      } else {
        console.log('[V386_BACK] no series root beneath - replacing with root');
        router.replace({
          pathname: `/details/series/${encodeURIComponent(_v386Base)}`,
          params: { selectedSeason: s, selectedEpisode: e, fromEpisodeBack: 'true' },
        } as any);
      }
      return true;
    } catch (err) {
      console.log('[BACK-UI v124w] router.back error', err);
      return false;
    }
  }, [id, type, router, navigation]);

  const handleBack = useCallback(() => {
    // V190_BACK_CANCEL â€” drop in-flight stream fetch state-writes
    try { (useContentStore.getState() as any).cancelInFlightStreams?.(); } catch (_) {}
    // V186_BACK_INSTANT â€” hide heavy tree IMMEDIATELY, navigate on next frame.
    /* V361_FAST_UNMOUNT - clear heavy state BEFORE router.back() so React
   has less to tear down (was 2960ms UNMOUNT). Drop stream arrays,
   watchedEpisodes, sortedStreams so their child components can unmount
   immediately instead of waiting for the whole tree teardown pass. */
        const _v361_t0 = Date.now();
        try { _setSortedStreams && _setSortedStreams([]); } catch (_) {}
        try { setWatchedEpisodes && setWatchedEpisodes({}); } catch (_) {}
        /* V363_BROAD_UNMOUNT - broaden clear: content (meta blob), global streams
   store, and any large lists. React unmount cost was regressing to 2.7-3.6s
   on titles with 30+ streams because those child components stayed mounted
   until the parent tore down. */
        try { setContent && setContent(null); } catch (_) {}
        try { (useContentStore as any).setState({ streams: [], isLoadingStreams: false }); } catch (_) {}
        console.log('[V361_UNMOUNT] state cleared t+' + (Date.now() - _v361_t0) + 'ms');
        _setV186Closing(true);
    requestAnimationFrame(() => {
      try {
        if (!goToSeriesRootWithFocus()) router.back();
      } catch (_) {
        try { router.back(); } catch (__) {}
      }
    });
  }, [goToSeriesRootWithFocus, router]);

  /* V506_FOCUSED_BACK_OWNER - only the focused Details screen owns Android hardware Back. */
  useFocusEffect(
    useCallback(() => {
    // PATCH_V34_DETAILS_BACK â€” back ALWAYS does something visible:
    //   1. Series-episode page â†’ goToSeriesRootWithFocus() handles it (returns true)
    //   2. Movies / series-roots â†’ router.back() to previous screen
    //   3. Deep-linked (empty stack) â†’ fall back to Discover tab
    //   4. ALWAYS return true so Android can't force-exit
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      /* v134-back-diag + V186_BACK_INSTANT */
      const _v360_backT0 = Date.now();
        console.log('[V360_BACK] t0=hwBack fired');
        console.log('[BACK v134/v186] main hwBack fired');
        /* V507_BINGE_ROOT_BACK - a series root created by episode Back has no reliable screen beneath it. */
        if (fromEpisodeBackParam === 'true') {
          console.log('[V507_BINGE_ROOT_BACK] tagged binge root -> discover');
          // V730_BINGE_ROOT_POP
          // The episode route was replaced with this tagged series root.
          // Discover is still underneath it, so POP back to that existing
          // screen instead of replacing it with a brand-new Discover mount.
          try {
            router.back();
            console.log('[V730_BINGE_ROOT_POP] back -> existing discover');
          } catch (e) {
            console.log('[V730_BINGE_ROOT_POP] back error', e);
          }
          return true;
        }
      // Hide heavy tree on this frame.
      /* V361_FAST_UNMOUNT - clear heavy state BEFORE router.back() so React
   has less to tear down (was 2960ms UNMOUNT). Drop stream arrays,
   watchedEpisodes, sortedStreams so their child components can unmount
   immediately instead of waiting for the whole tree teardown pass. */
        const _v361_t0 = Date.now();
        try { _setSortedStreams && _setSortedStreams([]); } catch (_) {}
        try { setWatchedEpisodes && setWatchedEpisodes({}); } catch (_) {}
        /* V363_BROAD_UNMOUNT - broaden clear: content (meta blob), global streams
   store, and any large lists. React unmount cost was regressing to 2.7-3.6s
   on titles with 30+ streams because those child components stayed mounted
   until the parent tore down. */
        try { setContent && setContent(null); } catch (_) {}
        try { (useContentStore as any).setState({ streams: [], isLoadingStreams: false }); } catch (_) {}
        console.log('[V361_UNMOUNT] state cleared t+' + (Date.now() - _v361_t0) + 'ms');
        _setV186Closing(true);
        console.log('[V360_BACK] t=' + (Date.now() - _v360_backT0) + 'ms _setV186Closing done');
        // Navigate on the next frame so React can drop the subtree first.
      requestAnimationFrame(() => {
        try { if (goToSeriesRootWithFocus()) { console.log('[BACK v134] -> series-root-with-focus'); return; } } catch (_) {}
        try { router.back();
            console.log('[V361_BACK_FIRED] router.back() called t+' + (Date.now() - _v361_t0) + 'ms'); return; } catch (_) {}
        try { router.replace('/(tabs)/discover'); console.log('[BACK v134] -> replace discover'); } catch (_) {}
      });
      return true;
    });
    return () => sub.remove();
    }, [goToSeriesRootWithFocus, router, fromEpisodeBackParam])
  );
  // ========================================================================


  
  // Use zustand SELECTORS â€” only re-render when these specific fields change
  // This prevents re-renders from unrelated store changes (discover data, addons, etc.)
  const streams = useContentStore(s => s.streams);
  const isLoadingStreams = useContentStore(s => s.isLoadingStreams);
  const fetchStreams = useContentStore(s => s.fetchStreams);
  // PATCH_V19A_SORTED_MEMO â€” memoize the sorted streams list.
  // V157_SORTED_MOVED â€” sortedStreams useMemo relocated to AFTER content
  // declaration so the meta filter has the current content's title+year
  // in scope.
  const library = useContentStore(s => s.library);
  const fetchLibrary = useContentStore(s => s.fetchLibrary);
  
  const id = rawId ? decodeURIComponent(rawId) : rawId;
  
  // Try meta cache first (instant), then route params, then bare minimum
  // W121ZUI116B_META_BASE_ID
  // Episode routes use series metadata. Key memory/disk metadata by the series
  // base ID so the FIRST episode Details visit can hydrate the same rich object
  // that the series root uses.
  const _w121zui116bMetaId =
    type === 'series' &&
    id?.includes(':') &&
    !id?.startsWith('porn') &&
    !id?.startsWith('http')
      ? id.split(':')[0]
      : id;

  const cachedMeta =
    _w121zui116bMetaId
      ? getMetaCache(_w121zui116bMetaId)
      : null;
  // V306_INITIAL_BACKDROP_BUILD_TAG â€” wire the background + logo router
  // params into initialContent so the backdrop image renders on the FIRST
  // frame instead of staying blank until the /meta network call returns
  // (typically 5-8s on cold cache).  V238 passed these params from
  // discover but they were dropped here, which is the actual cause of the
  // perceived "6 seconds to get to the details page" delay.
  const _V306_BUILD_TAG = 'V306_INITIAL_BACKDROP_BUILD_TAG';
  void _V306_BUILD_TAG;
  // W121ZUI116E_FIRST_FRAME_ART_MERGE
  // A partial in-memory meta record must not suppress richer artwork already
  // carried by the Discover route. Seed from route params, overlay cached meta,
  // then explicitly fall back to route artwork for any missing cached fields.
  const initialContent: ContentItem = {
    id: id!,
    imdb_id: id,
    name: paramName || '',
    type: type as 'movie' | 'series',
    poster: paramPoster || '',
    background: paramBackground || '',
    logo: paramLogo || '',
    ...(cachedMeta || {}),
    name: cachedMeta?.name || paramName || '',
    poster: cachedMeta?.poster || paramPoster || '',
    background: cachedMeta?.background || paramBackground || '',
    logo: cachedMeta?.logo || paramLogo || '',
  } as any;
  
  const [content, setContent] = useState<ContentItem | null>(initialContent);

  // V707_DETAILS_RATINGS_FRONTEND - independent Details enrichment state.
  const [v707DetailsRatings, setV707DetailsRatings] = useState<{
    certification: string | null;
    imdb_score: number | null;
    tomatoes_score: number | null;
  } | null>(null);

  // W121ZUI116B_RATINGS_IDENTITY
  // Avoid clearing a score when metadata hydration causes the same IMDb ID to
  // re-render, and allow a 24h local last-known score to paint immediately.
  const _w121zui116bRatingsIdentityRef = useRef<string>('');

  // W121ZUI116B_META_HYDRATE
  // Paint cached rich metadata immediately. Preserve route-provided first-frame
  // artwork if a cached record is missing a field.
  useEffect(() => {
    if (!_w121zui116bMetaId) return;
    if (cachedMeta) return;

    let cancelled = false;

    void (async () => {
      try {
        const fromDisk =
          await hydrateMetaFromDisk(_w121zui116bMetaId);

        if (cancelled || !fromDisk) return;

        setContent((previous: any) => ({
          ...(previous || {}),
          ...fromDisk,
          background:
            (fromDisk as any)?.background ||
            previous?.background ||
            '',
          poster:
            (fromDisk as any)?.poster ||
            previous?.poster ||
            '',
          logo:
            (fromDisk as any)?.logo ||
            previous?.logo ||
            '',
        }));
      } catch (_) {}
    })();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_w121zui116bMetaId]);
  // V157_META_INJECTED_HERE â€” synchronously update the module-level meta
  // holder BEFORE the sort useMemo runs.  This guarantees the title/year
  // guard in sortStreamsByLanguage sees the current content's name+year
  // on every render.
  try {
    /* V161_META_SERIES_FIELDS */
    const _v161_title = ((content && content.name) ? String(content.name) : (paramName ? String(paramName) : ''));
    const _v161_isSeries = (type === 'series');
    _v157_currentMeta = {
      title: _v161_title,
      year: ((content && (content as any).year) ? String((content as any).year) : ''),
      isMovie: (type === 'movie'),
      isSeries: _v161_isSeries,
      seriesWords: _v161_isSeries ? _v161_seriesTitleWords(_v161_title) : [],
    };
  } catch (_v157_e) { _v157_currentMeta = { title: '', year: '', isMovie: false, isSeries: false, seriesWords: [] }; }
  // V349 STREMIO-TRICK: defer sort to after nav animation.
  // Details page paints INSTANTLY with meta + unsorted streams;
  // sort runs in background, list re-orders when done. No JS-thread block on click.
  const [sortedStreams, _setSortedStreams] = useState<Stream[]>(_v672CleanStreamPool(streams || []));
  useEffect(() => {
    if (!streams || streams.length === 0) { _setSortedStreams([]); return; }
    // 1) Show unsorted immediately for progressive paint
    _setSortedStreams(_v672CleanStreamPool(streams));
    // 2) Sort after navigation transition + focus animations finish
    const handle = InteractionManager.runAfterInteractions(() => {
      try {
        const sorted = sortStreamsByLanguage(streams);
        _setSortedStreams(sorted);
      } catch (_) {
        _setSortedStreams(_v672CleanStreamPool(streams));
      }
    });
    return () => { try { handle.cancel(); } catch (_) {} };
  }, [streams, _v157_currentMeta.title, _v157_currentMeta.year, _v157_currentMeta.isMovie]);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [inLibrary, setInLibrary] = useState(false);
  // V186_BACK_INSTANT â€” when true, the Details tree renders a flat placeholder
  // so React Native drops the heavy subtree (BackgroundImage + FlatLists +
  // dozens of FocusableButtons) on the SAME frame, then router.back() fires
  // on the next animation frame.  Result: back feels instant on Firestick.
  const [_v186Closing, _setV186Closing] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [watchedEpisodes, setWatchedEpisodes] = useState<Record<string, boolean>>({});
  const autoPlayTriggeredRef = useRef(false);
  // v121m-play-overlay: movie-aware Play loading overlay
  const [isPlayLoading, setIsPlayLoading] = useState(false);
  // W121ZOD108H4AK_GLOBAL_OD_LOADING_CONTINUITY
  // Once an OD Play request enters pre-player source resolution, keep the
  // loading handoff visible until one of two authoritative outcomes occurs:
  //   1. successful navigation to /player, or
  //   2. an explicit failure path clears isPlayLoading.
  //
  // Do NOT time-expire the overlay while preflight is still active.
  // H4AJ proved fresh movie/series preflight can exceed 30 seconds;
  // the old timeout exposed Details mid-flight and produced:
  // Loading -> Details -> Loading -> Player.
  // v121j-overlay-removed

  const isEpisodePage = type === 'series' && id?.includes(':') && !id?.startsWith('porn') && !id?.startsWith('http');

  /*
   * V667_FIRST_FRAME_STREAM_OWNERSHIP
   *
   * useEffect runs after the first render, so V188 cannot prevent that
   * first frame from seeing streams=[] + isLoadingStreams=false.
   *
   * Track which Details route has actually started its stream request.
   * A newly-entered route is treated as loading immediately, before the
   * mount effect runs. This also hides stale streams from the prior route.
   */
  const [_v667StreamRequestKey, _setV667StreamRequestKey] =
    useState<string | null>(null);

  const _v667ExpectedStreamKey =
    type && id && (type === 'movie' || type === 'tv' || isEpisodePage)
      ? `${type}/${String(id)}`
      : null;

  const _v667EffectiveStreamLoading =
    isLoadingStreams ||
    (
      !!_v667ExpectedStreamKey &&
      _v667StreamRequestKey !== _v667ExpectedStreamKey
    );
  const baseId = isEpisodePage ? id?.split(':')[0] : id;
  const episodeSeason = isEpisodePage ? parseInt(id?.split(':')[1] || '1') : null;
  const episodeNumber = isEpisodePage ? parseInt(id?.split(':')[2] || '1') : null;

  // V706C2N4_DETAILS_PARENTAL_ACCESS_GATE
  const _v706c2n4AccessKey =
    type && id
      ? `${String(type)}/${String(id)}`
      : '';

  const [
    _v706c2n4AccessDecision,
    _setV706c2n4AccessDecision,
  ] = useState<{ key: string; allowed: boolean } | null>(null);

  const _v706c2n4AccessAllowed =
    _v706c2n4AccessDecision?.key === _v706c2n4AccessKey
      ? _v706c2n4AccessDecision.allowed
      : null;

  useEffect(() => {
    let active = true;

    // W121ZUI116E_PREFETCH_HANDOFF
    // Preserve a Discover focus/click prefetch when no different Details route
    // currently owns stream state. The old unconditional cancel cleared the
    // dedup registry without aborting native HTTP, so Details immediately
    // started a second provider-discovery pass while the first was still alive.
    // Only invalidate work when a DIFFERENT Details owner is actually present.
    try {
      const _w121zui116eStore =
        useContentStore.getState() as any;

      const _w121zui116eOwner = String(
        _w121zui116eStore?.currentStreamsKey || ''
      );

      if (
        _w121zui116eOwner &&
        _w121zui116eOwner !== _v706c2n4AccessKey
      ) {
        _w121zui116eStore.cancelInFlightStreams();
      }
    } catch (_) {}

    if (!_v706c2n4AccessKey || !type || !id) {
      _setV706c2n4AccessDecision({
        key: _v706c2n4AccessKey,
        allowed: false,
      });

      return () => {
        active = false;
      };
    }

    void (async () => {
      let allowed = false;

      try {
        allowed = await
          (api.content as any).isAllowedByParentalMode(
            String(type),
            String(id)
          );
      } catch (error) {
        console.warn(
          '[V706C2N4] Details policy lookup failed closed',
          error
        );
        allowed = false;
      }

      if (!active) return;

      _setV706c2n4AccessDecision({
        key: _v706c2n4AccessKey,
        allowed,
      });

      if (!allowed) {
        try {
          (useContentStore as any).setState({
            streams: [],
            isLoadingStreams: false,
            error: null,
          });
        } catch (_) {}

        try {
          router.replace('/(tabs)/discover');
        } catch (_) {}
      }
    })();

    return () => {
      active = false;
    };
  }, [_v706c2n4AccessKey, type, id]);

  const currentEpisode = useMemo(() => {
    if (!isEpisodePage || !content?.videos || !episodeSeason || !episodeNumber) return null;
    return content.videos.find(
      ep => ep.season === episodeSeason && ep.episode === episodeNumber
    );
  }, [isEpisodePage, content?.videos, episodeSeason, episodeNumber]);

  const nextEpisode = useMemo(() => {
    if (!isEpisodePage || !episodeSeason || !episodeNumber) return null;
    
    // Try content.videos first, fall back to cached meta (might be cached under baseId)
    const videos = content?.videos || (baseId ? getMetaCache(baseId)?.videos : null);
    if (!videos) return null;
    
    const sameSeasonNext = videos.find(
      ep => ep.season === episodeSeason && ep.episode === episodeNumber + 1
    );
    if (sameSeasonNext) return sameSeasonNext;
    
    const nextSeasonFirst = videos.find(
      ep => ep.season === episodeSeason + 1 && ep.episode === 1
    );
    return nextSeasonFirst || null;
  }, [isEpisodePage, content?.videos, episodeSeason, episodeNumber, baseId]);

  const seasons = useMemo(() => {
    if (!content?.videos) return [];
    const seasonSet = new Set(content.videos.map(ep => ep.season).filter(s => s > 0));
    return Array.from(seasonSet).sort((a, b) => a - b);
  }, [content?.videos]);

  const episodesForSeason = useMemo(() => {
    if (!content?.videos) return [];
    return content.videos
      .filter(ep => ep.season === selectedSeason)
      .sort((a, b) => a.episode - b.episode);
  }, [content?.videos, selectedSeason]);

  /* v125b-target-episode */
  // Which episode should take TV focus when the series root renders?
  // Priority:
  //   1) explicit paramSelectedEpisode (set by goToSeriesRootWithFocus
  //      when the user backs out of an episode page)
  //   2) highest-numbered watched episode in the current season
  //   3) null â†’ first card takes focus (FlatList default)
  const targetEpisodeNumber = useMemo(() => {
    if (type !== 'series') return null;
    const fromParam = paramSelectedEpisode != null
      ? parseInt(String(paramSelectedEpisode), 10)
      : NaN;
    if (!isNaN(fromParam)) return fromParam;
    const prefix = `${baseId || id}:${selectedSeason}:`;
    const watchedNums = Object.keys(watchedEpisodes)
      .filter((k) => k.startsWith(prefix) && watchedEpisodes[k])
      .map((k) => parseInt(k.split(':')[2], 10))
      .filter((n) => !isNaN(n));
    if (watchedNums.length === 0) return null;
    return Math.max(...watchedNums);
  }, [type, paramSelectedEpisode, watchedEpisodes, baseId, id, selectedSeason]);

  const targetEpisodeIndex = useMemo(() => {
    if (targetEpisodeNumber == null) return 0;
    const idx = episodesForSeason.findIndex(
      (ep) => ep.episode === targetEpisodeNumber
    );
    return idx >= 0 ? idx : 0;
  }, [episodesForSeason, targetEpisodeNumber]);

  /* V139_SERIES_EPISODE_PREWARM â€” when the user lands on a series-root
     page, kick off prefetchStreams for the auto-focused episode in the
     background.  v170b's registry means the click will await the same
     in-flight promise -- streams paint instantly with no spinner. */
  useEffect(() => {
    if (_v706c2n4AccessAllowed !== true) return;
    if (type !== 'series') return;
    if (isEpisodePage) return;            // only on series root
    if (!baseId) return;
    if (!selectedSeason) return;
    if (targetEpisodeNumber == null) return;
    const epId = `${baseId}:${selectedSeason}:${targetEpisodeNumber}`;
    try {
      const pf = useContentStore.getState().prefetchStreams;
      if (typeof pf === 'function') pf('series', epId);
    } catch (_) { /* prefetch is best-effort */ }
  }, [_v706c2n4AccessAllowed, type, isEpisodePage, baseId, selectedSeason, targetEpisodeNumber]);

  useEffect(() => {
    if (_v706c2n4AccessAllowed !== true) return;

    // W121ZUI116B_RICH_META_REFRESH
    // A backdrop proves only that artwork exists; it does NOT prove genre,
    // director, cast, runtime, description, or episodes are populated.
    // Always refresh normal movie/series metadata in the background after the
    // parental gate allows access. api.content.getMeta already owns a short
    // memory cache, so repeat Details navigation remains cheap.
    const _w121zui116bForceJstrmMeta =
      String(id || '').startsWith('jstrm:');

    const _w121zui116bNeedsRichMeta =
      _w121zui116bForceJstrmMeta ||
      type === 'movie' ||
      type === 'series' ||
      !content?.background;

    if (_w121zui116bNeedsRichMeta) {
      setTimeout(() => {
        try {
          void loadContent();
        } catch (_) {}
      }, 0);
    }
    setTimeout(() => { try { fetchLibrary(); } catch (_) {} }, 0);
    // V780A_ADULT_DETAILS_STREAM_GATE
    if (
      type &&
      id &&
      (
        type === 'movie' ||
        type === 'tv' ||
        type === 'Porn' ||
        type === 'porn' ||
        type === 'adult' ||
        isEpisodePage
      )
    ) {
      if (_v667ExpectedStreamKey) {
        _setV667StreamRequestKey(_v667ExpectedStreamKey);
      }
      // V188_NO_ZERO_FLASH â€” sync-seed loading state so the very first render
      // shows "Finding Streams..." instead of momentarily flashing "0 Streams"
      // (which can happen if streams=[] is left over from a prior failed load).
      try {
        const _v746OwnerKey = `${String(type)}/${String(id)}`;
        (useContentStore as any).setState({
          currentStreamsKey: _v746OwnerKey,
          streams: [],
          isLoadingStreams: true,
          error: null,
        });
        console.log('[V746 STREAM OWNER] claim', _v746OwnerKey);
      } catch (_) {}
      // PATCH_V37_DEFER_STREAMS â€” defer to next tick so the details page paints
      // instantly; streams load in the background and populate as they arrive.
      const _v37StreamsTimer = setTimeout(() => { try { fetchStreams(type, id); } catch (_) {} }, 0);
    }
  }, [id, type, _v706c2n4AccessAllowed]);

  // W121ZUI116B_DETAILS_RATINGS_FAST
  // Ratings remain independent of normal metadata/playback. Start network
  // enrichment immediately once access is allowed, while painting a 24h
  // locally-cached last-known result when available.
  useEffect(() => {
    let cancelled = false;
    let networkApplied = false;

    if (_v706c2n4AccessAllowed !== true) {
      return () => {
        cancelled = true;
      };
    }

    if (type !== 'movie' && type !== 'series') {
      return () => {
        cancelled = true;
      };
    }

    const ratingsImdbId = String(
      content?.imdb_id ||
      (isEpisodePage ? baseId : id) ||
      ''
    ).split(':')[0];

    if (!/^tt\d+$/.test(ratingsImdbId)) {
      return () => {
        cancelled = true;
      };
    }

    const ratingsIdentity =
      `${String(type)}:${ratingsImdbId}`;

    const ratingsDiskKey =
      `@detailsRatings:v1:${ratingsIdentity}`;

    if (
      _w121zui116bRatingsIdentityRef.current !==
      ratingsIdentity
    ) {
      _w121zui116bRatingsIdentityRef.current =
        ratingsIdentity;

      setV707DetailsRatings(null);
    }

    const applyRatings = (data: any) => {
      if (cancelled || !data) return;

      setV707DetailsRatings({
        certification:
          data.certification ?? null,
        imdb_score:
          data.imdb_score ?? null,
        tomatoes_score:
          data.tomatoes_score ?? null,
      });
    };

    // Local paint and network refresh deliberately run in parallel.
    void AsyncStorage.getItem(ratingsDiskKey)
      .then((raw) => {
        if (
          cancelled ||
          networkApplied ||
          !raw
        ) {
          return;
        }

        try {
          const parsed = JSON.parse(raw);
          const age =
            Date.now() -
            Number(parsed?.time || 0);

          if (
            parsed?.data &&
            Number.isFinite(age) &&
            age >= 0 &&
            age < 24 * 60 * 60 * 1000
          ) {
            applyRatings(parsed.data);

            console.log(
              '[W121ZUI116B RATINGS DISK HIT]',
              ratingsIdentity
            );
          }
        } catch (_) {}
      })
      .catch(() => {});

    void api.content
      .getRatings(type, ratingsImdbId)
      .then((data) => {
        if (cancelled) return;

        networkApplied = true;
        applyRatings(data);

        void AsyncStorage.setItem(
          ratingsDiskKey,
          JSON.stringify({
            time: Date.now(),
            data: {
              certification:
                data.certification ?? null,
              imdb_score:
                data.imdb_score ?? null,
              tomatoes_score:
                data.tomatoes_score ?? null,
            },
          })
        ).catch(() => {});
      })
      .catch((error) => {
        if (cancelled) return;

        console.log(
          '[W121ZUI116B] Details ratings enrichment failed:',
          String((error as any)?.message || error)
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    type,
    id,
    baseId,
    isEpisodePage,
    content?.imdb_id,
    _v706c2n4AccessAllowed,
  ]);
  /* V656_DETAILS_PM_ONLY_PREWARM_OWNER
   * Legacy V180 server prewarm removed.
   * The active V291 hook below owns details-page prewarm through
   * api.stream.start(), which resolves infoHash playback through Premiumize only.
   */

  useEffect(() => {
    if (seasons.length === 0) return;
    const fromParam = paramSelectedSeason ? parseInt(paramSelectedSeason as string, 10) : NaN;
    if (!isNaN(fromParam) && seasons.includes(fromParam)) {
      if (selectedSeason !== fromParam) setSelectedSeason(fromParam);
      return;
    }
    if (!seasons.includes(selectedSeason)) {
      setSelectedSeason(seasons[0]);
    }
  }, [seasons, paramSelectedSeason]);

  // Hardware back (Firestick remote / Android back) â€” when the user reached
  // this detail page via Play-Next autoplay, intercept back so they go to
  // the episodes list (series root) instead of the previous episode's page.
  // Matches Stremio: back from next-up screen = back to the show, not to EP-N-1.
  useEffect(() => {
    /* V505_PERSISTENT_EPISODE_BACK - unified BackHandler above owns all episode back navigation. */
    const _v505DisableLegacyAutoPlayBack = true;
    if (_v505DisableLegacyAutoPlayBack) return;
    if (autoPlayParam !== 'true' || type !== 'series' || !baseId) return;
    const handler = () => {
      /* v134-clean-stack-on-back */
      // Dismiss every screen above the tab root so leftover /player(s)
      // from the binge chain UNMOUNT and their TVKeyEvent listeners get
      // cleaned up.  Without this, D-pad presses on the series root are
      // intercepted by the still-mounted player and the screen goes back.
      console.log('[BACK v134] autoPlay back fired; dismissing stack and replacing with series root', baseId);
      try { router.dismissAll && router.dismissAll(); } catch (e) { console.log('[BACK v134] dismissAll err', e); }
      try {
        router.replace({ pathname: `/details/series/${baseId}` });
      } catch (e) {
        console.log('[BACK v134] replace err', e);
      }
      return true; // swallow the default back nav
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
  }, [autoPlayParam, type, baseId]);

  useEffect(() => {
    if (content && library) {
      const contentList = type === 'movie' ? library.movies : library.series;
      const found = contentList?.some(
        (item) => item.id === content.id || item.imdb_id === content.id
      );
      setInLibrary(!!found);
    }
  }, [content, library]);

  // Load watched episodes from AsyncStorage â€” reload on EVERY screen focus
  // so checkmarks appear immediately after returning from the player
  useFocusEffect(
    useCallback(() => {
      const loadWatched = async () => {
        try {
          const data = await AsyncStorage.getItem('privastream_watched');
          if (data) setWatchedEpisodes(JSON.parse(data));
        } catch (e) {
          console.log('[DETAILS] Error loading watched data:', e);
        }
      };
      loadWatched();
      /* v134-clear-overlay */
      // Returning from /player keeps this screen mounted with stale
      // isPlayLoading / autoPlay=true, leaving the loading overlay up.
      // Clear them on every focus so the user actually sees the content.
      console.log('[FOCUS v134] details focused, clearing overlay; autoPlayParam=', autoPlayParam, ' isPlayLoading-cleared');
      setIsPlayLoading(false);
      if (autoPlayTriggeredRef.current && autoPlayParam === 'true') {
        try {
          router.setParams({ autoPlay: 'done' });
          console.log('[FOCUS v134] stripped autoPlay param');
        } catch (e) {
          console.log('[FOCUS v134] setParams failed', e);
        }
      }
    }, [autoPlayParam])
  );

  // AUTO-PLAY: When navigated from "Play Next", auto-select best stream from
  // the FRESH stream list. We deliberately do NOT carry over the previous
  // episode's torrent hash â€” Stremio doesn't either. Each episode click does
  // a clean Torrentio scrape and picks the best (debrid-cached, top seeded) stream.
  //
  // We wait for `content` to populate before firing â€” this ensures the player's
  // loading screen has the series backdrop/logo (not a blank black screen).
  const streamsLoadedFreshRef = useRef(false);
  const autoPlayAttemptsRef = useRef(0);
  const lastAutoPlayIdRef = useRef<string | null>(null);

  // CRITICAL: Reset the auto-play state when the episode id changes.
  // Expo Router uses router.replace() between episodes which re-renders this
  // component instead of unmounting it â€” so refs persist and would otherwise
  // block the second/third/Nth auto-transition. Resetting here makes every
  // new id behave like a fresh mount.
  useEffect(() => {
    if (id && id !== lastAutoPlayIdRef.current) {
      lastAutoPlayIdRef.current = id;
      autoPlayTriggeredRef.current = false;
      streamsLoadedFreshRef.current = false;
      autoPlayAttemptsRef.current = 0;
    }
  }, [id]);

  useEffect(() => {
    if (isLoadingStreams) {
      streamsLoadedFreshRef.current = true;
    }
    if (autoPlayParam === 'true' && !autoPlayTriggeredRef.current && streamsLoadedFreshRef.current && streams && streams.length > 0 && !isLoadingStreams) {
      // Wait up to ~2s for content to load so backdrop/logo are populated.
      // Stops early as soon as content.background is present.
      const contentReady = !!(content && (content.background || content.poster));
      if (!contentReady && autoPlayAttemptsRef.current < 20) {
        autoPlayAttemptsRef.current += 1;
        const t = setTimeout(() => {
          // Trigger a re-render by tickling streams dependency
          streamsLoadedFreshRef.current = true;
        }, 100);
        return () => clearTimeout(t);
      }

      /* v125b-no-flash */
      const sorted = sortStreamsByLanguage(streams);
      // v498 AUTOPLAY FILTER - best 4K English non-HDR non-BluRay, ranked by audio codec
      const _v498_isBluRayLike = (t: string): boolean => {
        const u = String(t || '').toUpperCase();
        return u.includes('BLURAY') || u.includes('BLU-RAY') || u.includes('BDRIP') || u.includes('BD-RIP') || u.includes('BRRIP') || u.includes('BR-RIP') || u.includes('REMUX');
      };
      const _v498_audioRank = (t: string): number => {
        const u = String(t || '').toUpperCase();
        if (/\bATMOS\b/.test(u)) return 100;
        if (/\bDTS[-. ]?X\b/.test(u)) return 90;
        if (/\bTRUE ?HD\b/.test(u)) return 80;
        if (/\bDTS[-. ]?HD[-. ]?MA\b/.test(u)) return 70;
        if (/\bDTS[-. ]?HD\b/.test(u)) return 60;
        if (/\bE-?AC-?3\b|\bDDP\b|\bDD\+/.test(u)) return 50;
        if (/\bDTS\b/.test(u)) return 40;
        if (/\bAC-?3\b|\bDD ?5\b/.test(u)) return 30;
        if (/\bAAC\b/.test(u)) return 20;
        return 0;
      };
      const _v498_pickBest = (list: any[], predicate: (info: any, blob: string) => boolean): any => {
        const cand = list
          .map((s: any) => {
            const info = parseStreamInfo(s) as any;
            const blob = ((s?.name || '') + ' ' + (s?.title || ''));
            return { s, info, blob, aScore: _v498_audioRank(blob) };
          })
          .filter((x: any) => predicate(x.info, x.blob));
        cand.sort((a: any, b: any) => (b.aScore - a.aScore));
        return cand.length ? cand[0].s : null;
      };
      const _v498_t1 = _v498_pickBest(sorted, (i, b) => i.quality === '4K'    && !i.isForeign && !i.isHDR && !_v498_isBluRayLike(b) && !i.isCommentary);
      const _v498_t2 = _v498_pickBest(sorted, (i, b) => i.quality === '4K'    && !i.isForeign && !i.isHDR                          && !i.isCommentary);
      const _v498_t3 = _v498_pickBest(sorted, (i, b) => i.quality === '1080p' && !i.isForeign            && !_v498_isBluRayLike(b) && !i.isCommentary);
      const _v498_t4 = _v498_pickBest(sorted, (i, _b) => i.quality === '1080p' && !i.isForeign                                     && !i.isCommentary);
      const bestStream = _v503PickReliableAutoStream(sorted, type === 'movie' || type === 'series') || sorted[0];
      try {
        const _tier = _v498_t1 ? '4K_ENG_noHDR_noBluRay' : _v498_t2 ? '4K_ENG_noHDR' : _v498_t3 ? '1080p_ENG_noBluRay' : _v498_t4 ? '1080p_ENG' : 'RAW_TOP';
        console.log('[v498] auto-play tier=' + _tier + ' | ' + String((bestStream && (bestStream as any).title) || '').slice(0, 110));
      } catch (_) {}
      if (bestStream) {
        console.log('[AUTOPLAY] Content ready:', contentReady, '- selecting best stream for', id, '->', bestStream.title || bestStream.name);
        // V274_SEAMLESS_CW_LOADING â€” was clearing autoPlay param + waiting
        // 200ms before navigating, which caused the overlay condition
        // `autoPlayParam === 'true'` to flip false â†’ details flash â†’ 200ms
        // gap â†’ player loading screen.  Now: keep the loading overlay up,
        // fire navigation IMMEDIATELY.  The details page unmounts on the
        // navigation tick and the player's loading screen takes over with
        // no visible gap.
        setIsPlayLoading(true);
        autoPlayTriggeredRef.current = true;
        handleStreamSelect(bestStream);
      } else {
        autoPlayTriggeredRef.current = true;
        try { router.setParams({ autoPlay: '' } as any); } catch (_) {}
      }
    }
  }, [streams, isLoadingStreams, autoPlayParam, id, content]);

  // V297_PM_KEY_SEED_BUILD_TAG â€” verification marker, never rendered.
  //
  // Seeds the user's Premiumize API key into AsyncStorage on first app run
  // so on-device PM resolution works without requiring manual entry in the
  // Settings UI.  After the legal middle-isolation work stripped the PM key
  // from the backend's MongoDB, the device had no way to obtain the key on
  // a fresh install.  Result: every torrent-only title (Project Hail Mary,
  // Pressure, etc.) failed to play because client.ts could not short-circuit
  // through PM and fell back to a backend endpoint that no longer resolves.
  //
  // Seeding logic:
  //   1. If '@pm_key_v1' already has a non-empty value, do nothing.
  //   2. Else, write the build-constant key and set '@pm_key_v297_seeded=1'.
  //   3. If the user later clears the key via the Privacy Settings UI, the
  //      seed flag remains set so we do NOT re-seed â€” user retains control.


  // V296_PM_CACHE_CHECK â€” when streams load, POST every infoHash (up to 50)
  // to Premiumize's /cache/check endpoint.  Results populate _v296_cacheMap
  // which the sort + score logic above reads.  Side effect: sets cacheTick
  // to trigger a re-sort once the response arrives.
  const [_v296_cacheTick, _v296_setCacheTick] = useState(0);
  useEffect(() => {
    if (!streams || streams.length === 0) return;
    if (isLoadingStreams) return;
    const _contentKey = String(id || '') + ':' + streams.length;
    if (_v296_checkedKeys.has(_contentKey)) return;
    _v296_checkedKeys.add(_contentKey);
    let _cancelled = false;
    (async () => {
      try {
        const _hashes: string[] = [];
        const _seen = new Set<string>();
        // W121ZOD118H2_RELEASE_DEDUPE
        // Different indexers can expose the same release under different
        // hashes. Do not spend scarce cache-check slots on duplicate files.
        const _w121zod118h2CacheReleaseSeen =
          new Set<string>();
        const _w121zod118h1HealthMap =
          _v769GetSeekHealthMap();

        // W121ZOD118H1_CACHE_CHECK_HYGIENE
        // Do not spend Premiumize cache-check time on obvious garbage.
        for (const _s of streams) {
          if (!_s || !(_s as any).infoHash) continue;
          if (_v672IsSampleLikeStream(_s)) continue;
          if (_w121zod108e1IsStrictForeignStream(_s)) continue;

          const _h = String((_s as any).infoHash)
            .trim()
            .toLowerCase();

          if (!_h || _seen.has(_h)) continue;
          if (_v296_cacheMap.has(_h)) continue;

          const _w121zod118h2CacheFilename =
            String((_s as any)?.filename || '')
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, ' ')
              .trim();

          if (
            _w121zod118h2CacheFilename.length >= 24 &&
            _w121zod118h2CacheReleaseSeen.has(
              _w121zod118h2CacheFilename
            )
          ) {
            continue;
          }

          const _health =
            _w121zod118h1HealthMap[_h];

          if (
            _health?.ff === 'fail' ||
            _health?.rw === 'fail' ||
            _w121zod106gPlaybackBadForSelection(_health)
          ) {
            continue;
          }

          _seen.add(_h);

          if (_w121zod118h2CacheFilename.length >= 24) {
            _w121zod118h2CacheReleaseSeen.add(
              _w121zod118h2CacheFilename
            );
          }

          _hashes.push(_h);

          // Twenty already-clean candidates are more than enough for the
          // automatic queue. Manual cards remain untouched.
          if (_hashes.length >= 20) break;
        }
        if (_hashes.length === 0) {
          console.log('[v296] all hashes already in cache map');
          return;
        }
        // V509: backend owns the Premiumize credential; client sends hashes only.
        const _response = await premiumizeCacheCheck(_hashes, 3500); // W121ZOD118H1_FAST_CACHE_CHECK
        if (_cancelled) return;
        let _cached = 0;
        for (let _i = 0; _i < _hashes.length; _i++) {
          const _isCached = !!_response[_i];
          _v296_cacheMap.set(_hashes[_i], _isCached);
          if (_isCached) _cached++;
        }
        console.log('[v296] PM /cache/check:', _cached + '/' + _hashes.length, 'cached for', _contentKey);
        _v296_setCacheTick((t) => t + 1);
      } catch (_e) {
        console.log('[v296] PM /cache/check threw:', String((_e as any)?.message || _e));
      }
    })();
    return () => { _cancelled = true; };
  }, [streams, isLoadingStreams, id]);

  // W121ZOD110Y_DETAILS_VALIDATION_OVERLAP
  //
  // Expensive OD validation may run while the user is reading Details.
  // Results are scoped to this mounted Details content and exact hash.
  // Play remains authoritative: V300 re-runs all existing decisions
  // and may reuse only exact matching network/probe stage results.
  const _w121zod110yPrepCacheRef =
    useRef<Map<string, any>>(new Map());

  const _w121zod110yPrepContextRef =
    useRef<string>('');

  const _w121zod110yPrepContextKey =
    String(type || '') + '|' + String(id || '');

  if (
    _w121zod110yPrepContextRef.current !==
    _w121zod110yPrepContextKey
  ) {
    _w121zod110yPrepCacheRef.current.clear();
    _w121zod110yPrepContextRef.current =
      _w121zod110yPrepContextKey;
  }

  // W121ZOD111E_PREPARING_MEDIA_UI
  //
  // Normal movie/episode Play remains hidden until the current
  // auto-selected candidate has completed the expensive preparation
  // that makes Play useful: directDL + exact file + media compatibility.
  //
  // W121ZOD118A_HARD_PREP_GATE
  // Play stays hidden until the exact automatic winner has completed
  // directDL, exact media validation and native delivery/seek readiness.
  // There is no timer-based fail-open.
  const [
    _w121zod111ePrepUiTick,
    _w121zod111eSetPrepUiTick,
  ] = useState(0);


  // Reading the tick intentionally ties ref-only preparation changes
  // to a lightweight React render without moving the preparation cache
  // itself into React state.
  void _w121zod111ePrepUiTick;

  // W121ZOD118H1_READY_ENTRY_FIRST
  // If speculative/background work leaves more than one entry in this
  // content context, UI authority belongs to a completed ready winner first.
  const _w121zod118h1PrepEntries =
    Array.from(
      _w121zod110yPrepCacheRef.current.values()
    ).filter((entry: any) =>
      String(entry?.key || '').startsWith(
        _w121zod110yPrepContextKey + '|'
      )
    );

  const _w121zod111ePreparedEntryForUi =
    _w121zod118h1PrepEntries.find(
      (entry: any) =>
        entry?.finished === true &&
        entry?.mediaCompatible === true &&
        entry?.readiness?.ok === true
    ) ||
    _w121zod118h1PrepEntries[0] ||
    null;

  const _w121zod111eAutoPlayGateApplies =
    type === 'movie' || isEpisodePage;

  // W121ZOD115N2_PHONE_CACHE_GATE
  // W121ZSA did its real automatic choice from the broad Premiumize cache
  // result, not from one prewarmed hash. Keep Preparing Media visible until
  // the background V296 check has authoritative cache state for the same
  // first-50 universe V300 will use. This work happens before Play, so the
  // click itself can stay near-instant.
  const _w121zod115n2CacheHashes = (() => {
    const hashes: string[] = [];
    const seen = new Set<string>();

    for (const candidate of (streams || [])) {
      const hash = String(
        (candidate as any)?.infoHash ||
        (candidate as any)?.info_hash ||
        ''
      ).trim().toLowerCase();

      if (!hash || seen.has(hash)) continue;
      seen.add(hash);
      hashes.push(hash);

      if (hashes.length >= 50) break;
    }

    return hashes;
  })();

  const _w121zod115n2KnownCacheStates =
    _w121zod115n2CacheHashes.filter(
      (hash) => _v296_cacheMap.has(hash)
    ).length;

  const _w121zod115n2BroadCacheReady =
    _w121zod115n2CacheHashes.length === 0 ||
    _w121zod115n2KnownCacheStates >=
      _w121zod115n2CacheHashes.length;

  // W121ZOD117A_PLAY_IS_ALREADY_PREPARED
  //
  // Stream discovery alone is not enough. Play is considered prepared
  // only after the selected source has resolved to the exact media,
  // passed device compatibility and passed seek/delivery readiness.
  // W121ZOD118H1_EXACT_WINNER_BEATS_BROAD_CACHE_WAIT
  // A source that already completed directDL + exact-file probe + device
  // readiness is ready even if the broad background cache map is still filling.
  const _w121zod111eUsefulPrepReady =
    !!_w121zod111ePreparedEntryForUi &&
    Array.isArray(
      _w121zod111ePreparedEntryForUi
        .directDlContent
    ) &&
    _w121zod111ePreparedEntryForUi
      .directDlContent.length > 0 &&
    !!_w121zod111ePreparedEntryForUi
      .mediaPath &&
    !!_w121zod111ePreparedEntryForUi
      .probe &&
    _w121zod111ePreparedEntryForUi
      .mediaCompatible === true &&
    _w121zod111ePreparedEntryForUi
      .readiness?.ok === true;

  // W121ZOD135_RESTORE_NORMAL_PLAY_BUTTON
  //
  // Preparing Media no longer gates the primary action. Movies return to the
  // normal user-driven Play flow: stream discovery may continue, but once
  // streams exist the Play button is available immediately.
  const _w121zod111eHoldPlay = false;
  // W121ZOD136_LIGHTWEIGHT_PREPARING_PLAYBACK
  // Movie UI only: show progress while ordinary stream discovery is active.
  // This never waits for directDL, media probes, range/readiness checks, or
  // background prepared-winner authority. W135 movie Play remains authoritative.
  const _w121zod111eShowPreparingUi =
    type === 'movie' && _v667EffectiveStreamLoading;
  // PRE-WARM: When streams are loaded, silently pre-start the top ENGLISH torrent
  // This saves 5-10 seconds of metadata download when user taps play
  const prewarmedRef = useRef<string | null>(null);

  // W121ZOD117A_DETAILS_PREP_RETRY
  // Rejected preparation candidates remain invisible to the user.
  // Details immediately evaluates the next ranked candidate.
  const _w121zod117PrepRejectedRef =
    useRef<Set<string>>(new Set<string>());

  // W121ZOD118H1_PREP_BUDGET
  const _w121zod118h1PrepStartedAtRef =
    useRef<number>(Date.now());

  const _w121zod118h1HedgeWarmRef =
    useRef<Set<string>>(new Set<string>());

  const [
    _w121zod117PrepRetryTick,
    _w121zod117SetPrepRetryTick,
  ] = useState(0);

  // W121ZOD118D_FAST_PREP
  // Preparing Media must always have a terminal state.
  const [
    _w121zod118dPrepExhausted,
    _w121zod118dSetPrepExhausted,
  ] = useState(false);

  useEffect(() => {
    _w121zod117PrepRejectedRef.current.clear();
    _w121zod118h1HedgeWarmRef.current.clear();
    _w121zod118h1PrepStartedAtRef.current = Date.now();
    prewarmedRef.current = null;
    _w121zod118dSetPrepExhausted(false);
  }, [_w121zod110yPrepContextKey]);

  // W121ZOD118A_DETAILS_PREP_LIFECYCLE
  //
  // Details may remain mounted underneath Player. Once Details loses
  // focus, its background candidate work must stop influencing OD.
  const _w121zod118DetailsPrepActiveRef =
    useRef(true);

  // W121ZOD118F_RETURN_FROM_PLAYER_PRESERVE_PREP
  //
  // Player is pushed over this Details screen. Blurring Details stops
  // background mutation, but an already-prepared winner belongs to this
  // same mounted title and must survive Back from Player.
  useFocusEffect(
    useCallback(() => {
      _w121zod118DetailsPrepActiveRef.current = true;

      const _w121zod118fPreservedReady =
        Array.from(
          _w121zod110yPrepCacheRef.current.values()
        ).some((entry: any) =>
          String(entry?.key || '').startsWith(
            _w121zod110yPrepContextKey + '|'
          ) &&
          entry?.finished === true &&
          !entry?.error &&
          Array.isArray(entry?.directDlContent) &&
          entry.directDlContent.length > 0 &&
          !!entry?.mediaPath &&
          !!entry?.probe &&
          entry?.mediaCompatible === true &&
          entry?.readiness?.ok === true
        );

      if (!_w121zod118fPreservedReady) {
        _w121zod117SetPrepRetryTick(
          (tick) => tick + 1
        );
      } else {
        console.log(
          '[W121ZOD118F DETAILS RETURN]',
          'preparedMedia=preserved',
          'context=' +
            _w121zod110yPrepContextKey
        );

        _w121zod111eSetPrepUiTick(
          (tick) => tick + 1
        );
      }

      return () => {
        // Stop async preparation while Player owns focus.
        // DO NOT clear the already-ready stream/prep state.
        _w121zod118DetailsPrepActiveRef.current =
          false;
      };
    }, [_w121zod110yPrepContextKey])
  );
  useEffect(() => {
    // W121ZOD135_MOVIE_NO_BACKGROUND_PREP_AUTHORITY
    //
    // Restore the pre-Preparing-Media movie behavior. Movie playback is
    // user-driven from the Play button; background directDL/media/readiness
    // preparation must not choose or gate the movie before the user presses Play.
    if (type === 'movie') {
      return;
    }

    // W121ZOD134J_AUTHORITATIVE_PREP_ONLY
    // Wait until this title's stream discovery is authoritative before starting
    // device/media preparation. Progressive stream updates may still paint UI,
    // but they must not churn preparation candidates while providers are landing.
    if (streams && streams.length > 0 && !isLoadingStreams) {
      // W121ZOD118H1_KEEP_FIRST_READY_WINNER
      // A late cache-map update must not throw away a source that has already
      // completed exact-file/device/readiness preparation for this Details page.
      const _w121zod118h1ExistingReady =
        Array.from(
          _w121zod110yPrepCacheRef.current.values()
        ).some((entry: any) =>
          String(entry?.key || '').startsWith(
            _w121zod110yPrepContextKey + '|'
          ) &&
          entry?.finished === true &&
          entry?.mediaCompatible === true &&
          entry?.readiness?.ok === true
        );

      if (_w121zod118h1ExistingReady) {
        return;
      }

      // W121ZOD9B_CORRECT_ID_POLICY_PREWARM
      const sorted = sortStreamsByLanguage(streams);

      const _v121zod9bReqT = String(
        (content as any)?.name ||
        (content as any)?.title ||
        (paramName as any) ||
        ''
      );

      const _v121zod9bReqY =
        (content as any)?.releaseInfo ||
        (content as any)?.year ||
        (content as any)?.releaseYear ||
        '';

      const _v121zod9bIdentified =
        type === 'movie' && _v121zod9bReqT
          ? sorted.filter((s: any) => {
              const identity = String(
                s?.filename ||
                s?.title ||
                s?.name ||
                ''
              ).trim();

              if (!identity) return false;

              return _v747MovieIdentityMatches(
                id,
                content,
                s,
                _v121zod9bReqT,
                _v121zod9bReqY,
                identity
              );
            })
          : [];

      const _v121zod9bPool =
        _v121zod9bIdentified.length > 0
          ? _v121zod9bIdentified
          : sorted;

      // W121ZOD118H1_PROACTIVE_SOURCE_HYGIENE
      //
      // Expensive Premiumize work sees only candidates that survive cheap,
      // deterministic checks first: exact content identity, English/neutral,
      // non-sample, unique hash, and no device-local hard playback/seek fail.
      const _w121zod118h1HealthMap =
        _v769GetSeekHealthMap();

      const _w121zod118h1Seen =
        new Set<string>();

      // W121ZOD118H2_RELEASE_DEDUPE
      // Hash-level de-dupe is not enough: Torrentio may return the exact same
      // release from multiple indexes under different hashes. Retry the next
      // genuinely different release instead of benchmarking the same file.
      const _w121zod118h2ReleaseSeen =
        new Set<string>();

      const _w121zod118h1CleanBasePool =
        _v121zod9bPool.filter(
          (candidate: any) => {
            const hash = String(
              candidate?.infoHash ||
              candidate?.info_hash ||
              ''
            )
              .trim()
              .toLowerCase();

            if (!hash || _w121zod118h1Seen.has(hash)) {
              return false;
            }

            _w121zod118h1Seen.add(hash);

            if (_v672IsSampleLikeStream(candidate)) {
              return false;
            }

            if (_w121zod108e1IsStrictForeignStream(candidate)) {
              return false;
            }

            const health =
              _w121zod118h1HealthMap[hash];

            if (
              health?.ff === 'fail' ||
              health?.rw === 'fail' ||
              _w121zod106gPlaybackBadForSelection(health)
            ) {
              return false;
            }

            const identity = String(
              candidate?.filename ||
              candidate?.title ||
              candidate?.name ||
              ''
            ).trim();

            const _w121zod118h2ReleaseKey =
              String(candidate?.filename || '')
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, ' ')
                .trim();

            if (
              _w121zod118h2ReleaseKey.length >= 24 &&
              _w121zod118h2ReleaseSeen.has(
                _w121zod118h2ReleaseKey
              )
            ) {
              return false;
            }

            if (_w121zod118h2ReleaseKey.length >= 24) {
              _w121zod118h2ReleaseSeen.add(
                _w121zod118h2ReleaseKey
              );
            }

            if (type === 'movie') {
              return !!identity &&
                _v747MovieIdentityMatches(
                  id,
                  content,
                  candidate,
                  _v121zod9bReqT,
                  _v121zod9bReqY,
                  identity
                );
            }

            if (
              type === 'series' &&
              isEpisodePage
            ) {
              return !!identity &&
                _v745EpisodeIdentityMatches(
                  _v121zod9bReqT,
                  episodeSeason,
                  episodeNumber,
                  identity
                );
            }

            return true;
          }
        );

      // Cache state is a preference, not permission to reintroduce garbage.
      const _w121zod110tCachedPool =
        _w121zod118h1CleanBasePool.filter((s: any) => {
          const hash = String(
            s?.infoHash ||
            s?.info_hash ||
            ''
          )
            .trim()
            .toLowerCase();

          return (
            !!hash &&
            _v296_cacheMap.get(hash) === true
          );
        });

      // W121ZOD118H2_CACHE_PREFERENCE_NOT_PRISON
      // Cached sources are the fast lane, not the whole universe. If every
      // cached candidate tried so far fails, immediately broaden back to the
      // remaining clean candidates instead of declaring the title unavailable.
      const _w121zod118h2CachedRemaining =
        _w121zod110tCachedPool.filter(
          (candidate: any) => {
            const hash = String(
              candidate?.infoHash ||
              candidate?.info_hash ||
              ''
            )
              .trim()
              .toLowerCase();

            return (
              !!hash &&
              !_w121zod117PrepRejectedRef.current.has(hash)
            );
          }
        );

      // W121ZOD134R_STABLE_1080_AUTHORITY
      // Product rule:
      //   1. proven playback-pass 1080p SDR
      //   2. remaining clean 1080p SDR
      //   3. remaining clean 720p SDR
      //   4. legacy/cache fallback only after those pools are exhausted
      //
      // Do NOT let a cached 4K/720 source outrank an available clean 1080p.
      const _w121zod134rHashOf =
        (candidate: any): string =>
          String(
            candidate?.infoHash ||
            candidate?.info_hash ||
            ''
          )
            .trim()
            .toLowerCase();

      const _w121zod134rRemainingClean =
        _w121zod118h1CleanBasePool.filter(
          (candidate: any) => {
            const hash =
              _w121zod134rHashOf(candidate);

            return (
              !!hash &&
              !_w121zod117PrepRejectedRef.current.has(hash)
            );
          }
        );

      const _w121zod134rRemaining1080Sdr =
        _w121zod134rRemainingClean.filter(
          (candidate: any) => {
            const info: any =
              parseStreamInfo(candidate);

            return (
              info?.quality === '1080p' &&
              info?.isHDR !== true
            );
          }
        );

      const _w121zod134rRemaining720Sdr =
        _w121zod134rRemainingClean.filter(
          (candidate: any) => {
            const info: any =
              parseStreamInfo(candidate);

            return (
              info?.quality === '720p' &&
              info?.isHDR !== true
            );
          }
        );

      const _w121zod134rHealthMap =
        _v769GetSeekHealthMap();

      const _w121zod134rProven1080 =
        _w121zod134rRemaining1080Sdr.filter(
          (candidate: any) => {
            const hash =
              _w121zod134rHashOf(candidate);

            const health: any =
              _w121zod134rHealthMap[hash] ||
              {};

            return (
              health?.playback === 'pass' &&
              !_w121zod106gPlaybackBadForSelection(
                health
              )
            );
          }
        );

      // W121ZOD134R2_RANKED_1080_AUTHORITY
      //
      // A short historical playback pass is useful telemetry, but it is not
      // enough to monopolize selection. W121ZOD134P proved a source can pass
      // the 120s persistence threshold and still die later after its delivery
      // buffer drains.
      //
      // Therefore every remaining clean SDR 1080p candidate stays in the
      // authority pool. The existing V503 ranking chooses the best compact /
      // compatible / reliable 1080p. The R exact-route delivery gate then tests
      // the precise URL Player would receive, re-resolving that SAME source
      // once before advancing. 720p remains inaccessible until 1080p exhausts.
      const _w121zod110tAuthorityPool =
        _w121zod134rRemaining1080Sdr.length > 0
          ? _w121zod134rRemaining1080Sdr
          : _w121zod134rRemaining720Sdr.length > 0
            ? _w121zod134rRemaining720Sdr
            : _w121zod118h2CachedRemaining.length > 0
              ? _w121zod118h2CachedRemaining
              : _w121zod118h1CleanBasePool;

      console.log(
        '[W121ZOD134R 1080 AUTHORITY]',
        'proven1080=' +
          String(
            _w121zod134rProven1080.length
          ),
        'remaining1080=' +
          String(
            _w121zod134rRemaining1080Sdr.length
          ),
        'remaining720=' +
          String(
            _w121zod134rRemaining720Sdr.length
          ),
        'authority=' +
          (
            _w121zod134rRemaining1080Sdr.length > 0
              ? 'RANKED_1080_SDR'
              : _w121zod134rRemaining720Sdr.length > 0
                ? '720_SDR_AFTER_1080_EXHAUSTION'
                : 'LEGACY_LAST_RESORT'
          )
      );

      const _w121zod117PrepPool =
        _w121zod110tAuthorityPool.filter(
          (candidate: any) => {
            const hash = String(
              candidate?.infoHash ||
              candidate?.info_hash ||
              ''
            )
              .trim()
              .toLowerCase();

            return (
              !!hash &&
              !_w121zod117PrepRejectedRef.current.has(hash)
            );
          }
        );

      const _w121zod118h1PrepElapsedMs =
        Date.now() -
        _w121zod118h1PrepStartedAtRef.current;

      // W121ZOD118H3_NO_PLAYBACK_UNAVAILABLE
      // A temporarily-empty preparation pool is NOT a playback verdict.
      // H2 proved Details can run before the current title's stream-owner
      // claim/current stream publish. Stay in Preparing Media and wait for
      // the next current-stream/cache/retry update instead of terminating.
      if (_w121zod117PrepPool.length === 0) {
        console.warn(
          '[W121ZOD118H3 PREP WAIT]',
          'streams=' + String(Array.isArray(streams) ? streams.length : 0),
          'loading=' + String(!!isLoadingStreams),
          'clean=' + String(_w121zod118h1CleanBasePool.length),
          'cached=' + String(_w121zod110tCachedPool.length),
          'rejected=' + String(_w121zod117PrepRejectedRef.current.size),
          'elapsedMs=' + String(_w121zod118h1PrepElapsedMs),
          'action=bounded-active-recheck'
        );

        // W121ZOD127_BOUNDED_EMPTY_POOL_RECHECK
        //
        // H3 previously returned here forever. Nothing was guaranteed to
        // change streams/cache/retry state after the final candidate was
        // rejected, leaving Preparing Media permanently stuck.
        //
        // Keep checking while stream discovery / an already-started
        // Premiumize transfer may still change availability, but never
        // leave the user in an infinite Preparing Media state.
        const _w121zod127WaitBudgetMs = 60000;

        if (
          !isLoadingStreams &&
          _w121zod118h1PrepElapsedMs >=
            _w121zod127WaitBudgetMs
        ) {
          console.warn(
            '[W121ZOD127 PREP EXHAUSTED]',
            'streams=' +
              String(Array.isArray(streams) ? streams.length : 0),
            'clean=' +
              String(_w121zod118h1CleanBasePool.length),
            'rejected=' +
              String(_w121zod117PrepRejectedRef.current.size),
            'elapsedMs=' +
              String(_w121zod118h1PrepElapsedMs),
            'action=stop-bounded-preparation'
          );

          _w121zod118dSetPrepExhausted(true);
          return;
        }

        _w121zod118dSetPrepExhausted(false);

        setTimeout(() => {
          if (
            !_w121zod118DetailsPrepActiveRef.current
          ) {
            return;
          }

          _w121zod117SetPrepRetryTick(
            (tick) => tick + 1
          );
        }, 2500);

        return;
      }

      if (_w121zod118h1PrepElapsedMs >= 8000) {
        console.warn(
          '[W121ZOD118H2 PREP CONTINUE]',
          'remaining=' + String(_w121zod117PrepPool.length),
          'rejected=' + String(_w121zod117PrepRejectedRef.current.size),
          'elapsedMs=' + String(_w121zod118h1PrepElapsedMs),
          'action=keep-trying-clean-candidates'
        );
      }

      // W121ZOD134F_FAST_SUSTAINABLE_RESCUE
      //
      // Give normal quality-first selection one real preparation attempt.
      // After one rejected candidate, flawless delivery outranks resolution:
      // immediately try the smallest clean SDR 720p source rather than
      // spending a minute testing a long chain of higher-bitrate 1080p files.
      const _w121zod134fUseRescueLane =
        _w121zod117PrepRejectedRef.current.size >= 1;

      const _w121zod134fSizeBytes =
        (candidate: any): number => {
          try {
            const info: any =
              parseStreamInfo(candidate);

            const text =
              String(info?.size || '').trim();

            const sizeMatch =
              text.match(
                /([\d]+(?:[.,][\d]+)?)\s*(TB|TiB|GB|GiB|MB|MiB)/i
              );

            if (!sizeMatch) {
              return Number.POSITIVE_INFINITY;
            }

            const amount =
              Number(
                sizeMatch[1].replace(',', '.')
              );

            const unit =
              sizeMatch[2].toUpperCase();

            const multiplier =
              unit.startsWith('T')
                ? Math.pow(1024, 4)
                : unit.startsWith('G')
                  ? Math.pow(1024, 3)
                  : Math.pow(1024, 2);

            const bytes =
              amount * multiplier;

            return (
              Number.isFinite(bytes) &&
              bytes > 0
            )
              ? bytes
              : Number.POSITIVE_INFINITY;
          } catch (_) {
            return Number.POSITIVE_INFINITY;
          }
        };

      // W121ZOD134M_COMPACT_RESCUE_AUTHORITY
      // Keep a compact SDR 720p lane ready on every title. The normal
      // device-aware source still gets first consideration, but if its
      // measured delivery cannot sustain its own bitrate we immediately
      // move to this lane instead of walking more 1080p candidates.
      const _w121zod134mCompact720Pool =
        _w121zod117PrepPool
          .filter(
            (candidate: any) => {
              const info: any =
                parseStreamInfo(candidate);

              return (
                info?.quality === '720p' &&
                info?.isHDR !== true
              );
            }
          )
          .sort(
            (a: any, b: any) =>
              _w121zod134fSizeBytes(a) -
              _w121zod134fSizeBytes(b)
          );

      // W121ZOD134R_EXHAUST_1080_BEFORE_720
      // M2 previously allowed one rejection to enter the compact 720p rescue
      // lane. That violates the product requirement. Stay in the 1080p pool
      // until every clean 1080p SDR candidate has actually been exhausted.
      const _w121zod134fRescuePool =
        (
          _w121zod134fUseRescueLane &&
          _w121zod134rRemaining1080Sdr.length === 0
        )
          ? _w121zod134mCompact720Pool
          : [];

      const _w121zod134fSelectionPool =
        _w121zod134fRescuePool.length > 0
          ? _w121zod134fRescuePool
          : _w121zod117PrepPool;

      if (
        _w121zod134fRescuePool.length > 0
      ) {
        console.warn(
          '[W121ZOD134F SUSTAINABLE RESCUE]',
          'rejected=' +
            String(
              _w121zod117PrepRejectedRef.current.size
            ),
          'rescue=' +
            String(
              _w121zod134fRescuePool.length
            ),
          'action=prefer-compact-720p-sdr'
        );
      }

      // W121ZOD134S_MOVIE_TPB_1080_MOST_SEEDERS
      //
      // Movie automatic Play authority:
      //   1. clean/title-correct/device-safe SDR 1080p
      //   2. The Pirate Bay / TPB source
      //   3. highest reported seeder count wins
      //
      // Do not let V503 release/history/size scoring outrank seeders inside
      // this movie-only TPB 1080p lane. Series and manual stream cards retain
      // their existing behavior.
      const _w121zod134sMovieTpb1080Pool =
        type === 'movie'
          ? _w121zod134fSelectionPool
              .filter((candidate: any) => {
                const info: any =
                  parseStreamInfo(candidate);

                const sourceText = (
                  String(candidate?.provider || '') + ' ' +
                  String(candidate?.addon || '') + ' ' +
                  String(candidate?.name || '') + ' ' +
                  String(candidate?.title || '') + ' ' +
                  String(candidate?.filename || '') + ' ' +
                  String(info?.source || '')
                ).toUpperCase();

                return (
                  info?.quality === '1080p' &&
                  info?.isHDR !== true &&
                  (
                    /\bTHEPIRATEBAY\b/.test(sourceText) ||
                    /\bTPB\+?\b/.test(sourceText) ||
                    /PIRATE\s*BAY/.test(sourceText)
                  )
                );
              })
              .sort((a: any, b: any) => {
                const seeders = (candidate: any): number => {
                  const info: any =
                    parseStreamInfo(candidate);

                  const raw =
                    candidate?.seeders ??
                    candidate?.seeds ??
                    candidate?.seed ??
                    info?.seeders ??
                    0;

                  const value =
                    typeof raw === 'number'
                      ? raw
                      : parseInt(String(raw), 10);

                  return Number.isFinite(value)
                    ? value
                    : 0;
                };

                return seeders(b) - seeders(a);
              })
          : [];

      const _w121zod134sTopTpbSeeders =
        _w121zod134sMovieTpb1080Pool.length > 0
          ? (() => {
              const candidate: any =
                _w121zod134sMovieTpb1080Pool[0];

              const info: any =
                parseStreamInfo(candidate);

              const raw =
                candidate?.seeders ??
                candidate?.seeds ??
                candidate?.seed ??
                info?.seeders ??
                0;

              const value =
                typeof raw === 'number'
                  ? raw
                  : parseInt(String(raw), 10);

              return Number.isFinite(value)
                ? value
                : 0;
            })()
          : 0;

      if (
        type === 'movie' &&
        _w121zod134sMovieTpb1080Pool.length > 0
      ) {
        console.log(
          '[W121ZOD134S MOVIE AUTHORITY]',
          'policy=TPB_1080_MOST_SEEDERS',
          'candidates=' +
            String(
              _w121zod134sMovieTpb1080Pool.length
            ),
          'seeders=' +
            String(
              _w121zod134sTopTpbSeeders
            ),
          'hash=' +
            String(
              _w121zod134sMovieTpb1080Pool[0]
                ?.infoHash ||
              (_w121zod134sMovieTpb1080Pool[0] as any)
                ?.info_hash ||
              ''
            ).slice(0, 12)
        );
      }

      const topStream =
        _w121zod134fRescuePool.length > 0
          ? _w121zod134fSelectionPool[0]
          : (
              type === 'movie' &&
              _w121zod134sMovieTpb1080Pool.length > 0
                ? _w121zod134sMovieTpb1080Pool[0]
                : (
                    _v503PickReliableAutoStream(
                      _w121zod134fSelectionPool,
                      type === 'movie' || type === 'series'
                    ) ||
                    _w121zod134fSelectionPool[0]
                  )
            );

      const _w121zod118h1TopHash = String(
        topStream?.infoHash ||
        (topStream as any)?.info_hash ||
        ''
      ).trim().toLowerCase();

      const _w121zod118h1SecondPool =
        _w121zod117PrepPool.filter((candidate: any) =>
          String(
            candidate?.infoHash ||
            candidate?.info_hash ||
            ''
          ).trim().toLowerCase() !==
          _w121zod118h1TopHash
        );

      // W121ZOD134R_1080_HEDGE_FIRST
      // Prewarm a second clean 1080p SDR candidate first. 720p remains the
      // rescue only after the 1080p pool is gone.
      const _w121zod134rSecond1080Pool =
        _w121zod134rRemaining1080Sdr.filter(
          (candidate: any) =>
            _w121zod134rHashOf(candidate) !==
            _w121zod118h1TopHash
        );

      const _w121zod134rSecond1080 =
        _w121zod134rSecond1080Pool.length > 0
          ? (
              _v503PickReliableAutoStream(
                _w121zod134rSecond1080Pool,
                type === 'movie' ||
                  type === 'series'
              ) ||
              _w121zod134rSecond1080Pool[0]
            )
          : null;

      const _w121zod134mCompactHedge =
        _w121zod134mCompact720Pool.find(
          (candidate: any) =>
            _w121zod134rHashOf(candidate) !==
            _w121zod118h1TopHash
        ) || null;

      const _w121zod118h1SecondStream =
        _w121zod134rSecond1080 ||
        _w121zod134mCompactHedge ||
        (
          _w121zod118h1SecondPool.length > 0
            ? (
                _v503PickReliableAutoStream(
                  _w121zod118h1SecondPool,
                  type === 'movie' ||
                    type === 'series'
                ) ||
                _w121zod118h1SecondPool[0]
              )
            : null
        );

      try {
        console.log(
          '[W121ZOD110T PREWARM AUTHORITY]',
          'cacheTick=' + String(_v296_cacheTick),
          'identified=' + String(_v121zod9bIdentified.length),
          'cleanPool=' + String(_w121zod118h1CleanBasePool.length),
          'cachedPool=' + String(_w121zod110tCachedPool.length),
          'authorityPool=' + String(_w121zod110tAuthorityPool.length),
          'hash=' + String(topStream?.infoHash || '').slice(0, 12),
          'hedge=' + String(
            _w121zod118h1SecondStream?.infoHash ||
            (_w121zod118h1SecondStream as any)?.info_hash ||
            ''
          ).slice(0, 12)
        );
      } catch (_) {}

      try {
        console.log(
          '[W121ZOD9B PREWARM]',
          'identified=' + _v121zod9bIdentified.length,
          'hash=' + String(topStream?.infoHash || '').slice(0, 12),
          '|',
          String(
            topStream?.filename ||
            topStream?.title ||
            topStream?.name ||
            ''
          ).slice(0, 120)
        );
      } catch (_) {}
      if (topStream?.infoHash && topStream.infoHash !== prewarmedRef.current) {
        prewarmedRef.current = topStream.infoHash;
        console.log(`[PREWARM v291] Kicking client-side PM resolve for top stream: ${topStream.infoHash}`);
        // V291 â€” was api.stream.prewarm() which hit a now-defunct backend
        // endpoint after middle-isolation.  api.stream.start() in v287
        // client.ts kicks _kickPmResolve() on-device when a PM key is
        // present and returns immediately.  Result: PM URL is cached
        // before the user taps Play -> instant playback.
        const _idParts = ((id as string) || '').split(':');
        const _seasonNum = _idParts.length >= 3 ? parseInt(_idParts[_idParts.length - 2], 10) : undefined;
        const _episodeNum = _idParts.length >= 3 ? parseInt(_idParts[_idParts.length - 1], 10) : undefined;
        api.stream.start(
          topStream.infoHash,
          topStream.fileIdx,
          topStream.filename || topStream.title,
          topStream.sources || [],
          Number.isFinite(_seasonNum as number) ? _seasonNum : undefined,
          Number.isFinite(_episodeNum as number) ? _episodeNum : undefined,
          String(
            (content as any)?.name ||
            (content as any)?.title ||
            (paramName as any) ||
            ''
          ),
          _v745Year(
            (content as any)?.year ||
            (content as any)?.releaseYear ||
            (content as any)?.releaseInfo ||
            ''
          ),
        ).catch(() => {});

        // W121ZOD118H1_SECOND_CANDIDATE_HEDGE
        // Warm only the second clean/ranked candidate after 900 ms. This is
        // deliberately lightweight; it does not steal authority from #1.
        const _w121zod118h1SecondHash = String(
          _w121zod118h1SecondStream?.infoHash ||
          (_w121zod118h1SecondStream as any)?.info_hash ||
          ''
        ).trim().toLowerCase();

        if (
          _w121zod118h1SecondStream &&
          _w121zod118h1SecondHash &&
          !_w121zod118h1HedgeWarmRef.current.has(
            _w121zod118h1SecondHash
          )
        ) {
          _w121zod118h1HedgeWarmRef.current.add(
            _w121zod118h1SecondHash
          );

          setTimeout(() => {
            if (!_w121zod118DetailsPrepActiveRef.current) return;

            const alreadyReady = Array.from(
              _w121zod110yPrepCacheRef.current.values()
            ).some((entry: any) =>
              String(entry?.key || '').startsWith(
                _w121zod110yPrepContextKey + '|'
              ) &&
              entry?.readiness?.ok === true
            );

            if (alreadyReady) return;

            console.log(
              '[W121ZOD118H1 HEDGE WARM]',
              'hash=' + _w121zod118h1SecondHash.slice(0, 12)
            );

            api.stream.start(
              _w121zod118h1SecondStream.infoHash ||
                (_w121zod118h1SecondStream as any).info_hash,
              _w121zod118h1SecondStream.fileIdx,
              _w121zod118h1SecondStream.filename ||
                _w121zod118h1SecondStream.title,
              _w121zod118h1SecondStream.sources || [],
              Number.isFinite(_seasonNum as number)
                ? _seasonNum
                : undefined,
              Number.isFinite(_episodeNum as number)
                ? _episodeNum
                : undefined,
              String(
                (content as any)?.name ||
                (content as any)?.title ||
                (paramName as any) ||
                ''
              ),
              _v745Year(
                (content as any)?.year ||
                (content as any)?.releaseYear ||
                (content as any)?.releaseInfo ||
                ''
              ),
            ).catch(() => {});
          }, 900);
        }
        // W121ZOD110Y_DETAILS_VALIDATION_OVERLAP
        // Start the SAME expensive candidate checks V300 will require,
        // but do it while the user is still on Details.
        // No result is trusted by hash alone: Play rechecks content/hash/path.
        const _w121zod110yHash =
          String(topStream.infoHash || '')
            .trim()
            .toLowerCase();

        // W121ZOD115I_PHONE_OD_POLICY
        // Preserve V291's lightweight Premiumize prewarm, but do not run
        // the post-W121ZSA directDL/media-probe/readiness pipeline while
        // the user is still on Details.
        // W121ZOD117A_REAL_PREPARING_MEDIA
        //
        // This is now the purpose of the Preparing Media window:
        // resolve, identify, probe and seek-test the automatic winner
        // before the Play button becomes available.
        if (
          _w121zod110yHash &&
          (type === 'movie' || type === 'series')
        ) {
          const _w121zod110yPrepKey =
            _w121zod110yPrepContextKey +
            '|' +
            _w121zod110yHash;

          // W121ZOD110YR1_SUPERSEDE_OLD_PREP
          // W110T may change the preferred hash after cache discovery.
          // Remove older hash entries from this content context so their
          // async pipeline stops after whichever awaited stage is active.
          for (
            const _w121zod110yExistingKey of
              Array.from(
                _w121zod110yPrepCacheRef.current.keys()
              )
          ) {
            if (
              _w121zod110yExistingKey !==
                _w121zod110yPrepKey &&
              _w121zod110yExistingKey.startsWith(
                _w121zod110yPrepContextKey + '|'
              )
            ) {
              _w121zod110yPrepCacheRef.current.delete(
                _w121zod110yExistingKey
              );
            }
          }

          const _w121zod110yExisting =
            _w121zod110yPrepCacheRef.current.get(
              _w121zod110yPrepKey
            );

          if (
            !_w121zod110yExisting?.running &&
            !_w121zod110yExisting?.finished
          ) {
            const _w121zod110yEntry: any = {
              key: _w121zod110yPrepKey,
              hash: _w121zod110yHash,
              stream: topStream,
              running: true,
              finished: false,
              directDlContent: null,
              directDlAtMs: 0,
              mediaPath: '',
              mediaCompatible: false,
              probe: null,
              probeAtMs: 0,
              readiness: null,
              readinessAtMs: 0,
              error: '',
              promise: null,
            };

            _w121zod110yPrepCacheRef.current.set(
              _w121zod110yPrepKey,
              _w121zod110yEntry
            );

            _w121zod111eSetPrepUiTick(
              (tick) => tick + 1
            );

            const _w121zod110yPromise =
              (async () => {
              const _w121zod110yStillCurrent = () =>
                _w121zod118DetailsPrepActiveRef.current &&
                _w121zod110yPrepCacheRef.current.get(
                  _w121zod110yPrepKey
                ) === _w121zod110yEntry;

              const _w121zod117RejectPreparedCandidate =
                (reason: string) => {
                  if (!_w121zod110yStillCurrent()) {
                    return;
                  }

                  _w121zod117PrepRejectedRef.current.add(
                    _w121zod110yHash
                  );

                  _w121zod110yEntry.finished = true;
                  _w121zod110yEntry.error =
                    String(reason || 'prep-rejected');

                  _w121zod110yPrepCacheRef.current.delete(
                    _w121zod110yPrepKey
                  );

                  prewarmedRef.current = null;

                  console.log(
                    '[W121ZOD117 PREP REJECT]',
                    'hash=' +
                      _w121zod110yHash.slice(0, 12),
                    'reason=' +
                      String(reason || 'prep-rejected'),
                    'action=try-next-before-play'
                  );

                  setTimeout(() => {
                    _w121zod117SetPrepRetryTick(
                      (tick) => tick + 1
                    );
                  }, 0);
                };

              try {
                const _w121zod110yMagnet =
                  `magnet:?xt=urn:btih:${_w121zod110yHash}`;

                const _w121zod110yContent =
                  await premiumizeDirectDL(
                    _w121zod110yMagnet,
                    8000
                  ); // W121ZOD134J_DEVICE_PREP_DIRECTDL_BUDGET

                if (!_w121zod110yStillCurrent()) return;

                _w121zod110yEntry.directDlContent =
                  _w121zod110yContent;
                _w121zod110yEntry.directDlAtMs =
                  Date.now();

                console.log(
                  '[W121ZOD110Y PREP STAGE]',
                  'stage=directdl',
                  'hash=' + _w121zod110yHash.slice(0, 12),
                  'files=' + String(
                    Array.isArray(_w121zod110yContent)
                      ? _w121zod110yContent.length
                      : 0
                  )
                );

                if (
                  !Array.isArray(_w121zod110yContent) ||
                  _w121zod110yContent.length === 0
                ) {
                  _w121zod110yEntry.finished = true;
                  return;
                }

                const _w121zod110yVideoExt =
                  /\.(mkv|mp4|avi|mov|m4v|ts|m2ts|webm)$/i;

                // W121ZOD124_PATH_FIRST_PM_PACK_SELECTION
                // A valid Premiumize pack item may expose an exact media path
                // before it exposes a client-side link. The authenticated
                // media-probe endpoint re-resolves this exact path and returns
                // the usable HTTPS link, so do not discard path-only media.
                let _w121zod110yVideos =
                  _w121zod110yContent.filter(
                    (candidate: any) =>
                      candidate &&
                      _w121zod110yVideoExt.test(
                        candidate.path ||
                        candidate.name ||
                        candidate.link ||
                        ''
                      )
                  );

                _w121zod110yVideos =
                  _w121zod110yVideos.filter(
                    (candidate: any) =>
                      !_v672IsSampleLikeMedia(
                        candidate.path ||
                        candidate.name ||
                        candidate.link
                      )
                  );

                const _w121zod124LinkBackedVideoCount =
                  _w121zod110yVideos.filter(
                    (candidate: any) =>
                      !!String(candidate?.link || '').trim()
                  ).length;

                console.log(
                  '[W121ZOD124 PATH-FIRST PACK]',
                  'hash=' + _w121zod110yHash.slice(0, 12),
                  'videoFiles=' + String(_w121zod110yVideos.length),
                  'withLink=' + String(_w121zod124LinkBackedVideoCount)
                );

                const _w121zod110yIdParts =
                  ((id as string) || '').split(':');

                const _w121zod110ySeason =
                  _w121zod110yIdParts.length >= 3
                    ? parseInt(
                        _w121zod110yIdParts[
                          _w121zod110yIdParts.length - 2
                        ],
                        10
                      )
                    : NaN;

                const _w121zod110yEpisode =
                  _w121zod110yIdParts.length >= 3
                    ? parseInt(
                        _w121zod110yIdParts[
                          _w121zod110yIdParts.length - 1
                        ],
                        10
                      )
                    : NaN;

                let _w121zod110yFile: any = null;

                if (
                  type === 'series' &&
                  !isNaN(_w121zod110ySeason) &&
                  !isNaN(_w121zod110yEpisode)
                ) {
                  const _w121zod110ySePad =
                    `S${String(
                      _w121zod110ySeason
                    ).padStart(2, '0')}E${String(
                      _w121zod110yEpisode
                    ).padStart(2, '0')}`;

                  const _w121zod110ySeAlt =
                    `${_w121zod110ySeason}x${String(
                      _w121zod110yEpisode
                    ).padStart(2, '0')}`;

                  _w121zod110yFile =
                    _w121zod110yVideos.find(
                      (candidate: any) => {
                        const name =
                          _v672MediaBasename(
                            candidate.path ||
                            candidate.link
                          );

                        return (
                          name
                            .toUpperCase()
                            .includes(
                              _w121zod110ySePad
                            ) ||
                          name
                            .toLowerCase()
                            .includes(
                              _w121zod110ySeAlt
                                .toLowerCase()
                            )
                        );
                      }
                    );
                }

                if (
                  !_w121zod110yFile &&
                  type === 'movie'
                ) {
                  const _w121zod110yMovieTitle =
                    String(
                      (content as any)?.name ||
                      (content as any)?.title ||
                      (paramName as any) ||
                      ''
                    );

                  const _w121zod110yMovieYear =
                    (content as any)?.releaseInfo ||
                    (content as any)?.year ||
                    (content as any)?.releaseYear ||
                    '';

                  _w121zod110yFile =
                    _v441_pickMovieFile(
                      _w121zod110yVideos,
                      _w121zod110yMovieTitle,
                      _w121zod110yMovieYear
                    );
                }

                const _w121zod110yIdentity =
                  String(
                    _w121zod110yFile?.path ||
                    _w121zod110yFile?.name ||
                    _w121zod110yFile?.link ||
                    ''
                  );

                const _w121zod110yRequestedTitle =
                  String(
                    (content as any)?.name ||
                    (content as any)?.title ||
                    (paramName as any) ||
                    ''
                  );

                const _w121zod110yRequestedYear =
                  _v745Year(
                    (content as any)?.year ||
                    (content as any)?.releaseYear ||
                    (content as any)?.releaseInfo ||
                    ''
                  );

                const _w121zod110yIdentityOk =
                  type === 'movie'
                    ? _v747MovieIdentityMatches(
                        id,
                        content,
                        topStream,
                        _w121zod110yRequestedTitle,
                        _w121zod110yRequestedYear,
                        _w121zod110yIdentity
                      )
                    : type === 'series'
                      ? _v745EpisodeIdentityMatches(
                          _w121zod110yRequestedTitle,
                          _w121zod110ySeason,
                          _w121zod110yEpisode,
                          _w121zod110yIdentity
                        )
                      : false;

                const _w121zod110ySelectedPath =
                  String(
                    _w121zod110yFile?.path ||
                    _w121zod110yFile?.name ||
                    ''
                  ).trim();

                if (
                  !_w121zod110ySelectedPath ||
                  !_w121zod110yIdentityOk
                ) {
                  _w121zod110yEntry.finished = true;

                  console.log(
                    '[W121ZOD110Y PREP STAGE]',
                    'stage=file-identity',
                    'hash=' +
                      _w121zod110yHash.slice(0, 12),
                    'ok=false',
                    'pathFound=' + String(!!_w121zod110ySelectedPath),
                    'linkPresent=' + String(
                      !!String(_w121zod110yFile?.link || '').trim()
                    )
                  );

                  return;
                }

                const _w121zod110yMediaPath =
                  _w121zod110ySelectedPath;

                if (!_w121zod110yMediaPath) {
                  _w121zod110yEntry.finished = true;
                  return;
                }

                _w121zod110yEntry.mediaPath =
                  _w121zod110yMediaPath;

                // W121ZOD134M_PARALLEL_DELIVERY_SAMPLE
                // Start one tiny native Range sample from the exact direct-DL
                // URL in parallel with the device/media probe.
                const _w121zod134mDirectLink =
                  String(
                    _w121zod110yFile?.link ||
                    ''
                  ).trim();

                // W121ZOD134R_EXACT_PLAYBACK_ROUTE_ONLY
                // The media-probe endpoint performs a fresh Premiumize resolve.
                // Do not benchmark an older DirectDL URL in parallel and then
                // use that measurement to judge a different URL handed to Player.
                const _w121zod134mDeliveryPromise =
                  null;

                const _w121zod110yProbe =
                  await premiumizeMediaProbe(
                    _w121zod110yMagnet,
                    _w121zod110yMediaPath,
                    5000
                  ); // W121ZOD134J_DEVICE_MEDIA_PROBE_BUDGET

                if (!_w121zod110yStillCurrent()) return;

                _w121zod110yEntry.probe =
                  _w121zod110yProbe;
                _w121zod110yEntry.probeAtMs =
                  Date.now();

                const _w121zod110yDecision =
                  _w121zod108e1ActualAudioDecision(
                    _w121zod110yProbe
                  );

                console.log(
                  '[W121ZOD110Y PREP STAGE]',
                  'stage=media-probe',
                  'hash=' + _w121zod110yHash.slice(0, 12),
                  'ok=' + String(
                    _w121zod110yDecision.ok
                  ),
                  'reason=' +
                    _w121zod110yDecision.reason
                );

                if (!_w121zod110yDecision.ok) {
                  _w121zod110yEntry.finished = true;
                  return;
                }

                _w121zod110yEntry.mediaCompatible = true;

                console.log(
                  '[W121ZOD111E PREPARING MEDIA]',
                  'state=media-probe-ready',
                  'hash=' +
                    _w121zod110yHash.slice(0, 12)
                );

                _w121zod111eSetPrepUiTick(
                  (tick) => tick + 1
                );

                // W121ZOD134R_SAME_SOURCE_ROUTE_RETRY
                // A torrent/source and one temporary Premiumize CDN route are
                // not the same thing. Test the exact URL that Player would get.
                // If that route is weak, freshly resolve the SAME source once
                // before rejecting the hash and advancing to the next 1080p.
                let _w121zod134rProbeAuthority: any =
                  _w121zod110yProbe;

                const _w121zod134rMeasureDelivery =
                  async (
                    probe: any,
                    attempt: string
                  ) => {
                    const delivery =
                      await premiumizeStartupDeliverySample(
                        String(
                          probe?.link ||
                          ''
                        ).trim(),
                        probe?.size ||
                          0
                      );

                    let mediaBitRateBps =
                      Number(
                        probe?.format?.bit_rate ||
                        0
                      );

                    const durationSeconds =
                      Number(
                        probe?.format?.duration ||
                        0
                      );

                    const fileSizeBytes =
                      Number(
                        probe?.size ||
                        0
                      );

                    if (
                      (
                        !Number.isFinite(
                          mediaBitRateBps
                        ) ||
                        mediaBitRateBps <= 0
                      ) &&
                      Number.isFinite(
                        fileSizeBytes
                      ) &&
                      fileSizeBytes > 0 &&
                      Number.isFinite(
                        durationSeconds
                      ) &&
                      durationSeconds > 0
                    ) {
                      mediaBitRateBps =
                        (
                          fileSizeBytes *
                          8
                        ) /
                        durationSeconds;
                    }

                    const mediaMbps =
                      mediaBitRateBps > 0
                        ? (
                            mediaBitRateBps /
                            1000000
                          )
                        : 0;

                    const sampleMbps =
                      Number(
                        delivery?.sampleMbps ||
                        0
                      );

                    const ratio =
                      mediaMbps > 0
                        ? (
                            sampleMbps /
                            mediaMbps
                          )
                        : 0;

                    const ok =
                      delivery?.ok === true &&
                      mediaMbps > 0 &&
                      ratio >= 1.25;

                    console.log(
                      '[W121ZOD134R SAME SOURCE ROUTE]',
                      'hash=' +
                        _w121zod110yHash.slice(
                          0,
                          12
                        ),
                      'attempt=' + attempt,
                      'mediaMbps=' +
                        mediaMbps.toFixed(2),
                      'sampleMbps=' +
                        sampleMbps.toFixed(2),
                      'ratio=' +
                        ratio.toFixed(2),
                      'sampleMs=' +
                        String(
                          delivery?.elapsedMs ||
                          0
                        ),
                      'ok=' +
                        String(ok)
                    );

                    return {
                      delivery,
                      mediaMbps,
                      sampleMbps,
                      ratio,
                      fileSizeBytes,
                      ok,
                    };
                  };

                let _w121zod134rMeasured =
                  await _w121zod134rMeasureDelivery(
                    _w121zod134rProbeAuthority,
                    'initial'
                  );

                if (
                  !_w121zod134rMeasured.ok &&
                  _w121zod110yStillCurrent()
                ) {
                  console.log(
                    '[W121ZOD134R SAME SOURCE RERESOLVE]',
                    'hash=' +
                      _w121zod110yHash.slice(
                        0,
                        12
                      ),
                    'action=fresh-premiumize-route'
                  );

                  try {
                    // W121ZOD134R2C_BOUNDED_FRESH_ROUTE
                    // R2B's initial authenticated media probe is already capped
                    // at 5s. Keep SAME-source fresh-route recovery, but do not
                    // inherit premiumizeMediaProbe's 45s default timeout.
                    const _w121zod134rFreshProbe =
                      await premiumizeMediaProbe(
                        _w121zod110yMagnet,
                        _w121zod110yMediaPath,
                        5000
                      );

                    if (!_w121zod110yStillCurrent()) {
                      return;
                    }

                    const _w121zod134rFreshDecision =
                      _w121zod108e1ActualAudioDecision(
                        _w121zod134rFreshProbe
                      );

                    if (
                      _w121zod134rFreshDecision.ok
                    ) {
                      const _w121zod134rFreshMeasured =
                        await _w121zod134rMeasureDelivery(
                          _w121zod134rFreshProbe,
                          'fresh'
                        );

                      _w121zod134rMeasured =
                        _w121zod134rFreshMeasured;

                      if (
                        _w121zod134rFreshMeasured.ok
                      ) {
                        _w121zod134rProbeAuthority =
                          _w121zod134rFreshProbe;

                        // Critical: Player must receive the SAME fresh URL
                        // that actually passed the delivery measurement.
                        _w121zod110yEntry.probe =
                          _w121zod134rFreshProbe;

                        _w121zod110yEntry.probeAtMs =
                          Date.now();

                        console.log(
                          '[W121ZOD134R SAME SOURCE RECOVERED]',
                          'hash=' +
                            _w121zod110yHash.slice(
                              0,
                              12
                            ),
                          'ratio=' +
                            _w121zod134rFreshMeasured
                              .ratio
                              .toFixed(2)
                        );
                      }
                    }
                  } catch (
                    _w121zod134rFreshError
                  ) {
                    console.warn(
                      '[W121ZOD134R SAME SOURCE RERESOLVE]',
                      'hash=' +
                        _w121zod110yHash.slice(
                          0,
                          12
                        ),
                      'error=' +
                        String(
                          (
                            _w121zod134rFreshError as any
                          )?.message ||
                          _w121zod134rFreshError ||
                          ''
                        )
                    );
                  }
                }

                const _w121zod110yReadiness = {
                  ok:
                    _w121zod134rMeasured.ok,

                  reason:
                    _w121zod134rMeasured.ok
                      ? 'device-and-delivery-compatible'
                      : (
                          _w121zod134rMeasured
                            .delivery?.ok === true
                            ? 'startup-delivery-low-headroom-after-reresolve'
                            : (
                                _w121zod134rMeasured
                                  .delivery?.reason ||
                                'startup-delivery-sample-error-after-reresolve'
                              )
                        ),

                  mediaMbps:
                    _w121zod134rMeasured
                      .mediaMbps,

                  sampleMbps: [
                    _w121zod134rMeasured
                      .sampleMbps
                  ],

                  minMbps:
                    _w121zod134rMeasured
                      .sampleMbps,

                  minRatio:
                    _w121zod134rMeasured
                      .ratio,

                  sampleBytes:
                    _w121zod134rMeasured
                      .delivery?.sampleBytes ||
                    0,

                  fileSizeBytes:
                    _w121zod134rMeasured
                      .fileSizeBytes,
                };

                if (!_w121zod110yStillCurrent()) return;

                _w121zod110yEntry.readiness =
                  _w121zod110yReadiness;
                _w121zod110yEntry.readinessAtMs =
                  Date.now();

                _w121zod110yEntry.finished = true;

                if (
                  _w121zod110yReadiness.ok === true
                ) {
                  console.log(
                    '[W121ZOD118A PREPARED WINNER]',
                    'hash=' +
                      _w121zod110yHash.slice(0, 12),
                    'minRatio=' +
                      Number(
                        _w121zod110yReadiness.minRatio || 0
                      ).toFixed(2)
                  );

                  _w121zod111eSetPrepUiTick(
                    (tick) => tick + 1
                  );
                }

                console.log(
                  '[W121ZOD110Y PREP STAGE]',
                  'stage=readiness',
                  'hash=' + _w121zod110yHash.slice(0, 12),
                  'ok=' + String(
                    _w121zod110yReadiness.ok
                  ),
                  'reason=' +
                    _w121zod110yReadiness.reason,
                  'minRatio=' +
                    _w121zod110yReadiness.minRatio
                      .toFixed(2)
                );
              } catch (_w121zod110yError) {
                if (_w121zod110yStillCurrent()) {
                  const _w121zod127Error =
                    String(
                      (_w121zod110yError as any)?.message ||
                      _w121zod110yError ||
                      ''
                    );

                  const _w121zod127PrepElapsedMs =
                    Date.now() -
                    _w121zod118h1PrepStartedAtRef.current;

                  const _w121zod127QueuePending =
                    _w121zod127Error
                      .toLowerCase()
                      .includes(
                        'unsupported link for direct download'
                      ) &&
                    _w121zod127PrepElapsedMs < 60000;

                  _w121zod110yEntry.error =
                    _w121zod127Error;

                  _w121zod110yEntry.finished = true;

                  // Dynamic field is intentional: entry is already any.
                  _w121zod110yEntry.queuePending =
                    _w121zod127QueuePending;

                  console.log(
                    '[W121ZOD110Y PREP STAGE]',
                    'stage=error',
                    'hash=' +
                      _w121zod110yHash.slice(0, 12),
                    'error=' +
                      _w121zod110yEntry.error
                  );

                  if (_w121zod127QueuePending) {
                    console.log(
                      '[W121ZOD127 QUEUE PENDING]',
                      'hash=' +
                        _w121zod110yHash.slice(0, 12),
                      'elapsedMs=' +
                        String(_w121zod127PrepElapsedMs),
                      'action=recheck-directdl-after-queue-progress'
                    );
                  }
                }
              } finally {
                _w121zod110yEntry.running = false;

                if (
                  _w121zod110yStillCurrent() &&
                  _w121zod110yEntry
                    ?.readiness?.ok !== true
                ) {
                  const reason =
                    String(
                      _w121zod110yEntry.error ||
                      _w121zod110yEntry
                        ?.readiness?.reason ||
                      (
                        _w121zod110yEntry
                          .mediaCompatible
                          ? 'readiness-not-proven'
                          : 'media-not-compatible'
                      )
                    );

                  const _w121zod127QueuePending =
                    _w121zod110yEntry
                      .queuePending === true;

                  if (_w121zod127QueuePending) {
                    _w121zod110yEntry.queuePending =
                      false;

                    // Remove only the temporary prep record. Do NOT put this
                    // hash in PrepRejectedRef; its queue may become ready.
                    _w121zod110yPrepCacheRef.current.delete(
                      _w121zod110yPrepKey
                    );

                    console.log(
                      '[W121ZOD127 QUEUE RECHECK]',
                      'hash=' +
                        _w121zod110yHash.slice(0, 12),
                      'delayMs=2500'
                    );

                    setTimeout(() => {
                      if (
                        !_w121zod118DetailsPrepActiveRef.current
                      ) {
                        return;
                      }

                      _w121zod117SetPrepRetryTick(
                        (tick) => tick + 1
                      );
                    }, 2500);
                  } else {
                    _w121zod117RejectPreparedCandidate(
                      reason
                    );
                  }
                }
              }
            })();

            _w121zod110yEntry.promise =
              _w121zod110yPromise;

            void _w121zod110yPromise;
          }
        }
      }
    }
  }, [streams, isLoadingStreams, id, type, content, paramName, _v296_cacheTick, _w121zod117PrepRetryTick]);

  /* V656_DETAILS_REMOVE_LEGACY_PRERESOLVE
   * Obsolete direct-backend pre-resolve hook removed.
   * The active V291 hook above is the sole details-page PM prewarm path.
   */

  const loadContent = async () => {
    try {
      const contentId =
        isEpisodePage
          ? baseId
          : id;

      const data =
        await api.content.getMeta(
          type!,
          contentId!
        );

      setContent((previous: any) => {
        const merged = {
          ...(previous || {}),
          ...(data || {}),
          background:
            (data as any)?.background ||
            previous?.background ||
            '',
          poster:
            (data as any)?.poster ||
            previous?.poster ||
            '',
          logo:
            (data as any)?.logo ||
            previous?.logo ||
            '',
        } as ContentItem;

        if (contentId) {
          setMetaCache(
            contentId,
            merged
          );
        }

        return merged;
      });
    } catch (error) {
      console.log(
        'Failed to fetch meta:',
        error
      );
      // Keep using route/disk metadata already painted.
    }

    setIsLoadingContent(false);
  };
  // W121ZOD118H1_DIRECT_PREPARED_HANDOFF
  // Normal Play consumes the exact media URL already validated by Preparing
  // Media. It does not clear PM cache, re-rank, re-resolve, or send fallback
  // torrents to Player.
  const _w121zod118h1PlayPreparedEntry = (
    entry: any
  ): boolean => {
    try {
      const directUrl =
        String(entry?.probe?.link || '').trim();

      const hash =
        String(entry?.hash || '').trim().toLowerCase();

      const mediaPath =
        String(entry?.mediaPath || '').trim();

      if (
        !/^https:\/\//i.test(directUrl) ||
        !/^[a-f0-9]{40}$/.test(hash) ||
        !mediaPath ||
        entry?.mediaCompatible !== true ||
        entry?.readiness?.ok !== true
      ) {
        return false;
      }

      const subtitleContentId = isEpisodePage
        ? `${baseId}:${episodeSeason}:${episodeNumber}`
        : (id as string);

      const contentTitle = currentEpisode
        ? `S${episodeSeason}E${episodeNumber} - ${currentEpisode.name || content?.name || 'Video'}`
        : (
            nextTitleParam
              ? String(nextTitleParam)
              : isEpisodePage
                ? `S${episodeSeason}E${episodeNumber} - ${content?.name || 'Loading...'}`
                : content?.name || 'Video'
          );

      const cType = (type as string) || 'movie';

      const identityTitle = String(
        (content as any)?.name ||
        (content as any)?.title ||
        (paramName as any) ||
        ''
      ).trim();

      const identityYear = _v745Year(
        (content as any)?.year ||
        (content as any)?.releaseYear ||
        (content as any)?.releaseInfo ||
        ''
      );

      const currentEpisodeMeta =
        type === 'series'
          ? {
              seriesId: baseId || id,
              season: _v238ValidNum(episodeSeason)
                ? String(episodeSeason)
                : (_v238ValidNum(resumeSeason) ? String(resumeSeason) : ''),
              episode: _v238ValidNum(episodeNumber)
                ? String(episodeNumber)
                : (_v238ValidNum(resumeEpisode) ? String(resumeEpisode) : ''),
              episodeName: currentEpisode?.name || '',
            }
          : {};

      const nextEpisodeData = nextEpisode
        ? {
            nextEpisodeId: `${baseId}:${nextEpisode.season}:${nextEpisode.episode}`,
            nextEpisodeTitle: `S${nextEpisode.season}E${nextEpisode.episode} - ${nextEpisode.name || 'Next Episode'}`,
            nextEpisodePoster:
              nextEpisode.thumbnail || content?.background || '',
            nextEpisodeBackdrop:
              nextEpisode.thumbnail || content?.background || '',
          }
        : {};

      const shouldResume =
        resumePosition &&
        parseFloat(String(resumePosition)) > 0 &&
        (
          (type === 'movie' && !resumeEpisodeId) ||
          (type === 'series' && resumeEpisodeId === subtitleContentId)
        );

      const resumeData = shouldResume
        ? { resumePosition }
        : {};

      const overlayUri = String(
        paramPoster ||
        currentEpisode?.thumbnail ||
        nextBackdropParam ||
        content?.background ||
        content?.poster ||
        nextPosterParam ||
        ''
      );

      const sNum = _v238ValidNum(episodeSeason)
        ? episodeSeason
        : (_v238ValidNum(resumeSeason) ? resumeSeason : null);

      const eNum = _v238ValidNum(episodeNumber)
        ? episodeNumber
        : (_v238ValidNum(resumeEpisode) ? resumeEpisode : null);

      const overlayPass = {
        ovName: (content?.name || '') as string,
        ovEp: type === 'series'
          ? String(
              nextTitleParam ||
              currentEpisode?.name ||
              (_v238ValidNum(episodeNumber)
                ? `Episode ${episodeNumber}`
                : (_v238ValidNum(resumeEpisode)
                  ? `Episode ${resumeEpisode}`
                  : ''))
            )
          : '',
        ovSE: type === 'series'
          ? (
              ((sNum != null) ? `S${sNum}` : '') +
              ((eNum != null) ? ` E${eNum}` : '')
            ).trim()
          : '',
      };

      // W121ZOD134C_PREPARED_RECOVERY_POOL
      // The exact prepared direct URL remains primary. Build only a small,
      // synchronous recovery pool from the freshest current Details streams.
      // No fallback is resolved here, so normal Play receives no added network delay.
      const _w121zod134cFallbackSeen =
        new Set<string>([hash]);

      const _w121zod134cFallbackHealthMap =
        _v769GetSeekHealthMap();

      const _w121zod134cSeedCount =
        (candidate: any): number => {
          try {
            const raw =
              candidate?.seeders ??
              candidate?.seed ??
              candidate?.seeds ??
              0;

            const parsed =
              typeof raw === 'number'
                ? raw
                : parseInt(String(raw), 10);

            return Number.isFinite(parsed)
              ? parsed
              : 0;
          } catch (_) {
            return 0;
          }
        };

      const _w121zod134cFallbackCandidates =
        (Array.isArray(streams) ? streams : [])
          .filter((candidate: any) => {
            if (_v672IsSampleLikeStream(candidate)) {
              return false;
            }

            if (_w121zod108e1IsStrictForeignStream(candidate)) {
              return false;
            }

            const candidateHash =
              String(
                candidate?.infoHash ||
                candidate?.info_hash ||
                ''
              )
                .trim()
                .toLowerCase();

            if (!/^[a-f0-9]{40}$/.test(candidateHash)) {
              return false;
            }

            if (_w121zod134cFallbackSeen.has(candidateHash)) {
              return false;
            }

            if (
              _w121zod117PrepRejectedRef.current.has(
                candidateHash
              )
            ) {
              return false;
            }

            const health =
              _w121zod134cFallbackHealthMap[
                candidateHash
              ];

            if (
              health?.ff === 'fail' ||
              health?.rw === 'fail' ||
              _w121zod106gPlaybackBadForSelection(
                health
              )
            ) {
              return false;
            }

            const candidateIdentity =
              String(
                candidate?.filename ||
                candidate?.title ||
                candidate?.name ||
                ''
              ).trim();

            if (
              type === 'movie' &&
              identityTitle &&
              !_v747MovieIdentityMatches(
                id,
                content,
                candidate,
                identityTitle,
                identityYear,
                candidateIdentity
              )
            ) {
              return false;
            }

            if (
              type === 'series' &&
              isEpisodePage &&
              identityTitle &&
              !_v745EpisodeIdentityMatches(
                identityTitle,
                episodeSeason,
                episodeNumber,
                candidateIdentity
              )
            ) {
              return false;
            }

            _w121zod134cFallbackSeen.add(
              candidateHash
            );

            return true;
          });

      // Prefer the hedge already warmed during Preparing Media.
      const _w121zod134cWarmFallback =
        _w121zod134cFallbackCandidates.find(
          (candidate: any) => {
            const candidateHash =
              String(
                candidate?.infoHash ||
                candidate?.info_hash ||
                ''
              )
                .trim()
                .toLowerCase();

            return _w121zod118h1HedgeWarmRef.current.has(
              candidateHash
            );
          }
        ) || null;

      const _w121zod134cPolicyFallback =
        _v503PickReliableAutoStream(
          _w121zod134cFallbackCandidates,
          type === 'movie' || type === 'series'
        ) ||
        _w121zod134cFallbackCandidates[0] ||
        null;

      const _w121zod134cFirstFallback =
        _w121zod134cWarmFallback ||
        _w121zod134cPolicyFallback;

      const _w121zod134cFirstFallbackHash =
        String(
          _w121zod134cFirstFallback?.infoHash ||
          (_w121zod134cFirstFallback as any)
            ?.info_hash ||
          ''
        )
          .trim()
          .toLowerCase();

      const _w121zod134cFallbackTorrents = [
        ...(
          _w121zod134cFirstFallback
            ? [_w121zod134cFirstFallback]
            : []
        ),
        ..._w121zod134cFallbackCandidates
          .filter(
            (candidate: any) =>
              String(
                candidate?.infoHash ||
                candidate?.info_hash ||
                ''
              )
                .trim()
                .toLowerCase() !==
              _w121zod134cFirstFallbackHash
          )
          .sort(
            (a: any, b: any) =>
              _w121zod134cSeedCount(b) -
              _w121zod134cSeedCount(a)
          ),
      ]
        .slice(0, 3)
        .map((candidate: any) => ({
          infoHash:
            candidate.infoHash ||
            candidate.info_hash,
          fileIdx: candidate.fileIdx,
          filename: candidate.filename || '',
          sources: candidate.sources || [],
          name: candidate.name || '',
          title: candidate.title || '',
        }));

      console.log(
        '[W121ZOD118H1 DIRECT PREPARED HANDOFF]',
        'hash=' + hash.slice(0, 12),
        'fallbackTorrents=' +
          String(
            _w121zod134cFallbackTorrents.length
          ),
        'fallbackStreams=0',
        'readiness=' +
          String(
            entry?.readiness?.reason ||
            'ok'
          )
      );

      router.push({
        pathname: '/player',
        params: {
          directUrl,
          infoHash: hash,
          title: contentTitle,
          isLive: 'false',
          contentType: cType,
          contentId: subtitleContentId,
          identityTitle,
          identityYear,
          filename: mediaPath,
          fallbackStreams: '[]',
          fallbackTorrents:
            JSON.stringify(
              _w121zod134cFallbackTorrents
            ),
          backdrop: overlayUri,
          ...overlayPass,
          poster: content?.poster || nextPosterParam || '',
          logo: content?.logo || '',
          ...currentEpisodeMeta,
          ...nextEpisodeData,
          ...resumeData,
        },
      });

      return true;
    } catch (error) {
      console.warn(
        '[W121ZOD118H1 DIRECT PREPARED HANDOFF]',
        'ok=false',
        String((error as any)?.message || error)
      );
      return false;
    }
  };

  const handleStreamSelect = async (
    stream: Stream,
    preserveSelectedStream: boolean = false,
    autoRejectedHashes: Set<string> = new Set<string>()
  ) => {
    if (_v672IsSampleLikeStream(stream)) {
      console.warn(
        '[V672] blocked explicit sample/trailer stream selection',
        String((stream as any)?.title || (stream as any)?.name || '').slice(0, 120)
      );
      return;
    }
    // V298_INLINE_PM_KEY_SEED_BUILD_TAG â€” eliminate the race between V297's
    // mount useEffect (async, may not finish before user taps Play) and the
    // PM short-circuit in client.ts.  We re-check + write the key INLINE,
    // awaited, before any PM-dependent code path runs.  After this returns,
    // _hasPMKey() in client.ts is guaranteed to read true.
    /* v129-handle-upgrade */
    /* v131-handle-normalize */
    // Normalize info_hash (snake) -> infoHash (camel) up-front so the
    // upgrade-race condition + start_and_wait body both see the field.
    if ((stream as any).info_hash && !stream.infoHash) {
      stream = { ...stream, infoHash: (stream as any).info_hash } as any;
    }
    // V293_FORCE_FRESH_PM â€” when a Premiumize key is configured and the
    // chosen stream has an infoHash, ignore any cached direct URL (it may
    // be a stale PM link that expo-video will reject with "unable to
    // play video") and force the player's infoHash branch which carries a
    // cacheBust and triggers a fresh on-device PM resolve.  Also wipes the
    // local PM cache entry for this hash so resolveMagnet hits PM fresh.
    // V295 extends V293: ALSO strip /api/proxy/* URLs (backend routes that
    // are dead after middle-isolation) so we never hand expo-video a 404
    // backend URL.  When PM + infoHash are both present, the infoHash
    // branch is the ONLY working path.
    //
    // Verification (non-rendered build tag, present in disk + OTA bundle):
    //   findstr /C:"V295_PM_INFOHASH_PRIORITY_BUILD_TAG" "app\details\[type]\[id].tsx"
    //   tar -xOf ota.zip | findstr /C:"V295_PM_INFOHASH_PRIORITY_BUILD_TAG"
    const _V295_BUILD_TAG = 'V295_PM_INFOHASH_PRIORITY_BUILD_TAG';
    void _V295_BUILD_TAG;
    try {
      const _v293_pmKey = await isPremiumizeConfigured();
      if (_v293_pmKey && stream.infoHash) {
        if (stream.url) {
          console.log('[v295] PM+infoHash present â€” stripping url (was', String(stream.url).slice(0,60), ') to force fresh on-device PM resolve');
          stream = { ...stream, url: undefined } as any;
        }
        // Always wipe local PM cache for this infoHash before re-resolve.
        try { await AsyncStorage.removeItem('@pmcache:' + stream.infoHash); } catch (_) {}
        // Also bust cache entries for sibling fallback torrents so any
        // subsequent failover also re-resolves cleanly.
        try {
          const _v293_siblings = streams
            .filter((s: any) => s && s !== stream && s.infoHash && s.infoHash !== stream.infoHash)
            .slice(0, 10);
          for (const _sib of _v293_siblings) {
            try { await AsyncStorage.removeItem('@pmcache:' + (_sib as any).infoHash); } catch (_) {}
          }
        } catch (_) {}
      }
    } catch (_) {}
    if ((stream as any).upgrade_candidate && stream.infoHash && !stream.url) {
      // V656_DETAILS_PM_ONLY_UPGRADE
      // Keep the selected upgrade candidate intact. The player resolves
      // this infoHash through the Premiumize-only api.stream path.
      setIsPlayLoading(true);
      console.log('[V656] upgrade candidate proceeding to PM-only player resolve:', stream.infoHash.slice(0, 8));
    }
    const subtitleContentId = isEpisodePage 
      ? `${baseId}:${episodeSeason}:${episodeNumber}`
      : (id as string);
    const contentTitle = currentEpisode 
      ? `S${episodeSeason}E${episodeNumber} - ${currentEpisode.name || content?.name || 'Video'}`
      : (nextTitleParam ? String(nextTitleParam) : (isEpisodePage ? `S${episodeSeason}E${episodeNumber} - ${content?.name || 'Loading...'}` : content?.name || 'Video'));
    const cType = type as string || 'movie';


    // W121ZOD108E1_PREPLAYER_AUTO_SOURCE_GATE
    // W121ZOD115I_PHONE_OD_POLICY
    // W121ZSA handed a correctly ranked/identity-checked Premiumize URL
    // directly to Player. Disable the later pre-player media/readiness
    // rejection loop for normal OD; runtime fallback remains in Player.
    const _w121zod108e1AutoOd = true; // W121ZOD117A_PREPLAYER_SAFETY

    const _w121zod108e1Rejected =
      autoRejectedHashes instanceof Set
        ? autoRejectedHashes
        : new Set<string>();

    // W121ZOD108H4P_PREFLIGHT_SERIES_IDENTITY
    // Pre-player retry/downshift must preserve the same exact-series
    // identity boundary already enforced by runtime fallback paths.
    // Keep this local title independent of the later V745 variables so
    // strict-foreign retry can safely call the helper before V745 init.
    const _w121zod108h4pSeriesIdentityTitle = String(
      (content as any)?.name ||
      (content as any)?.title ||
      (paramName as any) ||
      ''
    ).trim();

    const _w121zod108e1TryNextAutoCandidate = async (
      failedHash: string,
      reason: string,
      candidatePool: Stream[] = streams || []
    ): Promise<boolean> => {
      if (!_w121zod108e1AutoOd) return false;

      const rejected = new Set<string>(_w121zod108e1Rejected);
      const normalizedFailedHash = String(failedHash || '')
        .trim()
        .toLowerCase();

      if (normalizedFailedHash) {
        rejected.add(normalizedFailedHash);
      }

      const remaining = (candidatePool || []).filter((candidate: any) => {
        const hash = String(
          candidate?.infoHash || candidate?.info_hash || ''
        )
          .trim()
          .toLowerCase();

        if (!hash || rejected.has(hash)) return false;
        if (_v672IsSampleLikeStream(candidate)) return false;
        if (_w121zod108e1IsStrictForeignStream(candidate)) return false;

        // W121ZOD118H1_RETRY_MOVIE_IDENTITY
        if (cType === 'movie') {
          const candidateIdentity = String(
            candidate?.filename ||
            candidate?.title ||
            candidate?.name ||
            ''
          ).trim();

          const requestedTitle = String(
            (content as any)?.name ||
            (content as any)?.title ||
            (paramName as any) ||
            ''
          ).trim();

          const requestedYear =
            (content as any)?.releaseInfo ||
            (content as any)?.year ||
            (content as any)?.releaseYear ||
            '';

          if (
            !candidateIdentity ||
            !_v747MovieIdentityMatches(
              id,
              content,
              candidate,
              requestedTitle,
              requestedYear,
              candidateIdentity
            )
          ) {
            return false;
          }
        }

        // W121ZOD108H4P_PREFLIGHT_SERIES_IDENTITY
        // H4D readiness downshift previously operated on this pool before
        // episode identity was rechecked, allowing an unrelated lower-tier
        // title to become the next automatic preflight candidate.
        if (cType === 'series') {
          const candidateIdentity = String(
            candidate?.filename ||
            candidate?.title ||
            candidate?.name ||
            ''
          ).trim();

          if (
            _w121zod108h4pSeriesIdentityTitle &&
            candidateIdentity &&
            !_v745EpisodeIdentityMatches(
              _w121zod108h4pSeriesIdentityTitle,
              episodeSeason,
              episodeNumber,
              candidateIdentity
            )
          ) {
            console.warn(
              '[W121ZOD108H4P PREFLIGHT IDENTITY REJECT]',
              'series=' + _w121zod108h4pSeriesIdentityTitle,
              'season=' + String(episodeSeason),
              'episode=' + String(episodeNumber),
              'candidate=' + candidateIdentity.slice(0, 140)
            );

            return false;
          }
        }

        return true;
      });

      // W121ZOD108H4D_READINESS_DOWNSHIFT
      // If no previously proven candidate is available, a failed device-side
      // random-access test immediately reduces delivery burden instead of
      // cycling through another unproven stream at the same quality tier.
      let selectionPool = remaining;

      if (String(reason || '').startsWith('seek-readiness-')) {
        const healthMap = _v769GetSeekHealthMap();

        const provenRemaining = remaining.filter((candidate: any) => {
          const hash = String(
            candidate?.infoHash || candidate?.info_hash || ''
          )
            .trim()
            .toLowerCase();

          const health = hash ? healthMap[hash] : null;

          const playbackPass =
            health?.playbackPolicy ===
              _W121ZOD106G_PLAYBACK_HEALTH_POLICY &&
            health?.playback === 'pass' &&
            health?.playbackPassReason === 'natural-eof';

          return (
            health?.ff === 'pass' ||
            health?.rw === 'pass' ||
            playbackPass
          );
        });

        const qualityLevel = (candidate: any): number => {
          const quality = String(
            (parseStreamInfo(candidate) as any)?.quality || ''
          ).toUpperCase();

          if (quality === '4K' || quality.includes('2160')) return 4;
          if (quality.includes('1080')) return 3;
          if (quality.includes('720')) return 2;
          if (quality === 'SD' || quality.includes('480')) return 1;
          return 0;
        };

        const failedStream = (candidatePool || []).find((candidate: any) => {
          const hash = String(
            candidate?.infoHash || candidate?.info_hash || ''
          )
            .trim()
            .toLowerCase();

          return hash === normalizedFailedHash;
        });

        const failedLevel = qualityLevel(failedStream);

        if (provenRemaining.length > 0) {
          selectionPool = provenRemaining;
        } else if (failedLevel > 0) {
          /*
           * W121ZOD110D_READINESS_SAME_TIER_FIRST
           *
           * A delivery/readiness failure proves only that THIS candidate
           * cannot safely sustain automatic playback right now.
           *
           * Do not immediately sacrifice resolution.
           * First try another candidate at the same quality tier.
           */
          const sameTier = remaining.filter(
            (candidate: any) =>
              qualityLevel(candidate) === failedLevel
          );

          if (sameTier.length > 0) {
            selectionPool = sameTier;

            console.log(
              '[W121ZOD110D READINESS SAME-TIER RETRY]',
              'reason=' + reason,
              'level=' + String(failedLevel),
              'candidates=' + String(sameTier.length)
            );
          } else if (failedLevel > 1) {
            const lowerTier = remaining.filter(
              (candidate: any) => {
                const level = qualityLevel(candidate);

                return (
                  level > 0 &&
                  level < failedLevel
                );
              }
            );

            if (lowerTier.length > 0) {
              selectionPool = lowerTier;

              console.log(
                '[W121ZOD108H4D READINESS DOWNSHIFT]',
                'reason=' + reason,
                'fromLevel=' + String(failedLevel),
                'candidates=' + String(lowerTier.length)
              );
            }
          }
        }
      }

      const next =
        _v503PickReliableAutoStream(selectionPool, true);

      if (!next) {
        console.warn(
          '[W121ZOD108E1 AUTO PREFLIGHT EXHAUSTED]',
          'reason=' + reason,
          'rejected=' + rejected.size
        );

        setIsPlayLoading(false);

        // W121ZOD118H3_NO_PLAYBACK_UNAVAILABLE
        // Exhausting one automatic selection pass is not permission to show
        // a terminal playback state. Keep the OD gate in preparation mode.
        _w121zod118dSetPrepExhausted(false);
        return false;
      }

      const nextHash = String(
        (next as any)?.infoHash ||
        (next as any)?.info_hash ||
        ''
      )
        .trim()
        .toLowerCase();

      console.warn(
        '[W121ZOD108E1 AUTO PREFLIGHT NEXT]',
        'rejected=' + normalizedFailedHash.slice(0, 12),
        'reason=' + reason,
        'next=' + nextHash.slice(0, 12)
      );

      await handleStreamSelect(next, false, rejected);
      return true;
    };

    if (
      _w121zod108e1AutoOd &&
      stream.infoHash &&
      _w121zod108e1IsStrictForeignStream(stream)
    ) {
      await _w121zod108e1TryNextAutoCandidate(
        String(stream.infoHash || ''),
        'strict-foreign',
        streams || []
      );
      return;
    }

    const _v745DefaultIdentityTitle = String(
      (content as any)?.name ||
      (content as any)?.title ||
      (paramName as any) ||
      ''
    ).trim();

    const _v780eJstrmIdentityTitle =
      (
        type === 'Porn' ||
        type === 'porn' ||
        type === 'adult'
      ) &&
      String(id || '')
        .toLowerCase()
        .startsWith('jstrm:')
        ? _v780eJstrmTitle(id)
        : '';

    const _v745IdentityTitle =
      _v780eJstrmIdentityTitle ||
      _v745DefaultIdentityTitle;

    if (_v780eJstrmIdentityTitle) {
      console.log(
        '[V780E JSTRM IDENTITY]',
        String(stream.infoHash || '').slice(0, 8),
        '|',
        _v780eJstrmIdentityTitle.slice(0, 120)
      );
    }
    const _v745IdentityYear = _v745Year(
      (content as any)?.year ||
      (content as any)?.releaseYear ||
      (content as any)?.releaseInfo ||
      ''
    );
    
    // Always pass current-episode metadata for series content so the
// player's loading screen can render "S3E6 - Rest and Ricklaxation"
// with the correct backdrop, regardless of whether there's a next ep.
// v238c â€” also defend against NaN.  Some CW entries (porn / JT / PT
// addons) have content_id="pt:NaN:1054329" or "jt:NaN:NaN" â€” parseInt
// returns NaN, NaN != null is TRUE, String(NaN) === "NaN" â†’ player
// rendered "Episode NaN"/"Episode null".  Fall back through valid
// resumeSeason/resumeEpisode then empty string.
const _v238ValidNum = (n: any) => (n != null && !Number.isNaN(Number(n)));
const currentEpisodeMeta = type === 'series' ? {
  seriesId: baseId || id,
  season: _v238ValidNum(episodeSeason)
    ? String(episodeSeason)
    : (_v238ValidNum(resumeSeason) ? String(resumeSeason) : ''),
  episode: _v238ValidNum(episodeNumber)
    ? String(episodeNumber)
    : (_v238ValidNum(resumeEpisode) ? String(resumeEpisode) : ''),
  episodeName: currentEpisode?.name || '',
} : {};

const nextEpisodeData = nextEpisode ? {
  nextEpisodeId: `${baseId}:${nextEpisode.season}:${nextEpisode.episode}`,
  nextEpisodeTitle: `S${nextEpisode.season}E${nextEpisode.episode} - ${nextEpisode.name || 'Next Episode'}`,
  // PATCH v2: player.tsx consumes `nextEpisodePoster`, not `nextEpisodeBackdrop`.
  // Send the EPISODE thumbnail so the Up Next overlay shows the right image.
  nextEpisodePoster: nextEpisode.thumbnail || content?.background || '',
  nextEpisodeBackdrop: nextEpisode.thumbnail || content?.background || '',
} : {};
    
    const shouldResume = resumePosition && parseFloat(resumePosition) > 0 && (
      (type === 'movie' && !resumeEpisodeId) ||
      (type === 'series' && resumeEpisodeId === subtitleContentId)
    );
    const resumeData = shouldResume ? { resumePosition } : {};

    /* V384_ONE_LOADING_SCREEN - hand the player the EXACT image and text
       the details overlay is showing, so its loading screen paints the
       same pixels and the handoff is invisible. */
    const _v384OverlayUri = ((paramPoster /* V387_STABLE_OVERLAY_IMAGE */ || currentEpisode?.thumbnail || nextBackdropParam || content?.background || content?.poster || nextPosterParam) || '') as string;
    const _v384EpLine = type === 'series'
      ? String(nextTitleParam
          || currentEpisode?.name
          || (_v238ValidNum(episodeNumber)
                ? `Episode ${episodeNumber}`
                : (_v238ValidNum(resumeEpisode) ? `Episode ${resumeEpisode}` : '')))
      : '';
    const _v384sN = _v238ValidNum(episodeSeason) ? episodeSeason : (_v238ValidNum(resumeSeason) ? resumeSeason : null);
    const _v384eN = _v238ValidNum(episodeNumber) ? episodeNumber : (_v238ValidNum(resumeEpisode) ? resumeEpisode : null);
    const _v384SELine = type === 'series'
      ? (((_v384sN != null) ? `S${_v384sN}` : '') + ((_v384eN != null) ? ` E${_v384eN}` : '')).trim()
      : '';
    const _v384Pass = {
      ovName: (content?.name || '') as string,
      ovEp: _v384EpLine,
      ovSE: _v384SELine,
    };
    
    /* V655_ANDROID_RUNTIME_CODEC_FALLBACKS
     * Android codec support varies by device, firmware, and OS.
     * Preserve alternate torrent candidates for PM-direct playback.
     * player.tsx remains authoritative for actual runtime decode failure.
     */
    const buildRuntimeCodecFallbackTorrents = (excludeInfoHash?: string) => {
      const excluded = String(excludeInfoHash || '').toLowerCase();
      const seen = new Set<string>();
      const _v767dFallbackBadHashes = _v767dGetBadHashSet();
      const _v744RequestedTitle = String(
        (content as any)?.name ||
        (content as any)?.title ||
        (paramName as any) ||
        ''
      );

      const seedCount = (s: any): number => {
        try {
          const raw = s?.seeders ?? s?.seed ?? s?.seeds ?? 0;
          const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
          return isFinite(n) ? n : 0;
        } catch {
          return 0;
        }
      };

      const candidates = streams.filter((s: any) => {
        if (_v672IsSampleLikeStream(s)) return false;

        if (
          type === 'movie' &&
          _v744RequestedTitle &&
          !_v747MovieIdentityMatches(
            id,
            content,
            s,
            _v744RequestedTitle,
            _v745IdentityYear,
            String(s?.title || s?.filename || s?.name || '')
          )
        ) {
          console.warn(
            '[V744 TITLE GUARD] rejected runtime fallback',
            String(s?.title || s?.filename || s?.name || '').slice(0, 120)
          );
          return false;
        }
        const hash = String(s?.infoHash || s?.info_hash || '').toLowerCase();
        if (!hash) return false;

        // W121ZOD108H1B_AUTO_RUNTIME_FALLBACK_GUARD
        // Do not resurrect anything rejected earlier by this Play attempt.
        // Keep English/content identity protection active through every retry.
        if (_w121zod108e1AutoOd) {
          if (_w121zod108e1Rejected.has(hash)) return false;
          if (_w121zod108e1IsStrictForeignStream(s)) return false;

          const candidateIdentity = String(
            s?.filename ||
            s?.title ||
            s?.name ||
            ''
          ).trim();

          if (
            type === 'series' &&
            _v745IdentityTitle &&
            candidateIdentity &&
            !_v745EpisodeIdentityMatches(
              _v745IdentityTitle,
              episodeSeason,
              episodeNumber,
              candidateIdentity
            )
          ) {
            return false;
          }
        }
        if (_v767dFallbackBadHashes.has(hash)) return false;
        if (excluded && hash === excluded) return false;
        if (seen.has(hash)) return false;
        seen.add(hash);
        return true;
      });

      // W121ZOD104J27_FALLBACK_PLAYBACK_FILTER
      // W121ZOD104J30_FALLBACK_HEALTH_SCOPE_FIX
      // _v769SeekHealthRank is local to the authoritative selector
      // and cannot be called from this fallback-builder scope.
      // Read the same durable V769 map here instead.
      const _v104j30FallbackHealthMap =
        _v769GetSeekHealthMap();

      const _v104j30FallbackHealthRank =
        (s: any): number => {
          if (type !== 'movie' && type !== 'series') return 0;
          const hash =
            String(
              s?.infoHash ||
              s?.info_hash ||
              ''
            )
              .trim()
              .toLowerCase();

          const h =
            hash
              ? _v104j30FallbackHealthMap[hash]
              : null;

          // W121ZOD106G_FALLBACK_PLAYBACK_POLICY
          const playbackFailActive =
            _w121zod106gPlaybackBadForSelection(h);

          if (
            h?.ff === 'fail' ||
            h?.rw === 'fail' ||
            playbackFailActive
          ) {
            return -1;
          }

          return 0;
        };

      const _v104j27NonFailedCandidates =
        candidates.filter(
          (s: any) =>
            _v104j30FallbackHealthRank(s) >= 0
        );

      const _v104j27FallbackCandidates =
        _v104j27NonFailedCandidates.length > 0
          ? _v104j27NonFailedCandidates
          : candidates;

      const sorted = [..._v104j27FallbackCandidates].sort(
        (a: any, b: any) => seedCount(b) - seedCount(a)
      );

      const healthy = sorted.filter((s: any) => seedCount(s) >= 10);
      const unhealthy = sorted.filter((s: any) => seedCount(s) < 10);

      /*
       * V665F_FIRST_FALLBACK_POLICY_PARITY
       *
       * Preserve V655's proven health-first cascade, but choose the
       * first runtime retry with the same V503/V665 device-aware policy
       * used by normal Play. Remaining fallbacks keep their existing
       * seed-ranked order.
       */
      const healthOrdered = [...healthy, ...unhealthy];

      /* W121ZOD9B_FAST_FALLBACK_RESTORE
       * Rank the first retry with the authoritative selector.
       * Remaining retries retain health/seeder order.
       * Do NOT rerun V503 once per fallback.
       */
      const policyPool = healthy.length > 0 ? healthy : unhealthy;
      const policyFirst = _v503PickReliableAutoStream(policyPool, type === 'movie' || type === 'series');

      const policyFirstHash = String(
        policyFirst?.infoHash || policyFirst?.info_hash || ''
      ).toLowerCase();

      const fallbackOrder = policyFirstHash
        ? [
            policyFirst,
            ...healthOrdered.filter(
              (s: any) =>
                String(s?.infoHash || s?.info_hash || '').toLowerCase() !==
                policyFirstHash
            ),
          ]
        : healthOrdered;

      try {
        console.log(
          '[V665F FALLBACK POLICY]',
          'healthy=' + healthy.length,
          'unhealthy=' + unhealthy.length,
          'first=' + policyFirstHash.slice(0, 12)
        );
      } catch (_) {}

      return fallbackOrder
        .slice(0, 60)
        .map((s: any) => ({
          infoHash: s.infoHash || s.info_hash,
          fileIdx: s.fileIdx,
          filename: s.filename || '',
          sources: s.sources || [],
          name: s.name || '',
          title: s.title || '',
        }));
    };

    const buildFallbackUrls = async (): Promise<string[]> => {
      /* V354_HEALTHY_STREAMS_ONLY â€” Only include streams with enough seeders
         to actually stream reliably via /api/stream/torrent-video. Sort the
         fallback pool by seeder count DESC so cascade tries the most
         reliable torrents first. If the healthy pool is empty (unlikely
         but possible with obscure titles), fall back to all streams. */
      const authToken = await AsyncStorage.getItem('auth_token');
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || Constants.expoConfig?.extra?.backendUrl || '';
      const _v354_seed = (s: any): number => {
        try {
          const raw = s?.seeders ?? s?.seed ?? s?.seeds ?? 0;
          const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
          return isFinite(n) ? n : 0;
        } catch { return 0; }
      };
      const others = streams
        .filter(s => s !== stream)
        .filter(s => !_v672IsSampleLikeStream(s))
        .filter((s: any) => {
          if (!_w121zod108e1AutoOd) return true;

          // W121ZOD108H1B_AUTO_URL_FALLBACK_GUARD
          const hash = String(
            s?.infoHash ||
            s?.info_hash ||
            ''
          )
            .trim()
            .toLowerCase();

          if (
            hash &&
            _w121zod108e1Rejected.has(hash)
          ) {
            return false;
          }

          if (_w121zod108e1IsStrictForeignStream(s)) {
            return false;
          }

          const candidateIdentity = String(
            s?.filename ||
            s?.title ||
            s?.name ||
            ''
          ).trim();

          if (type === 'movie') {
            const requestedTitle = String(
              (content as any)?.name ||
              (content as any)?.title ||
              (paramName as any) ||
              ''
            );

            const requestedYear =
              (content as any)?.releaseInfo ||
              (content as any)?.year ||
              (content as any)?.releaseYear ||
              '';

            if (
              requestedTitle &&
              candidateIdentity &&
              !_v747MovieIdentityMatches(
                id,
                content,
                s,
                requestedTitle,
                requestedYear,
                candidateIdentity
              )
            ) {
              return false;
            }
          }

          if (
            type === 'series' &&
            _v745IdentityTitle &&
            candidateIdentity &&
            !_v745EpisodeIdentityMatches(
              _v745IdentityTitle,
              episodeSeason,
              episodeNumber,
              candidateIdentity
            )
          ) {
            return false;
          }

          return true;
        })
        .filter(s => s.url || s.directUrl);
      // Sort by seeders DESC so cascade tries healthy torrents first.
      const bySeeds = [...others].sort((a, b) => _v354_seed(b) - _v354_seed(a));
      // Prefer streams with >=5 seeders; if pool exhausted, include the rest.
      const healthy = bySeeds.filter(s => _v354_seed(s) >= 5);
      const unhealthy = bySeeds.filter(s => _v354_seed(s) < 5);
      const combined = [...healthy, ...unhealthy].slice(0, 80);
      return combined.map(s => {
        if (s.directUrl) return s.directUrl;
        const u = s.url!;
        if (u.startsWith('http://') || u.startsWith('https://')) return u;
        const separator = u.includes('?') ? '&' : '?';
        const tokenParam = authToken ? `${separator}token=${encodeURIComponent(authToken)}` : '';
        return `${backendUrl}${u}${tokenParam}`;
      });
    };
    
    try {
      /* V363_CURPLAY_BLOB - move off SQLite (SQLITE_FULL crash) onto FS. */
      try {
        const _b363 = require('../../../src/utils/blobCache');
        await _b363.setBlob('currentPlaying', JSON.stringify({
          contentType: cType,
          contentId: id,
          title: contentTitle,
        }));
      } catch (_) {
        await AsyncStorage.setItem('currentPlaying', JSON.stringify({
          contentType: cType,
          contentId: id,
          title: contentTitle,
        }));
      }
    } catch (e) {
      console.log('[DETAILS] Error saving to AsyncStorage:', e);
    }

    // V300_PM_BATCH_CACHE_RESOLVE_BUILD_TAG â€” replaces V299's single-hash
    // attempt with a batched approach: POST every candidate infoHash to PM
    // /cache/check in ONE call, pick the highest-quality stream whose hash
    // is cached, then directdl-resolve THAT one.  Eliminates the "wrong
    // infoHash auto-picked" failure: even if the sort puts an uncached
    // torrent first, V300 finds a cached sibling and uses it.
    // If literally no infoHash in the streams list is cached on the user's
    // PM account, V300 falls through to the existing flow (which will
    // also fail) â€” that's a PM cache reality issue, not a code bug.
    //
    // Verification:
    //   findstr /C:"V300_PM_BATCH_CACHE_RESOLVE_BUILD_TAG" "app\details\[type]\[id].tsx"
    {
      const _V300_BUILD_TAG = 'V300_PM_BATCH_CACHE_RESOLVE_BUILD_TAG';
      void _V300_BUILD_TAG;
      try {
        // W121ZOD9B_NO_PM_STATUS_PREFLIGHT
        // Cache-check/directdl are authoritative.
        const _v300_pm = true;
        if (_v300_pm) {
          // Build ordered candidate list: chosen stream first, then the
          // rest of `streams` (already sorted by quality/language above).
          // De-dupe by infoHash.
          const _v300_candidates: Array<{ stream: any; hash: string }> = [];
          const _v300_seen = new Set<string>();
          const _v300_pushCand = (s: any) => {
            if (!s || !s.infoHash) return;
            if (_v672IsSampleLikeStream(s)) return;

            // W121ZOD9B_V300_IDENTITY_WALL
            if (!preserveSelectedStream && type === 'movie') {
              const reqTitle = String(
                (content as any)?.name ||
                (content as any)?.title ||
                (paramName as any) ||
                ''
              );

              const reqYear =
                (content as any)?.releaseInfo ||
                (content as any)?.year ||
                (content as any)?.releaseYear ||
                '';

              const candidateIdentity = String(
                s?.filename ||
                s?.title ||
                s?.name ||
                ''
              ).trim();

              if (
                reqTitle &&
                candidateIdentity &&
                !_v747MovieIdentityMatches(
                  id,
                  content,
                  s,
                  reqTitle,
                  reqYear,
                  candidateIdentity
                )
              ) {
                return;
              }
            }

            const h = String(s.infoHash).toLowerCase();

            if (_w121zod108e1AutoOd) {
              if (_w121zod108e1Rejected.has(h)) return;
              if (_w121zod108e1IsStrictForeignStream(s)) return;
            }

            if (_v300_seen.has(h)) return;
            _v300_seen.add(h);
            _v300_candidates.push({ stream: s, hash: h });
          };
          // W121ZOD110F_RETRY_CANDIDATE_AUTHORITY
          //
          // Initial automatic Play may still let V300 evaluate the full
          // cached sibling pool. That is the normal V665C policy path.
          //
          // Once preflight has rejected at least one hash, however,
          // _w121zod108e1TryNextAutoCandidate() has already selected the
          // authoritative next candidate according to proven health,
          // reliability, and W110D same-tier-before-downshift policy.
          //
          // Do not reopen the full pool here and silently replace that
          // retry winner. Validate the selected retry hash itself. If it
          // fails, the existing retry helper advances again.
          const _w121zod110fAutoRetry =
            _w121zod108e1AutoOd &&
            _w121zod108e1Rejected.size > 0;

          _v300_pushCand(stream);

          // V769V18_MANUAL_STREAM_AUTHORITY
          // Explicit stream-card selections remain authoritative.
          // V300 can resolve the selected hash through Premiumize,
          // but cannot substitute a sibling stream chosen by policy.
          if (
            !preserveSelectedStream &&
            !_w121zod110fAutoRetry
          ) {
            for (const _s of (streams || [])) {
              _v300_pushCand(_s);
            }
          } else if (_w121zod110fAutoRetry) {
            console.log(
              '[W121ZOD110F RETRY CANDIDATE AUTHORITY]',
              'selected=' + String(stream?.infoHash || '').slice(0, 12),
              'rejected=' + String(_w121zod108e1Rejected.size),
              'candidateCount=' + String(_v300_candidates.length)
            );
          } else {
            console.log(
              '[V769V18 MANUAL AUTHORITY]',
              'selected=' + String(stream?.infoHash || '').slice(0, 12),
              'candidateCount=' + _v300_candidates.length
            );
          }

          if (_v300_candidates.length > 0) {
            // W121ZOD106A_CACHE_CANDIDATE_COVERAGE
            // One OD cache-check request can cover 50 candidates. The
            // former first-12 shortcut hid later compact alternatives.
            // Explicit selections and non-OD requests keep their pool.
            const _v300_hashes =
              _v300_candidates.slice(0,
                !preserveSelectedStream && (type === 'movie' || type === 'series')
                  ? 50 : 12
              ).map((c) => c.hash);

            // W121ZOD108H4BD_BACKGROUND_CACHE_AUTHORITY
            // Details already performs PM cache discovery and V291 prewarm before
            // Play. Do not restart an unbounded cache-check across the same pool.
            const _v300_cached = new Set<string>();
            let _v108h4bdKnownCacheStates = 0;

            for (const _v108h4bdHash of _v300_hashes) {
              if (_v296_cacheMap.has(_v108h4bdHash)) {
                _v108h4bdKnownCacheStates++;
                if (_v296_cacheMap.get(_v108h4bdHash)) {
                  _v300_cached.add(_v108h4bdHash);
                }
              }
            }

            // W121ZOD108H4BDB_RESOLVED_PREWARM_ONLY
            // "Prewarm started" is not enough. api.stream.getVideoUrl()
            // returns a URL only after the identity-aware PM resolver has
            // completed and placed the absolute URL in _pmResolved.
            const _v108h4bdPrewarmedHash =
              String(prewarmedRef.current || '').trim().toLowerCase();

            const _v108h4bdbSeason =
              episodeSeason != null &&
              Number.isFinite(Number(episodeSeason))
                ? Number(episodeSeason)
                : undefined;

            const _v108h4bdbEpisode =
              episodeNumber != null &&
              Number.isFinite(Number(episodeNumber))
                ? Number(episodeNumber)
                : undefined;

            const _v108h4bdbPrewarmedUrl =
              _v108h4bdPrewarmedHash &&
              _v300_hashes.includes(_v108h4bdPrewarmedHash)
                ? api.stream.getVideoUrl(
                    _v108h4bdPrewarmedHash,
                    undefined,
                    undefined,
                    _v108h4bdbSeason,
                    _v108h4bdbEpisode
                  )
                : '';

            if (_v108h4bdbPrewarmedUrl) {
              _v300_cached.add(_v108h4bdPrewarmedHash);

              console.log(
                '[W121ZOD108H4BDB PREWARM READY]',
                'hash=' + _v108h4bdPrewarmedHash.slice(0, 12)
              );
            } else if (_v108h4bdPrewarmedHash) {
              console.log(
                '[W121ZOD108H4BDB PREWARM PENDING]',
                'hash=' + _v108h4bdPrewarmedHash.slice(0, 12)
              );
            }

            console.log(
              '[W121ZOD108H4BD CACHE MAP FAST PATH]',
              'known=' + _v108h4bdKnownCacheStates,
              'cached=' + _v300_cached.size,
              'total=' + _v300_hashes.length
            );

            if (_v300_cached.size === 0 && _v300_hashes.length > 0) {
              // Background work may still be finishing when the user presses Play.
              // Give fresh cache discovery only a short latency budget instead of
              // allowing premiumizeCacheCheck() to consume its full 12-second timeout.
              const _v108h4bdCheckHashes =
                _v300_hashes.slice(0, 12);

              try {
                const _v108h4bdBackend =
                  await Promise.race<any[]>([
                    premiumizeCacheCheck(_v108h4bdCheckHashes),
                    new Promise<any[]>((_, reject) =>
                      setTimeout(
                        () => reject(new Error('H4BD_CACHE_CHECK_BUDGET')),
                        1200
                      )
                    ),
                  ]);

                for (
                  let _i = 0;
                  _i < _v108h4bdCheckHashes.length &&
                  _i < _v108h4bdBackend.length;
                  _i++
                ) {
                  const _hash = _v108h4bdCheckHashes[_i];
                  const _isCached = !!_v108h4bdBackend[_i];

                  _v296_cacheMap.set(_hash, _isCached);

                  if (_isCached) {
                    _v300_cached.add(_hash);
                  }
                }

                console.log(
                  '[W121ZOD108H4BD BOUNDED CACHE REFRESH]',
                  'cached=' + _v300_cached.size
                );
              } catch (_v108h4bdCacheError) {
                console.log(
                  '[W121ZOD108H4BD BOUNDED CACHE REFRESH]',
                  'result=budget-or-error',
                  String(
                    (_v108h4bdCacheError as any)?.message ||
                    _v108h4bdCacheError
                  )
                );
              }
            }

            // Pick the best cached candidate (first in the pre-sorted list
            // that is cached).  Skip watermarked entries unless they are
            // the ONLY cached option (so user always gets playback).
            // V766V3_DETAILS_BAD_HASH_FILTER
            let _v766v3BadHashes = new Set<string>();
            try {
              const _rawBad = await AsyncStorage.getItem('v766m_eac3_bad_hashes_v1');
              const _parsedBad = _rawBad ? JSON.parse(_rawBad) : [];
              if (Array.isArray(_parsedBad)) {
                _v766v3BadHashes = new Set(_parsedBad.map((h: any) => String(h).trim().toLowerCase()));
              }
            } catch (_) {}
            const _v300_cachedCandidates = _v300_candidates.filter((c) =>
              _v300_cached.has(c.hash) && !_v766v3BadHashes.has(c.hash)
            );

            let _v769PmSeekHealth: Record<string, any> = {};

            try {
              const _v769PmRaw =
                await AsyncStorage.getItem(
                  'v769_seek_health_v1'
                );

              const _v769PmParsed =
                _v769PmRaw
                  ? JSON.parse(_v769PmRaw)
                  : {};

              if (
                _v769PmParsed &&
                typeof _v769PmParsed === 'object' &&
                !Array.isArray(_v769PmParsed)
              ) {
                _v769PmSeekHealth =
                  _v769PmParsed;
              }
            } catch (_) {}

            const _v300_seekEligibleCached =
              (preserveSelectedStream || (type !== 'movie' && type !== 'series'))
                ? _v300_cachedCandidates
                : _v300_cachedCandidates.filter(
                    c => {
                      const h =
                        _v769PmSeekHealth[
                          c.hash
                        ];

                      // W121ZOD115N2_DEVICE_FAILURE_AUTHORITY
                      // Do not re-select a source this device has already
                      // proved unable to start under the current policy.
                      const _v104j27PlaybackFailActive =
                        _w121zod106gPlaybackBadForSelection(h);

                      return !(
                        h?.ff === 'fail' ||
                        h?.rw === 'fail' ||
                        _v104j27PlaybackFailActive
                      );
                    }
                  );

            if (type === 'movie' || type === 'series') {
              console.log('[W121ZOD105ZX OD HEALTH RESTORED]', 'cached=' + _v300_cachedCandidates.length, 'eligible=' + _v300_seekEligibleCached.length);
            }

            console.log(
              '[V769 PM SEEK FILTER]',
              'manual=' +
                String(
                  preserveSelectedStream
                ),
              'cached=' +
                _v300_cachedCandidates.length,
              'seekEligible=' +
                _v300_seekEligibleCached.length
            );

            console.log('[V766V3 DETAILS FILTER]', 'bad=' + _v766v3BadHashes.size, 'cachedAfter=' + _v300_cachedCandidates.length);
            const _v300_isWm = (s: any) => {
              const _b = `${s?.title || ''} ${s?.name || ''} ${s?.filename || ''}`;
              return /(1xbet|melbet|mostbet|parimatch|ftcam|fxgg|hcam|ctcam|cam\.rip|hdcam|telesync|tsrip|tcrip|tc-?rip|cam-rip|new\.?source|sourceqr|sourcetv|x-?cam|hd-?cam)/i.test(_b);
            };
            const _v300_cleanCached = _v300_seekEligibleCached.filter((c) => !_v300_isWm(c.stream));

            /*
             * V665C_PM_CACHE_POLICY_PARITY
             *
             * V300 must not replace the device-aware automatic selection
             * with the first arbitrary cached sibling. Restrict to cached
             * candidates first, preserve the existing watermark fallback,
             * then apply the same V503/V665 policy used by normal Play.
             */
            const _v665cCachedPool =
              _v300_cleanCached.length > 0
                ? _v300_cleanCached
                : _v300_seekEligibleCached;

            const _v665cPolicyStream =
              _v503PickReliableAutoStream(
                _v665cCachedPool.map((c) => c.stream),
                type === 'movie' || type === 'series'
              );

            const _v300_picked =
              (_v665cPolicyStream
                ? _v665cCachedPool.find(
                    (c) => c.stream === _v665cPolicyStream
                  )
                : null) ||
              _v665cCachedPool[0];

            try {
              console.log(
                '[V665C PM POLICY]',
                'cached=' + _v300_cachedCandidates.length,
                'cleanCached=' + _v300_cleanCached.length,
                'picked=' + String(_v300_picked?.hash || '').slice(0, 12)
              );
            } catch (_) {}
            if (_v300_picked) {
              // W121ZOD108H4BM_VALIDATION_REQUIRED
              // Resolver completion is useful prewarm state, but it is not
              // playback proof. Every automatic OD candidate must still pass
              // the existing actual-media compatibility and H4AL delivery
              // readiness gates before Player receives it.
              const _v108h4bmResolvedUrl =
                _w121zod108e1AutoOd
                  ? api.stream.getVideoUrl(
                      _v300_picked.hash,
                      _v300_picked?.stream?.fileIdx,
                      undefined,
                      _v108h4bdbSeason,
                      _v108h4bdbEpisode
                    )
                  : '';

              console.log(
                '[W121ZOD108H4BM VALIDATION REQUIRED]',
                'hash=' + _v300_picked.hash.slice(0, 12),
                'resolverReady=' + String(!!_v108h4bmResolvedUrl)
              );

              // Always continue through directdl + authenticated media preflight
              // + H4AL seek-readiness, even when the resolver is already complete.
              try {
                const _v300_ctrl2 = new AbortController();
                const _v300_to2 = setTimeout(() => _v300_ctrl2.abort(), 15000);
                const _w121zod110yPreparedEntry =
                  _w121zod110yPrepCacheRef.current.get(
                    _w121zod110yPrepContextKey +
                    '|' +
                    _v300_picked.hash
                  ) || null;

                // W121ZOD110YR1_JOIN_INFLIGHT_PREP
                // If Details is already validating this exact hash,
                // do not launch duplicate directDL/probe/readiness work.
                const _w121zod110yJoinedInflight =
                  !!(
                    _w121zod110yPreparedEntry?.running &&
                    _w121zod110yPreparedEntry?.promise
                  );

                if (_w121zod110yJoinedInflight) {
                  console.log(
                    '[W121ZOD110Y PREPARED WAIT]',
                    'hash=' +
                      _v300_picked.hash.slice(0, 12),
                    'action=join-inflight'
                  );

                  try {
                    await _w121zod110yPreparedEntry.promise;
                  } catch (_) {}
                }

                // W121ZOD110YR2_PREP_FRESHNESS
                // DirectDL and media-probe preparation are reusable
                // only for a short Details-to-Play window.
                const _w121zod110yDirectDlAgeMs =
                  Math.max(
                    0,
                    Date.now() -
                      Number(
                        _w121zod110yPreparedEntry
                          ?.directDlAtMs ||
                        0
                      )
                  );

                const _w121zod110yReuseDirectDl =
                  Array.isArray(
                    _w121zod110yPreparedEntry?.directDlContent
                  ) &&
                  _w121zod110yPreparedEntry
                    .directDlContent.length > 0 &&
                  Number(
                    _w121zod110yPreparedEntry
                      ?.directDlAtMs ||
                    0
                  ) > 0 &&
                  _w121zod110yDirectDlAgeMs <= 30000;

                console.log(
                  '[W121ZOD110Y PREPARED REUSE]',
                  'stage=directdl',
                  'hash=' +
                    _v300_picked.hash.slice(0, 12),
                  'hit=' +
                    String(
                      _w121zod110yReuseDirectDl
                    ),
                  'ageMs=' +
                    String(
                      _w121zod110yDirectDlAgeMs
                    )
                );

                const _v300_backend2 =
                  _w121zod110yReuseDirectDl
                    ? _w121zod110yPreparedEntry
                        .directDlContent
                    : await premiumizeDirectDL(
                        `magnet:?xt=urn:btih:${_v300_picked.hash}`
                      );
                clearTimeout(_v300_to2);
                const _v300_j2: any = { status: 'success', content: _v300_backend2 };
                if (_v300_j2 && _v300_j2.status === 'success' && Array.isArray(_v300_j2.content) && _v300_j2.content.length > 0) {
                  const _v300_videoExt = /\.(mkv|mp4|avi|mov|m4v|ts|m2ts|webm)$/i;
                  let _v300_videos: any[] = _v300_j2.content.filter((c: any) => c && c.link && _v300_videoExt.test(c.path || c.link || ''));
                  _v300_videos = _v300_videos.filter(
                    (v: any) => !_v672IsSampleLikeMedia(v.path || v.link)
                  );
                  if (_v300_videos.length === 0) {
                    console.warn(
                      '[V672] V300 rejected PM result: no non-sample video files',
                      _v300_picked.hash.slice(0, 12)
                    );
                  }
                  // S/E match for series
                  const _v300_idParts = ((id as string) || '').split(':');
                  const _v300_sn = _v300_idParts.length >= 3 ? parseInt(_v300_idParts[_v300_idParts.length - 2], 10) : NaN;
                  const _v300_en = _v300_idParts.length >= 3 ? parseInt(_v300_idParts[_v300_idParts.length - 1], 10) : NaN;
                  let _v300_file: any = null;
                  if (!isNaN(_v300_sn) && !isNaN(_v300_en)) {
                    const _v300_sePad = `S${String(_v300_sn).padStart(2,'0')}E${String(_v300_en).padStart(2,'0')}`;
                    const _v300_seAlt = `${_v300_sn}x${String(_v300_en).padStart(2,'0')}`;
                    _v300_file = _v300_videos.find((v: any) => {
                      const _v672Name = _v672MediaBasename(v.path || v.link);
                      return (
                        _v672Name.toUpperCase().includes(_v300_sePad) ||
                        _v672Name.toLowerCase().includes(_v300_seAlt.toLowerCase())
                      );
                    });
                  }
                  if (!_v300_file) {
                    // V441_MOVIE_TITLE_MATCH_PACK_GUARD
                    const _v441_mt = ((content as any)?.name || (content as any)?.title || (paramName as any) || '') as string;
                    const _v441_my = ((content as any)?.releaseInfo || (content as any)?.year || (content as any)?.releaseYear || '') as any;
                    _v300_file = _v441_pickMovieFile(_v300_videos, _v441_mt, _v441_my);

                    if (
                      !_v300_file &&
                      _v783pTrustedAdultNativeStream(
                        id,
                        content,
                        _v300_picked?.stream
                      ) &&
                      _v300_videos.length === 1
                    ) {
                      _v300_file = _v300_videos[0];

                      console.log(
                        '[V747 PT NATIVE] V300 single-file authoritative torrent accepted',
                        String(
                          _v300_file?.path ||
                          _v300_file?.name ||
                          ''
                        ).slice(0, 120)
                      );
                    }

                    if (!_v300_file) {
                      console.log('[v300/V441] pack refused - no title match; falling through');
                    }
                  }
                  const _v744V300Title = String(
                    (content as any)?.name ||
                    (content as any)?.title ||
                    (paramName as any) ||
                    ''
                  );

                  const _v744V300Identity = String(
                    _v300_file?.path ||
                    _v300_file?.name ||
                    _v300_file?.link ||
                    ''
                  );

                  const _v744V300Ok =
                    type === 'movie'
                      ? _v747MovieIdentityMatches(
                          id,
                          content,
                          _v300_picked?.stream,
                          _v744V300Title,
                          _v745IdentityYear,
                          _v744V300Identity
                        )
                      : type === 'series'
                        ? _v745EpisodeIdentityMatches(
                            _v745IdentityTitle,
                            episodeSeason,
                            episodeNumber,
                            _v744V300Identity
                          )
                        : true;

                  if (
                    _v300_file &&
                    _v300_file.link &&
                    type === 'movie' &&
                    !_v744V300Ok
                  ) {
                    console.warn(
                      '[V744 TITLE GUARD] rejected V300 PM movie file',
                      _v744V300Identity.slice(0, 140)
                    );
                  }

                  if (_v300_file && _v300_file.link && _v744V300Ok) {
                    console.log('[v300] PM SUCCESS via', _v300_picked.hash.slice(0,12), 'â†’', String(_v300_file.link).slice(0,80));

                    if (_w121zod108e1AutoOd) {
                      const _v108e1Path = String(
                        _v300_file?.path || ''
                      ).trim();

                      if (!_v108e1Path) {
                        await _w121zod108e1TryNextAutoCandidate(
                          _v300_picked.hash,
                          'media-path-missing',
                          _v665cCachedPool.map((c) => c.stream)
                        );
                        return;
                      }

                      try {
                        const _w121zod110yProbeAgeMs =
                          Math.max(
                            0,
                            Date.now() -
                              Number(
                                _w121zod110yPreparedEntry
                                  ?.probeAtMs ||
                                0
                              )
                          );

                        const _w121zod110yReuseProbe =
                          !!_w121zod110yPreparedEntry?.probe &&
                          Number(
                            _w121zod110yPreparedEntry
                              ?.probeAtMs ||
                            0
                          ) > 0 &&
                          _w121zod110yProbeAgeMs <= 30000 &&
                          String(
                            _w121zod110yPreparedEntry
                              ?.mediaPath ||
                            ''
                          ) === _v108e1Path;

                        console.log(
                          '[W121ZOD110Y PREPARED REUSE]',
                          'stage=media-probe',
                          'hash=' +
                            _v300_picked.hash.slice(0, 12),
                          'hit=' +
                            String(
                              _w121zod110yReuseProbe
                            ),
                          'ageMs=' +
                            String(
                              _w121zod110yProbeAgeMs
                            )
                        );

                        const _v108e1Probe =
                          _w121zod110yReuseProbe
                            ? _w121zod110yPreparedEntry.probe
                            : await premiumizeMediaProbe(
                                `magnet:?xt=urn:btih:${_v300_picked.hash}`,
                                _v108e1Path
                              );

                        const _v108e1Decision =
                          _w121zod108e1ActualAudioDecision(
                            _v108e1Probe
                          );

                        console.log(
                          '[W121ZOD108E1 ACTUAL MEDIA PREFLIGHT]',
                          'hash=' + _v300_picked.hash.slice(0, 12),
                          'codec=' + (_v108e1Decision.codec || 'none'),
                          'video=' + (_v108e1Decision.videoCodec || 'none'),
                          'ok=' + String(_v108e1Decision.ok),
                          'reason=' + _v108e1Decision.reason
                        );

                        if (!_v108e1Decision.ok) {
                          await _w121zod108e1TryNextAutoCandidate(
                            _v300_picked.hash,
                            _v108e1Decision.reason,
                            _v665cCachedPool.map((c) => c.stream)
                          );
                          return;
                        }

                        // W121ZOD108H4D_PRIMARY_RANDOM_ACCESS_READINESS_V300
                        // W121ZOD110YR2_READINESS_FRESHNESS
                        //
                        // A Details-time PASS can be reused only briefly.
                        // A stale negative/advisory result is never reused.
                        // The only negative result that can be reused is
                        // one that completed while Play was actively
                        // joined to this exact in-flight preparation.
                        const _w121zod110yReadinessAgeMs =
                          Math.max(
                            0,
                            Date.now() -
                              Number(
                                _w121zod110yPreparedEntry
                                  ?.readinessAtMs ||
                                0
                              )
                          );

                        const _w121zod110yPositiveFresh =
                          _w121zod110yPreparedEntry
                            ?.readiness?.ok === true &&
                          Number(
                            _w121zod110yPreparedEntry
                              ?.readinessAtMs ||
                            0
                          ) > 0 &&
                          _w121zod110yReadinessAgeMs <= 120000; // W121ZOD118A_PREPARED_PASS_FRESHNESS

                        const _w121zod110yJoinedCurrent =
                          _w121zod110yJoinedInflight &&
                          !!_w121zod110yPreparedEntry
                            ?.readiness &&
                          Number(
                            _w121zod110yPreparedEntry
                              ?.readinessAtMs ||
                            0
                          ) > 0 &&
                          _w121zod110yReadinessAgeMs <= 2000;

                        const _w121zod110yReuseReadiness =
                          (
                            _w121zod110yPositiveFresh ||
                            _w121zod110yJoinedCurrent
                          ) &&
                          !!_w121zod110yPreparedEntry
                            ?.probe &&
                          String(
                            _w121zod110yPreparedEntry
                              ?.mediaPath ||
                            ''
                          ) === _v108e1Path &&
                          String(
                            _w121zod110yPreparedEntry
                              ?.probe?.link ||
                            ''
                          ) ===
                            String(
                              _v108e1Probe?.link ||
                              ''
                            );

                        console.log(
                          '[W121ZOD110Y PREPARED REUSE]',
                          'stage=readiness',
                          'hash=' +
                            _v300_picked.hash.slice(0, 12),
                          'hit=' +
                            String(
                              _w121zod110yReuseReadiness
                            ),
                          'ageMs=' +
                            String(
                              _w121zod110yReadinessAgeMs
                            ),
                          'joined=' +
                            String(
                              _w121zod110yJoinedInflight
                            ),
                          'positiveFresh=' +
                            String(
                              _w121zod110yPositiveFresh
                            ),
                          'joinedCurrent=' +
                            String(
                              _w121zod110yJoinedCurrent
                            )
                        );

                        const _v108h4dReadiness =
                          _w121zod110yReuseReadiness
                            ? _w121zod110yPreparedEntry
                                .readiness
                            : await premiumizeSeekReadinessProbe(
                                _v108e1Probe.link,
                                _v108e1Probe.format?.bit_rate,
                                _v108e1Probe.format?.duration,
                                _v108e1Probe.size
                              );

                        console.log(
                          '[W121ZOD108H4D PRIMARY READINESS]',
                          'path=V300',
                          'hash=' + _v300_picked.hash.slice(0, 12),
                          'mediaMbps=' + _v108h4dReadiness.mediaMbps.toFixed(2),
                          'samples=' +
                            _v108h4dReadiness.sampleMbps
                              .map((v) => v.toFixed(2))
                              .join(','),
                          'minRatio=' + _v108h4dReadiness.minRatio.toFixed(2),
                          'ok=' + String(_v108h4dReadiness.ok),
                          'reason=' + _v108h4dReadiness.reason
                        );

                        if (!_v108h4dReadiness.ok) {
                          if (_v108h4dReadiness.reason === 'seek-readiness-low-headroom') {
                            // W121ZOD110D_LOW_HEADROOM_REJECT_V300
                            console.warn(
                              '[W121ZOD110D LOW HEADROOM REJECT]',
                              'path=V300',
                              'hash=' + _v300_picked.hash.slice(0, 12),
                              'minRatio=' + _v108h4dReadiness.minRatio.toFixed(2),
                              'action=next-compatible-candidate'
                            );

                            await _w121zod108e1TryNextAutoCandidate(
                              _v300_picked.hash,
                              _v108h4dReadiness.reason ||
                                'seek-readiness-failed',
                              streams || []
                            );

                            return;

                            await _w121zod108e1TryNextAutoCandidate(
                              _v300_picked.hash,
                              'seek-readiness-low-headroom',
                              streams || []
                            );

                            return;
                          }

                          // W121ZOD108H4AY_INDETERMINATE_READINESS_ADVISORY_V300
                          // A probe error is not proof that compatible media cannot play.
                          console.warn(
                            '[W121ZOD118A READINESS REJECT]',
                            'path=V300',
                            'hash=' + _v300_picked.hash.slice(0, 12),
                            'reason=' + _v108h4dReadiness.reason,
                            'action=next-compatible-candidate'
                          );
                        }

                        if (_v108e1Probe.link) {
                          _v300_file = {
                            ..._v300_file,
                            link: _v108e1Probe.link,
                          };
                        }
                      } catch (_v108e1ProbeError) {
                        console.warn(
                          '[W121ZOD108E1 ACTUAL MEDIA PREFLIGHT]',
                          'hash=' + _v300_picked.hash.slice(0, 12),
                          'ok=false',
                          'reason=probe-error',
                          String(
                            (_v108e1ProbeError as any)?.message ||
                            _v108e1ProbeError
                          )
                        );

                        await _w121zod108e1TryNextAutoCandidate(
                          _v300_picked.hash,
                          'probe-error',
                          _v665cCachedPool.map((c) => c.stream)
                        );
                        return;
                      }
                    }

                    const _v759V300PlaybackUrl =
                      await _v759MaybeCreateAdultTranscodeUrl(
                        id,
                        content,
                        _v300_picked?.stream,
                        _v300_file
                      );

                    // W121ZOD108H4W_FINAL_SELECTED_SOURCE_DIAGNOSTIC
                    try {
                      const _w121zod108h4wInfo: any =
                        parseStreamInfo(_v300_picked?.stream);

                      const _w121zod108h4wHost =
                        String(_v759V300PlaybackUrl || '')
                          .replace(/^https?:\/\//i, '')
                          .split('/')[0];

                      console.log(
                        '[W121ZOD108H4W FINAL SOURCE]',
                        'path=V300',
                        'hash=' + String(_v300_picked?.hash || ''),
                        'pmFile=' + String(
                          _v300_file?.path ||
                          _v300_file?.name ||
                          ''
                        ),
                        'filename=' + String(
                          _v300_picked?.stream?.filename || ''
                        ),
                        'title=' + String(
                          _v300_picked?.stream?.title || ''
                        ),
                        'name=' + String(
                          _v300_picked?.stream?.name || ''
                        ),
                        'quality=' + String(
                          _w121zod108h4wInfo?.quality || ''
                        ),
                        'host=' + _w121zod108h4wHost
                      );
                    } catch (_) {}
                    const _v655_tor_v300 = buildRuntimeCodecFallbackTorrents(_v300_picked.hash);
                    const _v353_fb_v300 = _v655_tor_v300.length > 0 ? [] : await buildFallbackUrls();
                    console.log(
                      '[W121ZOD108H1 RUNTIME FALLBACKS]',
                      'path=V300',
                      'primary=' + _v300_picked.hash.slice(0, 12),
                      'torrentFallbacks=' + String(_v655_tor_v300.length),
                      'urlFallbacks=' + String(_v353_fb_v300.length)
                    );

                    router.push({
                      pathname: '/player',
                      params: {
                        directUrl: _v237_bustUrl(_v759V300PlaybackUrl),
                        infoHash: _v300_picked.hash,
                        title: contentTitle,
                        isLive: 'false',
                        contentType: cType,
                        contentId: subtitleContentId,
                        identityTitle: _v745IdentityTitle,
                        identityYear: _v745IdentityYear,
                        fallbackStreams: _v655_tor_v300.length > 0 ? '[]' : JSON.stringify(_v353_fb_v300),
                        fallbackTorrents: _v655_tor_v300.length > 0 ? JSON.stringify(_v655_tor_v300) : '',
                        backdrop: _v384OverlayUri, ..._v384Pass, /* V384 */
                        poster: content?.poster || '',
                        logo: content?.logo || '',
                        ...currentEpisodeMeta,
                        ...nextEpisodeData,
                        ...resumeData,
                      },
                    });
                    return;
                  }
                  console.log('[v300] directdl succeeded but no playable file found in content[]');
                } else {
                  console.log('[v300] directdl non-success:', _v300_j2 && _v300_j2.status, _v300_j2 && _v300_j2.message);
                }
              } catch (_v300_e2) {
                console.log('[v300] directdl threw:', String((_v300_e2 as any)?.message || _v300_e2));
              }
            } else {
              console.log('[v300] no PM-cached candidate across', _v300_candidates.length, 'streams â€” title likely not on user PM cache');
            }
          }
        }
      } catch (_v300_outer) {
        console.log('[v300] outer threw:', String((_v300_outer as any)?.message || _v300_outer));
      }
    }
    
    // V299_INLINE_PM_DIRECT_RESOLVE_BUILD_TAG â€” last-resort, no-indirection
    // path to playback.  Skips client.ts short-circuit, backend pre-flight,
    // and player pollRace.  POSTs the magnet directly to PM /transfer/directdl
    // using fetch, picks the best video file, and pushes to /player as
    // directUrl.  expo-video gets an absolute PM CDN URL â€” same one we
    // proved works from the staging server (Big Buck Bunny test).
    // Falls through to the existing branches if PM cannot resolve.
    {
      const _V299_BUILD_TAG = 'V299_INLINE_PM_DIRECT_RESOLVE_BUILD_TAG';
      void _V299_BUILD_TAG;
      try {
        // W121ZOD9B_NO_PM_STATUS_PREFLIGHT_V299
        const _v299_pm = true;
        const _v299_streamHash = String(
          stream.infoHash || ''
        ).trim().toLowerCase();
        const _v299KnownBad =
          !!_v299_streamHash &&
          _v767dGetBadHashSet().has(_v299_streamHash);

        if (_v299KnownBad) {
          console.log(
            '[V767D V299 BAD HASH SKIP]',
            _v299_streamHash.slice(0, 12)
          );
        }

        if (_v299_pm && stream.infoHash && !_v299KnownBad) {
          const _v299_hash = _v299_streamHash;
          const _v299_magnet = `magnet:?xt=urn:btih:${_v299_hash}`;
          const _v299_ctrl = new AbortController();
          const _v299_to = setTimeout(() => _v299_ctrl.abort(), 15000);
          let _v299_link: string | null = null;
          let _v299_mediaPath = '';
          try {
            console.log('[v299] inline PM resolve â†’', _v299_hash.slice(0, 12));
            const _v299_backend = await premiumizeDirectDL(_v299_magnet);
            clearTimeout(_v299_to);
            const _v299_j: any = { status: 'success', content: _v299_backend };
            if (_v299_j && _v299_j.status === 'success' && Array.isArray(_v299_j.content) && _v299_j.content.length > 0) {
              const _v299_videoExt = /\.(mkv|mp4|avi|mov|m4v|ts|m2ts|webm)$/i;
              let _v299_videos: any[] = _v299_j.content.filter((c: any) => c && c.link && _v299_videoExt.test(c.path || c.link || ''));
              _v299_videos = _v299_videos.filter(
                (v: any) => !_v672IsSampleLikeMedia(v.path || v.link)
              );
              if (_v299_videos.length === 0) {
                console.warn(
                  '[V672] V299 rejected PM result: no non-sample video files',
                  _v299_hash.slice(0, 12)
                );
              }
              // Match S/E for series
              const _v299_idParts = ((id as string) || '').split(':');
              const _v299_sn = _v299_idParts.length >= 3 ? parseInt(_v299_idParts[_v299_idParts.length - 2], 10) : NaN;
              const _v299_en = _v299_idParts.length >= 3 ? parseInt(_v299_idParts[_v299_idParts.length - 1], 10) : NaN;
              let _v299_picked: any = null;
              if (!isNaN(_v299_sn) && !isNaN(_v299_en)) {
                const _v299_s = String(_v299_sn).padStart(2, '0');
                const _v299_e = String(_v299_en).padStart(2, '0');
                const _v299_seCode = `S${_v299_s}E${_v299_e}`;
                const _v299_seAlt = `${_v299_sn}x${_v299_e}`;
                _v299_picked = _v299_videos.find((v: any) => {
                  const _v672Name = _v672MediaBasename(v.path || v.link);
                  return (
                    _v672Name.toUpperCase().includes(_v299_seCode) ||
                    _v672Name.toLowerCase().includes(_v299_seAlt.toLowerCase())
                  );
                });
              }
              if (!_v299_picked) {
                // V441_MOVIE_TITLE_MATCH_PACK_GUARD
                const _v441_mt2 = ((content as any)?.name || (content as any)?.title || (paramName as any) || '') as string;
                const _v441_my2 = ((content as any)?.releaseInfo || (content as any)?.year || (content as any)?.releaseYear || '') as any;
                _v299_picked = _v441_pickMovieFile(_v299_videos, _v441_mt2, _v441_my2);

                if (
                  !_v299_picked &&
                  _v783pTrustedAdultNativeStream(
                    id,
                    content,
                    stream
                  ) &&
                  _v299_videos.length === 1
                ) {
                  _v299_picked = _v299_videos[0];

                  console.log(
                    '[V747 PT NATIVE] V299 single-file authoritative torrent accepted',
                    String(
                      _v299_picked?.path ||
                      _v299_picked?.name ||
                      ''
                    ).slice(0, 120)
                  );
                }

                if (!_v299_picked) {
                  console.log('[v299/V441] pack refused - no title match; falling through');
                }
              }
              const _v744V299Title = String(
                (content as any)?.name ||
                (content as any)?.title ||
                (paramName as any) ||
                ''
              );

              const _v744V299Identity = String(
                _v299_picked?.path ||
                _v299_picked?.name ||
                _v299_picked?.link ||
                ''
              );

              const _v744V299Ok =
                type === 'movie'
                  ? _v747MovieIdentityMatches(
                      id,
                      content,
                      stream,
                      _v744V299Title,
                      _v745IdentityYear,
                      _v744V299Identity
                    )
                  : type === 'series'
                    ? _v745EpisodeIdentityMatches(
                        _v745IdentityTitle,
                        episodeSeason,
                        episodeNumber,
                        _v744V299Identity
                      )
                    : true;

              if (
                _v299_picked &&
                _v299_picked.link &&
                type === 'movie' &&
                !_v744V299Ok
              ) {
                console.warn(
                  '[V744 TITLE GUARD] rejected V299 PM movie file',
                  _v744V299Identity.slice(0, 140)
                );
              }

              if (_v299_picked && _v299_picked.link && _v744V299Ok) {
                _v299_link = String(_v299_picked.link);
                _v299_mediaPath = String(_v299_picked.path || '').trim();
                console.log('[v299] PM SUCCESS â†’', _v299_link.slice(0, 80));
              } else {
                console.log('[v299] PM success but no playable file in content[]');
              }
            } else {
              console.log('[v299] PM non-success:', _v299_j && _v299_j.status, _v299_j && _v299_j.message);
            }
          } catch (_v299_e) {
            clearTimeout(_v299_to);
            console.log('[v299] PM fetch threw:', String((_v299_e as any)?.message || _v299_e));
          }
          if (_v299_link) {
            if (_w121zod108e1AutoOd) {
              if (!_v299_mediaPath) {
                await _w121zod108e1TryNextAutoCandidate(
                  _v299_hash,
                  'media-path-missing',
                  streams || []
                );
                return;
              }

              try {
                const _v108e1Probe =
                  await premiumizeMediaProbe(
                    _v299_magnet,
                    _v299_mediaPath
                  );

                const _v108e1Decision =
                  _w121zod108e1ActualAudioDecision(
                    _v108e1Probe
                  );

                console.log(
                  '[W121ZOD108E1 ACTUAL MEDIA PREFLIGHT V299]',
                  'hash=' + _v299_hash.slice(0, 12),
                  'codec=' + (_v108e1Decision.codec || 'none'),
                  'video=' + (_v108e1Decision.videoCodec || 'none'),
                  'ok=' + String(_v108e1Decision.ok),
                  'reason=' + _v108e1Decision.reason
                );

                if (!_v108e1Decision.ok) {
                  await _w121zod108e1TryNextAutoCandidate(
                    _v299_hash,
                    _v108e1Decision.reason,
                    streams || []
                  );
                  return;
                }

                // W121ZOD108H4D_PRIMARY_RANDOM_ACCESS_READINESS_V299
                const _v108h4dReadiness =
                  await premiumizeSeekReadinessProbe(
                    _v108e1Probe.link,
                    _v108e1Probe.format?.bit_rate,
                    _v108e1Probe.format?.duration,
                    _v108e1Probe.size
                  );

                console.log(
                  '[W121ZOD108H4D PRIMARY READINESS]',
                  'path=V299',
                  'hash=' + _v299_hash.slice(0, 12),
                  'mediaMbps=' + _v108h4dReadiness.mediaMbps.toFixed(2),
                  'samples=' +
                    _v108h4dReadiness.sampleMbps
                      .map((v) => v.toFixed(2))
                      .join(','),
                  'minRatio=' + _v108h4dReadiness.minRatio.toFixed(2),
                  'ok=' + String(_v108h4dReadiness.ok),
                  'reason=' + _v108h4dReadiness.reason
                );

                if (!_v108h4dReadiness.ok) {
                  if (_v108h4dReadiness.reason === 'seek-readiness-low-headroom') {
                    // W121ZOD110E_LOW_HEADROOM_REJECT_V299
                    //
                    // Keep V299 identical to the authoritative V300 behavior.
                    // A real low-headroom result is delivery-health evidence
                    // against THIS candidate, not proof that the title has no
                    // compatible source.
                    //
                    // Reject only this hash and continue through the compatible
                    // automatic pool. Runtime playback must not be used as the
                    // first test of a source already proven unable to sustain
                    // its advertised media rate during readiness preflight.
                    console.warn(
                      '[W121ZOD110E LOW HEADROOM REJECT]',
                      'path=V299',
                      'hash=' + _v299_hash.slice(0, 12),
                      'minRatio=' + _v108h4dReadiness.minRatio.toFixed(2),
                      'action=next-compatible-candidate'
                    );

                    await _w121zod108e1TryNextAutoCandidate(
                      _v299_hash,
                      'seek-readiness-low-headroom',
                      streams || []
                    );

                    return;
                  }

                  // W121ZOD108H4AY_INDETERMINATE_READINESS_ADVISORY_V299
                  console.warn(
                    '[W121ZOD118A READINESS REJECT]',
                    'path=V299',
                    'hash=' + _v299_hash.slice(0, 12),
                    'reason=' + _v108h4dReadiness.reason,
                    'action=next-compatible-candidate'
                  );

                  await _w121zod108e1TryNextAutoCandidate(
                    _v299_hash,
                    _v108h4dReadiness.reason ||
                      'seek-readiness-failed',
                    streams || []
                  );

                  return;
                }

                if (_v108e1Probe.link) {
                  _v299_link = _v108e1Probe.link;
                }
              } catch (_v108e1ProbeError) {
                console.warn(
                  '[W121ZOD108E1 ACTUAL MEDIA PREFLIGHT V299]',
                  'hash=' + _v299_hash.slice(0, 12),
                  'ok=false',
                  'reason=probe-error',
                  String(
                    (_v108e1ProbeError as any)?.message ||
                    _v108e1ProbeError
                  )
                );

                await _w121zod108e1TryNextAutoCandidate(
                  _v299_hash,
                  'probe-error',
                  streams || []
                );
                return;
              }
            }

            // W121ZOD108H4W_FINAL_SELECTED_SOURCE_DIAGNOSTIC
            try {
              const _w121zod108h4wInfo: any =
                parseStreamInfo(stream);

              const _w121zod108h4wHost =
                String(_v299_link || '')
                  .replace(/^https?:\/\//i, '')
                  .split('/')[0];

              console.log(
                '[W121ZOD108H4W FINAL SOURCE]',
                'path=V299',
                'hash=' + String(_v299_hash || ''),
                'pmFile=' + String(_v299_mediaPath || ''),
                'filename=' + String(
                  (stream as any)?.filename || ''
                ),
                'title=' + String(
                  (stream as any)?.title || ''
                ),
                'name=' + String(
                  (stream as any)?.name || ''
                ),
                'quality=' + String(
                  _w121zod108h4wInfo?.quality || ''
                ),
                'host=' + _w121zod108h4wHost
              );
            } catch (_) {}
            const _v655_tor_v299 = buildRuntimeCodecFallbackTorrents(_v299_hash);
            const _v353_fb_v299 = _v655_tor_v299.length > 0 ? [] : await buildFallbackUrls();
            console.log(
              '[W121ZOD108H1 RUNTIME FALLBACKS]',
              'path=V299',
              'primary=' + _v299_hash.slice(0, 12),
              'torrentFallbacks=' + String(_v655_tor_v299.length),
              'urlFallbacks=' + String(_v353_fb_v299.length)
            );

            router.push({
              pathname: '/player',
              params: {
                directUrl: _v237_bustUrl(_v299_link),
                infoHash: _v299_hash,
                title: contentTitle,
                isLive: 'false',
                contentType: cType,
                contentId: subtitleContentId,
                identityTitle: _v745IdentityTitle,
                identityYear: _v745IdentityYear,
                fallbackStreams: _v655_tor_v299.length > 0 ? '[]' : JSON.stringify(_v353_fb_v299),
                fallbackTorrents: _v655_tor_v299.length > 0 ? JSON.stringify(_v655_tor_v299) : '',
                backdrop: _v384OverlayUri, ..._v384Pass, /* V384 */
                poster: content?.poster || '',
                logo: content?.logo || '',
                ...currentEpisodeMeta,
                ...nextEpisodeData,
                ...resumeData,
              },
            });
            return;
          }

          if (_w121zod108e1AutoOd) {
            await _w121zod108e1TryNextAutoCandidate(
              _v299_hash,
              'directdl-unresolved',
              streams || []
            );
            return;
          }

          // Manual/non-OD behavior remains unchanged.
          console.log('[v299] falling through to existing branches');
        }

        if (_w121zod108e1AutoOd && stream.infoHash) {
          await _w121zod108e1TryNextAutoCandidate(
            _v299_streamHash,
            _v299KnownBad ? 'known-bad-hash' : 'preflight-unresolved',
            streams || []
          );
          return;
        }
      } catch (_v299_outer) {
        console.log('[v299] outer threw:', String((_v299_outer as any)?.message || _v299_outer));

        if (_w121zod108e1AutoOd) {
          await _w121zod108e1TryNextAutoCandidate(
            String(stream.infoHash || ''),
            'v299-outer-error',
            streams || []
          );
          return;
        }
      }
    }
    
    // Handle external URLs - route them to the internal player
    if (stream.externalUrl || stream.requiresWebView) {
      const streamUrl = stream.externalUrl || stream.url;

      // V727B2B3_REDTUBE_SIGNED_HANDOFF
      //
      // Deliberately not a generic header pass-through.
      // Only the exact backend-proven RedTube object is accepted.
      const _v727b2b3ExternalUrl =
        typeof (stream as any).externalUrl === 'string'
          ? String((stream as any).externalUrl)
          : '';

      const _v727b2b3Url =
        typeof (stream as any).url === 'string'
          ? String((stream as any).url)
          : '';

      const _v727b2b3Addon =
        String((stream as any).addon || '');

      const _v727b2b3Headers =
        (stream as any).headers;

      const _v727b2b3HeaderKeys =
        _v727b2b3Headers &&
        !Array.isArray(_v727b2b3Headers) &&
        typeof _v727b2b3Headers === 'object'
          ? Object.keys(_v727b2b3Headers)
          : [];

      const _v727b2b3Referer =
        _v727b2b3HeaderKeys.length === 1 &&
        _v727b2b3HeaderKeys[0] === 'Referer' &&
        typeof _v727b2b3Headers.Referer === 'string'
          ? _v727b2b3Headers.Referer.trim()
          : '';

      const _v727b2b3ContentMatch =
        /^porn_id:RedTube-movie-([0-9]+)$/.exec(
          String(subtitleContentId || '')
        );

      const _v727b2b3RefererMatch =
        /^https:\/\/www\.redtube\.com\/([0-9]+)$/.exec(
          _v727b2b3Referer
        );

      const _v727b2b3CdnOk =
        /^https:\/\/ev\.phncdn\.com\/[^?#]+\.mp4\?[^#]+$/i.test(
          _v727b2b3ExternalUrl
        );

      const _v727b2b3TrustedRedTube =
        _v727b2b3Addon === 'RedTube' &&
        _v727b2b3ExternalUrl.length > 0 &&
        _v727b2b3ExternalUrl === _v727b2b3Url &&
        _v727b2b3ExternalUrl === streamUrl &&
        _v727b2b3CdnOk &&
        !!_v727b2b3ContentMatch &&
        !!_v727b2b3RefererMatch &&
        _v727b2b3ContentMatch![1] ===
          _v727b2b3RefererMatch![1];

      const _v727b2b3RequestHeaders =
        _v727b2b3TrustedRedTube
          ? JSON.stringify({
              Referer: _v727b2b3Referer,
            })
          : undefined;

      /* PATCH_V154_LOG_PLAY â€” content mismatch trace at play time */
      try {
        const _v154Req2 = (((content as any)?.name || (content as any)?.title || (name as any) || '') as string);
        const _v154Pick2 = ((stream.title || stream.name || '') as string);
        const _v154Hits2 = _v154TitleOverlap(_v154Req2, _v154Pick2);
        console.log('[MATCH v154 PLAY]', _v154Hits2 === 0 ? 'WARNING-NO-OVERLAP' : 'ok-overlap=' + _v154Hits2, '| requested=', _v154Req2.slice(0,60), '| picked=', _v154Pick2.slice(0,80), '| hash=', (stream.infoHash || '').slice(0,8), 'fileIdx=', (stream as any).fileIdx ?? null, '| url=', (streamUrl || '').slice(0,80));
      } catch (_) {}
      console.log('[DETAILS] Playing external URL in internal player:', streamUrl);
      router.push({
        pathname: '/player',
        params: { 
          // V727B2B3_REDTUBE_SIGNED_HANDOFF
          // Signed CDN URL stays byte-for-byte unchanged only when trusted.
          directUrl: _v727b2b3TrustedRedTube
            ? streamUrl
            : _v237_bustUrl(streamUrl),

          ...(_v727b2b3RequestHeaders
            ? {
                requestHeaders: _v727b2b3RequestHeaders,
              }
            : {}),

          title: contentTitle,
          isLive: 'false',
          contentType: cType,
          contentId: subtitleContentId,
          backdrop: _v384OverlayUri, ..._v384Pass, /* V384 */
          poster: content?.poster || '',
          logo: content?.logo || '',
          ...currentEpisodeMeta,
          ...nextEpisodeData,
          ...resumeData,
        },
      });
      return;
    }
    
    if (stream.url && stream.url.startsWith('/api/proxy/')) {
      const authToken = await AsyncStorage.getItem('auth_token');
      const separator = stream.url.includes('?') ? '&' : '?';
      const tokenParam = authToken ? `${separator}token=${encodeURIComponent(authToken)}` : '';
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || Constants.expoConfig?.extra?.backendUrl || '';
      const absoluteUrl = `${backendUrl}${stream.url}${tokenParam}`;
      
      // Build fallback URLs - include other proxy streams + direct URLs
      const fallbacks = await buildFallbackUrls();
      
      // Also include direct URLs from USAATV streams as fallbacks
      const directFallbacks = streams
        .filter(s => s !== stream && (s.directUrl || (s.url && !s.url.startsWith('/api/proxy/'))))
        .map(s => s.directUrl || s.url)
        .filter(Boolean);
      
      router.push({
        pathname: '/player',
        params: { 
          directUrl: _v237_bustUrl(absoluteUrl),
          title: contentTitle,
          isLive: type === 'tv' ? 'true' : 'false',
          contentType: cType,
          contentId: subtitleContentId,
          fallbackStreams: JSON.stringify([absoluteUrl, ...fallbacks, ...directFallbacks]),
          backdrop: _v384OverlayUri, ..._v384Pass, /* V384 */
          poster: content?.poster || '',
          logo: content?.logo || '',
          ...currentEpisodeMeta,
          ...nextEpisodeData,
          ...resumeData,
        },
      });
      return;
    }
    
    if (stream.infoHash) {
      const _v744PrimaryTitle = String(
        (content as any)?.name ||
        (content as any)?.title ||
        (paramName as any) ||
        ''
      );

      const _v744PrimaryIdentity = String(
        stream.title ||
        stream.filename ||
        stream.name ||
        ''
      );

      if (
        type === 'movie' &&
        !_v747MovieIdentityMatches(
          id,
          content,
          stream,
          _v744PrimaryTitle,
          _v745IdentityYear,
          _v744PrimaryIdentity
        )
      ) {
        console.warn(
          '[V744 TITLE GUARD] rejected primary movie torrent',
          _v744PrimaryIdentity.slice(0, 140)
        );

        setIsPlayLoading(false);

        // W121ZOD118H1_NO_TECHNICAL_POPUP
        // Keep the identity guard, but do not expose internal diagnostics.
        return;
      }

      // Build fallback torrents from other available torrent streams (sorted by seeders)
      // V162_WIDER_FALLBACKS â€” bumped from 5 to 15 so we always have a working
      // option even when the top picks share the same codec / lossless-audio
      // incompatibility that the device can't decode.
      /* V355_HEALTHY_TORRENT_FALLBACKS â€” This is the REAL playback fallback
         path for Torrentio streams (with infoHash). Auto-play tries top
         stream first; if that fails, player cascades through this list.
         The old list was capped at 20 AND not sorted by seeders, so if the
         top torrent had bad peers, the "next" was also usually a bad-peer
         torrent. Fix: filter to healthy seeders (>=10 first, then any),
         sort by seeders DESC, widen to 60. */
      const _v355_seed = (s: any): number => {
        try {
          const raw = s?.seeders ?? s?.seed ?? s?.seeds ?? 0;
          const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
          return isFinite(n) ? n : 0;
        } catch { return 0; }
      };
      const _v744FallbackTitle = String(
        (content as any)?.name ||
        (content as any)?.title ||
        (paramName as any) ||
        ''
      );

      const _v355_others = streams.filter((s: any) => {
        if (!s.infoHash || s.infoHash === stream.infoHash) return false;

        if (
          type === 'movie' &&
          _v744FallbackTitle &&
          !_v747MovieIdentityMatches(
            id,
            content,
            s,
            _v744FallbackTitle,
            _v745IdentityYear,
            String(s?.title || s?.filename || s?.name || '')
          )
        ) {
          console.warn(
            '[V744 TITLE GUARD] rejected torrent fallback',
            String(s?.title || s?.filename || s?.name || '').slice(0, 120)
          );
          return false;
        }

        return true;
      });
      const _v355_sorted = [..._v355_others].sort((a, b) => _v355_seed(b) - _v355_seed(a));
      const _v355_healthy = _v355_sorted.filter(s => _v355_seed(s) >= 10);
      const _v355_unhealthy = _v355_sorted.filter(s => _v355_seed(s) < 10);
      const fallbackTorrents = [..._v355_healthy, ..._v355_unhealthy]
        .slice(0, 60)
        .map(s => ({
          infoHash: s.infoHash,
          fileIdx: s.fileIdx,
          filename: s.filename || '',
          sources: s.sources || [],
          name: s.name || '',
          title: s.title || '',
        }));
      console.log('[V355] torrent fallbacks: healthy=' + _v355_healthy.length + ' unhealthy=' + _v355_unhealthy.length + ' total=' + fallbackTorrents.length);
      
      // Extract season/episode from content ID (e.g. tt123:1:2 â†’ season=1, episode=2)
      const idParts = (id || '').split(':');
      const seasonNum = idParts.length >= 3 ? idParts[idParts.length - 2] : '';
      const episodeNum = idParts.length >= 3 ? idParts[idParts.length - 1] : '';
      
      router.push({
        pathname: '/player',
        params: { 
          infoHash: stream.infoHash,
          title: contentTitle,
          contentType: cType,
          contentId: subtitleContentId,
          identityTitle: _v745IdentityTitle,
          identityYear: _v745IdentityYear,
          fileIdx: stream.fileIdx !== undefined ? String(stream.fileIdx) : '',
          filename: stream.filename || '',
          season: seasonNum,
          episode: episodeNum,
          // v238 cache buster â€” forces Firestick to refetch torrent-video URL
          // even when infoHash hasn't changed (e.g. retrying same stream).
          cacheBust: String(Date.now()),
          // Prefer loaded content metadata, but fall back to carried-over params
          // from the previous episode's player so the loading screen ALWAYS has
          // a backdrop/poster/logo â€” even when navigating fast via auto-play
          // before Cinemeta has populated `content`.
          backdrop: _v384OverlayUri, ..._v384Pass, /* V384 */
          poster: content?.poster || nextPosterParam || '',
          logo: content?.logo || '',
          sources: stream.sources ? JSON.stringify(stream.sources) : '',
          fallbackTorrents: fallbackTorrents.length > 0 ? JSON.stringify(fallbackTorrents) : '',
          ...currentEpisodeMeta,
          ...nextEpisodeData,
          ...resumeData,
        },
      });
    } else if (stream.url) {
      // === PRIVACY PROXY ===
      // Route ALL direct URLs through backend's RD unrestrict proxy
      // so the device NEVER connects to content sites (redtube, etc.)
      // ISP only sees traffic to real-debrid.com
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || Constants.expoConfig?.extra?.backendUrl || '';
      const authToken = await AsyncStorage.getItem('auth_token');

      // V735_ADULT_DIRECT_HTTPS
      // Addon-native adult items such as OnlyPorn use the page URL itself
      // as the Stremio content id. Their addon returns already-resolved
      // HTTPS HLS/media URLs. Send those directly to ExoPlayer instead of
      // routing them through the V725-disabled /api/proxy surface.
      const _v735AdultUrlId =
        /^https?:\/\//i.test(String(id || ''));

      const _v735DirectHttps =
        _v735AdultUrlId &&
        /^https:\/\//i.test(String(stream.url || ''));
      
      // Check if URL is already a backend/proxy URL (no need to re-proxy)
      const isAlreadyProxied = stream.url.startsWith('/api/') || 
                                stream.url.startsWith(backendUrl) ||
                                stream.url.includes('/api/proxy/');
      
      let streamUrl: string;
      if (_v735DirectHttps) {
        streamUrl = stream.url;
        console.log('[V735_ADULT_DIRECT_HTTPS] device-direct primary');
      } else if (isAlreadyProxied) {
        // Already going through our backend â€” use as-is
        streamUrl = stream.url;
      } else {
        // External URL â€” route through RD privacy proxy
        const encodedUrl = encodeURIComponent(stream.url);
        const tokenParam = authToken ? `&token=${encodeURIComponent(authToken)}` : '';
        streamUrl = `${backendUrl}/api/proxy/unrestrict-stream?url=${encodedUrl}${tokenParam}`;
        console.log('[DETAILS] Privacy proxy: routing through RD unrestrict');
      }
      
      // Build fallback URLs â€” also route fallbacks through privacy proxy
      const allStreamUrls = streams
        .filter(s => s.url && !s.infoHash && s.url !== stream.url)
        .map(s => {
          if (!s.url) return '';

          if (
            _v735AdultUrlId &&
            /^https:\/\//i.test(String(s.url))
          ) {
            return s.url;
          }
          const isProxied = s.url.startsWith('/api/') || s.url.startsWith(backendUrl);
          if (isProxied) return s.url;
          const enc = encodeURIComponent(s.url);
          const tp = authToken ? `&token=${encodeURIComponent(authToken)}` : '';
          return `${backendUrl}/api/proxy/unrestrict-stream?url=${enc}${tp}`;
        })
        .filter(Boolean);
      
      // For live TV streams, also include proxy URLs as additional fallbacks
      if (type === 'tv') {
        const proxyFallbacks = streams
          .filter(s => s.proxyUrl)
          .map(s => {
            const tokenParam = authToken ? `&token=${encodeURIComponent(authToken)}` : '';
            return `${backendUrl}${s!.proxyUrl}${tokenParam}`;
          })
          .filter(Boolean);
        
        allStreamUrls.push(...proxyFallbacks);
      }
      
      router.push({
        pathname: '/player',
        params: { 
          directUrl: _v735DirectHttps ? streamUrl : _v237_bustUrl(streamUrl),
          title: contentTitle,
          isLive: type === 'tv' ? 'true' : 'false',
          contentType: cType,
          contentId: subtitleContentId,
          fallbackStreams: allStreamUrls.length > 0 ? JSON.stringify(allStreamUrls) : '',
          backdrop: _v384OverlayUri, ..._v384Pass, /* V384 */
          poster: content?.poster || '',
          logo: content?.logo || '',
          ...currentEpisodeMeta,
          ...nextEpisodeData,
          ...resumeData,
        },
      });
    }
  };

  const handleEpisodePress = (episode: Episode) => {
    const episodeId = `${baseId || id}:${episode.season}:${episode.episode}`;
    router.push({
      pathname: `/details/${type}/${episodeId}`,
    });
  };

  const toggleLibrary = async () => {
    if (!content) return;
    try {
      if (inLibrary) {
        await api.library.remove(type!, content.id);
        setInLibrary(false);
      } else {
        await api.library.add({
          id: content.id,
          imdb_id: content.imdb_id || content.id,
          name: content.name,
          type: type as 'movie' | 'series',
          poster: content.poster,
          year: content.year,
          imdbRating: typeof content.imdbRating === 'string' ? parseFloat(content.imdbRating) : content.imdbRating,
        });
        setInLibrary(true);
      }
      // Refresh library immediately so the Library tab updates in real-time
      fetchLibrary(true);
    } catch (error) {
      console.log('Failed to toggle library:', error);
    }
  };

  // Use content data for display - available immediately from store
  // v238 â€” fall back to params from the caller BEFORE the generic
  // "Loading..." text so the user sees the actual title instantly.
  const displayName = content?.name || (paramName as string) || 'Loading...';
  // For episode pages, prefer the episode thumbnail as backdrop. Otherwise use series backdrop.
  const episodeBackdrop = isEpisodePage && currentEpisode?.thumbnail ? currentEpisode.thumbnail : null;
  // v238 â€” backdrop fallback chain: episode thumb -> backend backdrop ->
  // param backdrop -> param poster (blurred/dark-overlaid is still better
  // than a black screen) -> empty.  Eliminates the black-flash on Details.
  const displayPoster = episodeBackdrop || content?.background || (paramBackground as string) || (paramPoster as string) || '';

  const rating = typeof content?.imdbRating === 'string' 
    ? parseFloat(content.imdbRating) 
    : content?.imdbRating;

  // V708: preserve existing metadata IMDb when valid;
  // use the independently enriched IMDb score only as fallback.
  const v708EnrichedImdbRaw = v707DetailsRatings?.imdb_score;

  const v708EnrichedImdbScore =
    typeof v708EnrichedImdbRaw === 'number' &&
    Number.isFinite(v708EnrichedImdbRaw) &&
    v708EnrichedImdbRaw > 0 &&
    v708EnrichedImdbRaw <= 10
      ? v708EnrichedImdbRaw
      : null;

  const v708DisplayRating =
    typeof rating === 'number' &&
    Number.isFinite(rating) &&
    rating > 0 &&
    rating <= 10
      ? rating
      : v708EnrichedImdbScore;

  const v707TomatoesRaw = v707DetailsRatings?.tomatoes_score;

  const v707TomatoesScore =
    typeof v707TomatoesRaw === 'number' &&
    Number.isFinite(v707TomatoesRaw) &&
    v707TomatoesRaw >= 0 &&
    v707TomatoesRaw <= 100
      ? Math.round(v707TomatoesRaw)
      : null;

  const v707Certification =
    v707DetailsRatings?.certification ||
    content?.usCertification ||
    null;

  // Render stream item for FlatList
  const renderStreamItem = ({ item }: { item: Stream }) => (
    <StreamCard stream={item} onPress={() => handleStreamSelect(item, true)} />
  );

  // Mark episode as unwatched (long-press)
  const handleMarkUnwatched = useCallback(async (contentId: string) => {
    try {
      const watchedKey = 'privastream_watched';
      const existing = await AsyncStorage.getItem(watchedKey);
      const watchedSet: Record<string, boolean> = existing ? JSON.parse(existing) : {};
      delete watchedSet[contentId];
      await AsyncStorage.setItem(watchedKey, JSON.stringify(watchedSet));
      setWatchedEpisodes({ ...watchedSet });
      console.log('[DETAILS] Unmarked as watched:', contentId);
    } catch (e) {
      console.log('[DETAILS] Error unmarking watched:', e);
    }
  }, []);

  // Render episode item for FlatList
  /* v125b-focus-target */
  const renderEpisodeItem = ({ item }: { item: Episode }) => {
    // v125b: focus the targetEpisodeNumber card (param-driven OR last-watched).
    const epContentId = `${baseId || id}:${item.season}:${item.episode}`;
    const epWatched = !!watchedEpisodes[epContentId];
    const isFocusTarget = targetEpisodeNumber != null
      && item.season === selectedSeason
      && item.episode === targetEpisodeNumber;
    return (
      <EpisodeCard
        episode={item}
        fallbackPoster={content?.poster}
        onPress={() => handleEpisodePress(item)}
        isWatched={epWatched}
        onMarkUnwatched={() => handleMarkUnwatched(epContentId)}
        autoFocus={isFocusTarget}
        onFocused={isFocusTarget && fromEpisodeBackParam === 'true' ? _v508ScrollEpisodeRowIntoView : undefined}
      />
    );
  };

  // V186_BACK_INSTANT â€” render a flat placeholder once the user has pressed
  // back.  The heavy subtree dismounts on this frame; navigation runs next.
  // V706C2N4_FIRST_FRAME_ACCESS_BLOCK
  if (_v706c2n4AccessAllowed !== true) {
    return <View style={styles.container} />;
  }

  if (_v186Closing) {
    return <View style={styles.container} />;
  }
  // V360_CLOSING_EARLY_RETURN
    if (_v186Closing) { return (<View style={{flex:1,backgroundColor:'#0c0c0c'}} />); }
  return (
    <View style={styles.container}>
      {/* V176K_POPOVER_MOUNTED - Stremio-style menu host for this screen. */}
      <V176kPopover />
      {/* Background Image â€” lightweight RN Image, no expo-image overhead */}
      {displayPoster ? (
        <RNImage
          source={{ uri: displayPoster }}
          style={styles.backgroundImage}
          resizeMode="cover"
        />
      ) : null}
      
      {/* Dark overlay â€” simple View, no LinearGradient overhead */}
      <View style={styles.gradientOverlay} />
      
      {/* Auto-play loading â€” Stremio-style cinematic transition */}
      {/* v121m-play-overlay: also fires on isPlayLoading */}
      {/* v124y-overlay-persists: keep overlay up the WHOLE autoplay so user never sees episode card */}
      {/* v238b â€” REMOVED `|| isPlayLoading` branch.  When user taps Play,
          router.push to /player mounts the player INSTANTLY on top with
          its own (visually rich) PATCH_V8 loading screen.  Showing the
          details overlay first with extra "Episode N" + "S1 E1" text
          made it look like "2 different loading screens" â€” now Play
          tap just goes straight to player's single unified loading.
          The overlay still fires for the autoPlayParam path (Continue
          Watching â†’ details â†’ auto-play to player), where the details
          overlay IS the entry point. */}
      {(autoPlayParam === 'true' || isPlayLoading) && ( /* V384_PLAY_FEEDBACK - Play press shows the SAME overlay the player continues */
        <View style={styles.autoPlayOverlay}>
          {/* Full-screen series backdrop (blurred). Priority: loaded content
              backdrop (the real series art) â†’ passed-in backdrop param â†’ poster. */}
          {/* PATCH v2: prefer EPISODE backdrop so transition into player loading is seamless */}
          {(paramPoster /* V387_STABLE_OVERLAY_IMAGE */ || currentEpisode?.thumbnail || nextBackdropParam || content?.background || content?.poster || nextPosterParam) && (
            <RNImage
              source={{ uri: (paramPoster /* V387_STABLE_OVERLAY_IMAGE */ || currentEpisode?.thumbnail || nextBackdropParam || content?.background || content?.poster || nextPosterParam) as string }}
              style={StyleSheet.absoluteFillObject}
              blurRadius={8}
              resizeMode="cover"
            />
          )}
          {/* Dark overlay for legibility */}
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.65)' }]} />

          {/* Centered content: series logo / name, episode, animated progress */}
          <View style={{ alignItems: 'center', justifyContent: 'center', flex: 1, paddingHorizontal: 32 }}>
            {content?.logo ? (
              <RNImage
                source={{ uri: content.logo }}
                style={{ width: 280, height: 90, marginBottom: 20 }}
                resizeMode="contain"
              />
            ) : (
              <Text style={{ color: '#FFF', fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 16, letterSpacing: 0.5 }}>
                {content?.name || ''}
              </Text>
            )}

            {type === 'series' && (
              <Text style={{ color: '#FFF', fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 6 }}>
                {nextTitleParam
                  ? String(nextTitleParam)
                  : (currentEpisode?.name
                      || (
                        _v238ValidNum(episodeNumber)
                          ? `Episode ${episodeNumber}`
                          : (_v238ValidNum(resumeEpisode)
                              ? `Episode ${resumeEpisode}`
                              : '')
                      )
                    )}
              </Text>
            )}
            {type === 'series' && (() => {
              // v238c â€” was rendering "Snull Enull" when URL had no episode
              // segment (CW navigates to series root + resumeSeason/Episode
              // params).  Fall back to resume params, hide line entirely
              // if neither is a valid number.
              const sNum = _v238ValidNum(episodeSeason) ? episodeSeason : (_v238ValidNum(resumeSeason) ? resumeSeason : null);
              const eNum = _v238ValidNum(episodeNumber) ? episodeNumber : (_v238ValidNum(resumeEpisode) ? resumeEpisode : null);
              if (sNum == null && eNum == null) return null;
              return (
                <Text style={{ color: '#B8A05C', fontSize: 14, fontWeight: '600', marginBottom: 36, letterSpacing: 1 }}>
                  {sNum != null ? `S${sNum}` : ''}{eNum != null ? ` E${eNum}` : ''}
                </Text>
              );
            })()}

            {/* Indeterminate animated loading bar */}
            <AutoPlayLoadingBar />
            <Text style={{ color: '#CCC', fontSize: 13, marginTop: 14, fontWeight: '500' }}>
              {/* v124z-fixes: was '{'Loading...'}  /* v124x: was ...' */}{'Loading...'}
            </Text>
          </View>
        </View>
      )}
      
      {/* Content Overlay */}
      <View style={styles.contentOverlay}>
        {/* Back Button - floats over everything */}
        <FocusableButton 
          style={styles.backButton}
          focusedStyle={styles.backButtonFocused}
          onPress={handleBack}
        >
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </FocusableButton>

        {/* Fixed Title Area - never moves */}
        <View style={styles.fixedTitleArea}>
          <View style={styles.titleSection}>
            {content?.logo ? (
              <Image
                source={{ uri: content.logo }}
                style={styles.logoImage}
                contentFit="contain"
              />
            ) : (
              <Text style={styles.title}>{repairDisplayText(displayName)}</Text>
            )}
            
            {isEpisodePage && currentEpisode && (
              <Text style={styles.episodeSubtitle}>
                S{episodeSeason} E{episodeNumber} - {repairDisplayText(currentEpisode.name || `Episode ${episodeNumber}`)}
              </Text>
            )}
          </View>

          <View style={styles.metaRow}>
            {v708DisplayRating !== null && (
              <View style={styles.imdbBadge}>
                <Text style={styles.imdbLabel}>IMDb</Text>
                <Text style={styles.imdbRating}>{v708DisplayRating.toFixed(1)}</Text>
              </View>
            )}
            {v707TomatoesScore !== null && (
              <View style={styles.rtBadge}>
                <Text style={styles.rtIcon}>{'🍅'}</Text>
                <Text style={styles.rtRating}>{v707TomatoesScore}%</Text>
              </View>
            )}
            {content?.year && (
              <Text style={styles.metaText}>{content.year}</Text>
            )}
            {content?.runtime && (
              <Text style={styles.metaText}>{content.runtime}</Text>
            )}
            {v707Certification && (
              <Text style={styles.metaText}>{v707Certification}</Text>
            )}
          </View>

          {/* Description - on episode pages show episode overview instead of series description */}
          {isEpisodePage && currentEpisode?.overview ? (
            <Text style={styles.fixedDescription} numberOfLines={4}>
              {repairDisplayText(currentEpisode.overview)}
            </Text>
          ) : content?.description ? (
            <Text style={styles.fixedDescription} numberOfLines={3}>
              {repairDisplayText(content.description)}
            </Text>
          ) : null}

          {/* W121ZUI116B_PRIMARY_ACTIONS - visible without scrolling */}
          <View style={styles.fixedActionRow}>
            {(
              type === 'movie' ||
              type === 'tv' ||
              type === 'Porn' ||
              type === 'porn' ||
              type === 'adult' ||
              isEpisodePage
            ) && (
              <>
                {_w121zod111eShowPreparingUi ? (
                  <View style={styles.preparingMediaButton}>
                    <ActivityIndicator
                      size="small"
                      color="#B8A05C"
                    />
                    <Text style={styles.preparingMediaText}>
                      Preparing Playback...
                    </Text>
                  </View>
                ) : !_v667EffectiveStreamLoading &&
                  sortedStreams.length > 0 ? (
                  <FocusableButton
                    hasTVPreferredFocus={true}
                    onPress={async () => {
                      /* v238b â€” Play button picks the FIRST resolved stream
                         (one with a real URL: stream.url / externalUrl /
                         direct_url).  Only if no streams are resolved does
                         it fall back to an infoHash-only stream (porn /
                         uncached torrents).  This restores Euphoria, Hoppers
                         and other Real-Debrid cached content while keeping
                         the OnlyTarts torrent-server path working. */
                      setIsPlayLoading(true);
                      // V290 â€” defer heavy work to next tick so React can
                      // paint the loading overlay BEFORE the JS thread is
                      // tied up resolving streams.  Without this the user
                      // sees a frozen UI for several seconds.
                      setTimeout(async () => {
                      try {
                        // V769V43_SEEK_HEALTH_HYDRATE
                        // Hydrate durable seek-health before the synchronous ranker runs.
                        try {
                          const _v769HydratedSeekHealth =
                            await AsyncStorage.getItem(
                              'v769_seek_health_v1'
                            );

                          console.log(
                            '[V769V43 SEEK HEALTH HYDRATE]',
                            'bytes=' +
                              String(
                                _v769HydratedSeekHealth?.length || 0
                              )
                          );
                        } catch (_) {}

                        const list = (sortedStreams && sortedStreams.length > 0) ? sortedStreams : streams;
                        // v241 â€” for porn (PT/JT) prefer list[0] to match the
                        // first stream card (correct content mapping). For
                        // mainstream content prefer first URL-resolved stream
                        // (instant cached debrid playback).
                        const _v241IsPorn = typeof id === 'string' && (
                          id.startsWith('pt:') || id.startsWith('jt:') ||
                          id.startsWith('porn') || id.startsWith('xxx:'));
                        let picked: any = null;
                        if (_v241IsPorn) {
                          const _v241Playable = (s: any) =>
                            !!(s && (s.url || s.externalUrl || s.direct_url || s.infoHash || (s as any).info_hash));
                          picked = list[0] && _v241Playable(list[0]) ? list[0] : null;
                        }
                        if (!picked) {
                          /* V356_PLAY_USES_RANKER_TOP â€” do NOT prefer URL-resolved
                             streams over the ranker's top pick. The ranker (V354)
                             already prefers healthy high-seed torrents which are
                             what actually stream successfully. URL-resolved streams
                             from Torrentio can be dead RD links. Trust the ranker. */
                          const _v356Playable = (s: any) =>
                            !!(s && (s.url || s.externalUrl || s.direct_url || s.infoHash || (s as any).info_hash));
                          const _w121zod118PreparedWinner =
                            _w121zod111ePreparedEntryForUi
                              ?.readiness?.ok === true &&
                            _w121zod111ePreparedEntryForUi
                              ?.mediaCompatible === true
                              ? _w121zod111ePreparedEntryForUi
                                  ?.stream
                              : null;

                          // W121ZOD135_MOVIE_BUTTON_TPB_1080_MOST_SEEDERS
                          //
                          // Movie normal Play is deliberately simple:
                          // correct-title clean TPB 1080p SDR, highest seeders first.
                          // No background prepared winner is allowed to override the
                          // user's movie Play press.
                          const _w121zod135MovieTpb1080Pool =
                            type === 'movie'
                              ? list
                                  .filter((candidate: any) => {
                                    if (!candidate) return false;
                                    if (_v672IsSampleLikeStream(candidate)) {
                                      return false;
                                    }
                                    if (_w121zod108e1IsStrictForeignStream(candidate)) {
                                      return false;
                                    }

                                    const info: any =
                                      parseStreamInfo(candidate);

                                    if (
                                      info?.quality !== '1080p' ||
                                      info?.isHDR === true
                                    ) {
                                      return false;
                                    }

                                    const sourceText = (
                                      String(candidate?.provider || '') + ' ' +
                                      String(candidate?.addon || '') + ' ' +
                                      String(candidate?.name || '') + ' ' +
                                      String(candidate?.title || '') + ' ' +
                                      String(candidate?.filename || '') + ' ' +
                                      String(info?.source || '')
                                    ).toUpperCase();

                                    if (
                                      !(
                                        /\bTHEPIRATEBAY\b/.test(sourceText) ||
                                        /\bTPB\+?\b/.test(sourceText) ||
                                        /PIRATE\s*BAY/.test(sourceText)
                                      )
                                    ) {
                                      return false;
                                    }

                                    const requestedTitle = String(
                                      (content as any)?.name ||
                                      (content as any)?.title ||
                                      (paramName as any) ||
                                      ''
                                    ).trim();

                                    const requestedYear =
                                      (content as any)?.releaseInfo ||
                                      (content as any)?.year ||
                                      (content as any)?.releaseYear ||
                                      '';

                                    const identity = String(
                                      candidate?.filename ||
                                      candidate?.title ||
                                      candidate?.name ||
                                      ''
                                    ).trim();

                                    return (
                                      !!requestedTitle &&
                                      !!identity &&
                                      _v747MovieIdentityMatches(
                                        id,
                                        content,
                                        candidate,
                                        requestedTitle,
                                        requestedYear,
                                        identity
                                      )
                                    );
                                  })
                                  .sort((a: any, b: any) => {
                                    const seeders = (candidate: any): number => {
                                      const info: any =
                                        parseStreamInfo(candidate);

                                      const raw =
                                        candidate?.seeders ??
                                        candidate?.seeds ??
                                        candidate?.seed ??
                                        info?.seeders ??
                                        0;

                                      const value =
                                        typeof raw === 'number'
                                          ? raw
                                          : parseInt(String(raw), 10);

                                      return Number.isFinite(value)
                                        ? value
                                        : 0;
                                    };

                                    return seeders(b) - seeders(a);
                                  })
                              : [];

                          const _w121zod135MovieWinner =
                            _w121zod135MovieTpb1080Pool[0] ||
                            null;

                          if (_w121zod135MovieWinner) {
                            const _w121zod135Info: any =
                              parseStreamInfo(_w121zod135MovieWinner);

                            const _w121zod135RawSeeders =
                              _w121zod135MovieWinner?.seeders ??
                              _w121zod135MovieWinner?.seeds ??
                              _w121zod135MovieWinner?.seed ??
                              _w121zod135Info?.seeders ??
                              0;

                            console.log(
                              '[W121ZOD135 MOVIE PLAY]',
                              'policy=TPB_1080_MOST_SEEDERS',
                              'seeders=' + String(_w121zod135RawSeeders),
                              'hash=' +
                                String(
                                  _w121zod135MovieWinner?.infoHash ||
                                  (_w121zod135MovieWinner as any)?.info_hash ||
                                  ''
                                ).slice(0, 12)
                            );
                          }

                          picked =
                            (
                              type === 'movie' &&
                              _w121zod135MovieWinner
                            )
                              ? _w121zod135MovieWinner
                              : (
                                  _w121zod118PreparedWinner ||
                                  _v503PickReliableAutoStream(
                                    list,
                                    type === 'movie' ||
                                      type === 'series'
                                  ) ||
                                  (
                                    list.find(
                                      (s: any) =>
                                        _v356Playable(s)
                                    ) ||
                                    null
                                  )
                                );

                          if (
                            type !== 'movie' &&
                            _w121zod118PreparedWinner
                          ) {
                            console.log(
                              '[W121ZOD118A PLAY PREPARED WINNER]',
                              'hash=' +
                                String(
                                  (picked as any)?.infoHash ||
                                  (picked as any)?.info_hash ||
                                  ''
                                ).slice(0, 12)
                            );

                            _w121zod118DetailsPrepActiveRef.current = false;

                            if (
                              _w121zod118h1PlayPreparedEntry(
                                _w121zod111ePreparedEntryForUi
                              )
                            ) {
                              return;
                            }

                            // A prepared entry that cannot hand off exactly is
                            // not allowed to silently become another torrent.
                            setIsPlayLoading(false);
                            return;
                          }
                        }
                        // Normalize info_hash -> infoHash so handleStreamSelect's downstream
                        // checks find what they expect.
                        if (picked && !picked.infoHash && (picked as any).info_hash) {
                          picked = { ...picked, infoHash: (picked as any).info_hash } as any;
                        }
                        if (picked) {
                          // V441_PICK_GUARD - reject picks whose filename
                          // obviously belongs to a different movie (Marvel
                          // pack containing "Iron Man 2008" served as
                          // Spider-Man BND).  Only applies to movies.
                          // V738R1_ADULT_DIRECT_IDENTITY
                          //
                          // URL-ID adult addons preserve the source-page identity
                          // inside `id`.  When that addon also supplies a direct
                          // HTTPS media URL, a mainstream torrent filename/title
                          // comparison is not applicable.
                          //
                          // RedTube intentionally DOES NOT qualify here. Its
                          // porn_id:* mapping remains protected by V441.
                          const _v738r1AdultUrlId =
                            /^https?:\/\/(?:[^/]+\.)*(?:eporner\.com|xhamster\.com|porntrex\.com)(?:[/:?#]|$)/i.test(
                              String(id || '')
                            );

                          const _v738r1DirectHttps =
                            /^https:\/\//i.test(
                              String(
                                (picked as any)?.url ||
                                (picked as any)?.directUrl ||
                                (picked as any)?.direct_url ||
                                ''
                              )
                            );

                          const _v738r1AdultDirectIdentity =
                            _v738r1AdultUrlId &&
                            _v738r1DirectHttps;

                          if (_v738r1AdultDirectIdentity) {
                            console.log(
                              '[V738R1_ADULT_DIRECT_IDENTITY] V441 bypass'
                            );
                          }

                          if (
                            type === 'movie' &&
                            !_v738r1AdultDirectIdentity
                          ) {
                            const _v441_reqT = ((content as any)?.name || (content as any)?.title || (paramName as any) || '') as string;
                            const _v441_reqY = ((content as any)?.releaseInfo || (content as any)?.year || (content as any)?.releaseYear || '') as any;
                            const _v441_probe = (s: any) => String((s?.filename || s?.title || s?.name || '')).trim();
                            const _v441_top = _v441_probe(picked);
                            const _v441_ts = _v441_top ? _v441_movieTitleMatch(_v441_top, _v441_reqT, _v441_reqY) : 1;

                            const _v747TrustedPt =
                              _v783pTrustedAdultNativeStream(
                                id,
                                content,
                                picked
                              );

                            if (_v747TrustedPt && _v441_ts < 0.5) {
                              console.log(
                                '[V747 PT NATIVE] V441 authoritative stream accepted',
                                String(
                                  (picked as any)?.infoHash ||
                                  (picked as any)?.info_hash ||
                                  ''
                                ).slice(0, 12)
                              );
                            }

                            if (
                              _v441_reqT &&
                              _v441_top &&
                              _v441_ts < 0.5 &&
                              !_v747TrustedPt
                            ) {
                              console.log('[V441 SKIP]', _v441_ts.toFixed(2), '|', _v441_top.slice(0, 100));
                              let _v441_alt: any = null;
                              
                              // W121ZOD8_V441_RERANK_CORRECT_IDENTITY
                              // Do not take the first title-valid stream from the card list.
                              // Build the correct-title/year pool, then run the SAME
                              // authoritative device-aware selector used by normal Play.
                              const _v441Identified: any[] = [];
                              const _v441Unknown: any[] = [];
                              
                              for (let _v441_i = 0; _v441_i < list.length; _v441_i++) {
                                const _v441_candidate = list[_v441_i];
                              
                                if (_v441_candidate === picked) continue;
                              
                                const _v441_fn = _v441_probe(_v441_candidate);
                              
                                if (!_v441_fn) {
                                  _v441Unknown.push(_v441_candidate);
                                  continue;
                                }
                              
                                const _v441_sc =
                                  _v441_movieTitleMatch(
                                    _v441_fn,
                                    _v441_reqT,
                                    _v441_reqY
                                  );
                              
                                const _v747TrustedAlt =
                                  _v783pTrustedAdultNativeStream(
                                    id,
                                    content,
                                    _v441_candidate
                                  );
                              
                                if (_v441_sc >= 0.5 || _v747TrustedAlt) {
                                  _v441Identified.push(_v441_candidate);
                                }
                              }
                              
                              const _v441RankPool =
                                _v441Identified.length > 0
                                  ? _v441Identified
                                  : _v441Unknown;
                              
                              _v441_alt =
                                _v503PickReliableAutoStream(
                                  _v441RankPool,
                                  type === 'movie' || type === 'series'
                                );
                              
                              if (_v441_alt) {
                                const _v441ChosenName =
                                  _v441_probe(_v441_alt);
                              
                                const _v441ChosenScore =
                                  _v441ChosenName
                                    ? _v441_movieTitleMatch(
                                        _v441ChosenName,
                                        _v441_reqT,
                                        _v441_reqY
                                      )
                                    : 0;
                              
                                console.log(
                                  '[W121ZOD8 V441 RERANK]',
                                  'identified=' + _v441Identified.length,
                                  'unknown=' + _v441Unknown.length,
                                  'score=' + _v441ChosenScore.toFixed(2),
                                  '|',
                                  _v441ChosenName.slice(0, 100)
                                );
                              }
                                                            if (_v441_alt) {
                                picked = _v441_alt;
                              } else {
                                console.log('[V441] no title-matching stream in top', list.length, '- aborting play. content=', String(_v441_reqT).slice(0,80));
                                setIsPlayLoading(false);
                                // W121ZOD118H1_NO_TECHNICAL_POPUP
                                return;
                              }
                            }
                          }
                          console.log('[V358 PLAY] picked:', String(picked.name || picked.title || '').slice(0,80),
                                   '| hasUrl=', !!picked.url,
                                   '| infoHash=', String(picked.infoHash || '').slice(0,8),
                                   '| audio-tag=', String(picked.title || picked.name || '').match(/DTS[\-\s]?HD\s?MA|DTS[\-\s]?X|DTSX|TRUEHD|TRUE[\-\s]?HD|ATMOS|DTS/i)?.[0] || 'aac/ac3-ok');
                          // Stop Details candidate churn immediately.
                          // Keep the prepared cache until handleStreamSelect
                          // has reused the exact media/probe/readiness result.
                          _w121zod118DetailsPrepActiveRef.current = false;

                          handleStreamSelect(picked);                        } else {
                          setIsPlayLoading(false);
                        }
                      } catch (e) {
                        console.log('[v241 PLAY] error:', e);
                        setIsPlayLoading(false);
                      }
                      }, 0); // V290 â€” close setTimeout from above
                    }}
                    style={styles.playButton}
                    focusedStyle={styles.playButtonFocused}
                  >
                    <Ionicons name="play" size={18} color="#000" />
                    <Text style={styles.playButtonText}>Play</Text>
                  </FocusableButton>
                ) : null}
              </>
            )}
            <FocusableButton 
              hasTVPreferredFocus={type === 'series' && !isEpisodePage}
              style={styles.libraryButton}
              focusedStyle={styles.libraryButtonFocused}
              onPress={toggleLibrary}
            >
              <Ionicons 
                name={inLibrary ? "checkmark" : "add"} 
                size={20} 
                color="#FFFFFF" 
              />
              <Text style={styles.libraryButtonText}>
                {inLibrary ? 'In Library' : 'Add to Library'}
              </Text>
            </FocusableButton>
          </View>
        </View>

        {/* Scrollable Content - everything below the pinned area */}
        <ScrollView
          ref={_v508DetailsScrollRef}
          style={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContentContainer}
          // v214b details bounded â€” stop the Android TV over-scroll past
          // the bottom padding so DOWN at the last section does nothing
          // instead of revealing a blank void (which confused focus search).
          overScrollMode="never"
          bounces={false}
        >
          {/* V783R_UNIVERSAL_ADULT_TAG_BUTTONS */}
          {(() => {
            const rawId = String(
              (content as any)?.id ||
              id ||
              ''
            )
              .trim()
              .toLowerCase();

            const rawType = String(
              (content as any)?.type ||
              type ||
              ''
            )
              .trim()
              .toLowerCase();

            const sourceText = [
              (content as any)?.addon,
              (content as any)?.source,
              (content as any)?.serviceName,
              (content as any)?.catalogName,
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();

            const isAdultDetail =
              (content as any)?.adult === true ||
              rawType === 'porn' ||
              rawType === 'adult' ||
              /^(?:pt:|porndb:|porn_id:|porn_|jstrm:|knaben:|pornrips:|eporner:|xhamster:|porntrex:|spankbang:|missav:)/i.test(rawId) ||
              /\b(?:adult videos|onlyporn|porn tube|porntube|jaxxx|dirty pink|tpb.*porn)\b/i.test(sourceText);

            const rawTags: any[] = [];

            const addValues = (value: any) => {
              if (Array.isArray(value)) {
                value.forEach(addValues);
                return;
              }

              if (value === null || value === undefined) {
                return;
              }

              if (typeof value === 'string') {
                const clean = value.trim();

                if (clean) {
                  rawTags.push(clean);
                }

                return;
              }

              if (typeof value === 'object') {
                const clean = String(
                  value?.name ||
                  value?.title ||
                  value?.label ||
                  ''
                ).trim();

                if (clean) {
                  rawTags.push(clean);
                }
              }
            };

            if (isAdultDetail) {
              // Stremio addons are inconsistent here, so accept all
              // common metadata representations without inventing tags.
              addValues((content as any)?.genre);
              addValues((content as any)?.genres);
              addValues((content as any)?.tag);
              addValues((content as any)?.tags);

              const links =
                Array.isArray((content as any)?.links)
                  ? (content as any).links
                  : [];

              links.forEach((link: any) => {
                const category =
                  String(link?.category || '')
                    .trim()
                    .toLowerCase();

                if (
                  category === 'genre' ||
                  category === 'genres' ||
                  category === 'tag' ||
                  category === 'tags'
                ) {
                  addValues(
                    link?.name ||
                    link?.title ||
                    link?.label
                  );
                }
              });
            } else {
              // Preserve normal movie/TV Genre behavior.
              addValues((content as any)?.genre);
            }

            const seen =
              new Set<string>();

            const chips =
              rawTags.filter((value: any) => {
                const clean =
                  String(value || '').trim();

                if (!clean) {
                  return false;
                }

                const key =
                  clean.toLowerCase();

                if (seen.has(key)) {
                  return false;
                }

                seen.add(key);
                return true;
              });

            if (chips.length === 0) {
              return null;
            }

            const visible =
              isAdultDetail
                ? chips.slice(0, 16)
                : chips.slice(0, 4);

            return (
              <View style={styles.chipSection}>
                <Text style={styles.chipLabel}>
                  {isAdultDetail ? 'Tags' : 'Genre'}
                </Text>

                <View style={styles.chipRow}>
                  {visible.map(
                    (tag: string, i: number) => (
                      <ChipButton
                        key={`genre-${i}`}
                        label={repairDisplayText(tag)}
                        hasTVPreferredFocus={false}
                        onPress={() =>
                          router.push({
                            pathname: '/(tabs)/search',
                            params: {
                              q: repairDisplayText(tag),
                              mode: isAdultDetail
                                ? 'auto'
                                : 'genre',
                            },
                          })
                        }
                      />
                    )
                  )}
                </View>
              </View>
            );
          })()}
          {/* Director */}
          {content?.director && Array.isArray(content.director) && content.director.length > 0 && (
            <View style={styles.chipSection}>
              <Text style={styles.chipLabel}>Director</Text>
              <View style={styles.chipRow}>
                {content.director.slice(0, 3).map((d: string, i: number) => (
                  <ChipButton key={`dir-${i}`} label={repairDisplayText(d)} onPress={() => router.push({ pathname: '/(tabs)/search', params: { q: repairDisplayText(d), mode: 'director' } })} />
                ))}
              </View>
            </View>
          )}

          {/* Cast */}
          {content?.cast && Array.isArray(content.cast) && content.cast.length > 0 && (
            <View style={styles.chipSection}>
              <Text style={styles.chipLabel}>Cast</Text>
              <View style={styles.chipRow}>
                {content.cast.slice(0, 6).map((c: string, i: number) => (
                  <ChipButton key={`cast-${i}`} label={repairDisplayText(c)} onPress={() => router.push({ pathname: '/(tabs)/search', params: { q: repairDisplayText(c), mode: 'cast' } })} />
                ))}
              </View>
            </View>
          )}

          {/* Season Selector for Series */}
          {type === 'series' && !isEpisodePage && seasons.length > 0 && (
            <View
              style={styles.seasonSection}
              onLayout={(e) => {
                _v508SeasonSectionYRef.current = e.nativeEvent.layout.y;
                if (fromEpisodeBackParam === 'true') _v508ScrollEpisodeRowIntoView();
              }}
            >
              <Text style={styles.sectionTitle}>Episodes</Text>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                style={styles.seasonSelector}
              >
                {seasons.map((season, idx) => (
                  <FocusableButton
                    key={season}
                    style={[
                      styles.seasonButton,
                      selectedSeason === season && styles.seasonButtonActive,
                    ]}
                    focusedStyle={styles.seasonButtonFocused}
                    onPress={() => setSelectedSeason(season)}
                  >
                    <Text style={[
                      styles.seasonButtonText,
                      selectedSeason === season && styles.seasonButtonTextActive,
                    ]}>
                      Season {season}
                    </Text>
                  </FocusableButton>
                ))}
              </ScrollView>
              
              {/* Episodes List */}
              {/* v125b-flatlist-scroll */}
              <FlatList
                key={`episodes-${selectedSeason}-${targetEpisodeIndex}`}
                data={episodesForSeason}
                renderItem={renderEpisodeItem}
                keyExtractor={(item) => `${item.season}-${item.episode}`}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.episodesList}
                // v125b FIX B: mount the target card at first paint, scroll it
                // into view, and guarantee the existing v124ab pressableRef
                // + setNativeProps retry actually has a node to focus.
                initialScrollIndex={targetEpisodeIndex}
                getItemLayout={(_, index) => ({ length: 160, offset: 172 * index, index })}
                initialNumToRender={Math.max(8, targetEpisodeIndex + 3)}
                onScrollToIndexFailed={() => {
                  // getItemLayout makes this practically unreachable, but
                  // keep a no-op handler so React Native doesn't warn.
                }}
              />
            </View>
          )}

          {/* Streams Section - Stremio Style */}
          {/* V780C_ADULT_STREAM_SECTION_GATE */}
          {/* W121ZOD118D_SEARCHING_STREAMS_UI */}
          {(
            type === 'movie' ||
            type === 'tv' ||
            type === 'Porn' ||
            type === 'porn' ||
            type === 'adult' ||
            isEpisodePage
          ) && (
            <View style={styles.streamsSection}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <Text style={styles.sectionTitle}>
                  {_w121zod111eAutoPlayGateApplies &&
                  _w121zod111eShowPreparingUi
                    ? 'Searching for Streams...'
                    : _v667EffectiveStreamLoading
                        ? type === 'tv'
                          ? 'Verifying Live Streams...'
                          : 'Finding Streams...'
                        : String(sortedStreams.length) +
                          ' Stream' +
                          (sortedStreams.length !== 1 ? 's' : '')}
                </Text>
              </View>

              {_w121zod111eAutoPlayGateApplies &&
              _w121zod111eShowPreparingUi ? (
                <View style={styles.streamLoading}>
                  <ActivityIndicator
                    size="small"
                    color="#B8A05C"
                  />
                </View>
              ) : _v667EffectiveStreamLoading ? (
                <View style={styles.streamLoading}>
                  <ActivityIndicator
                    size="small"
                    color="#B8A05C"
                  />
                  <Text style={styles.streamLoadingText}>
                    {type === 'tv'
                      ? 'Checking available channels...'
                      : 'Searching sources...'}
                  </Text>
                </View>
              ) : sortedStreams.length === 0 ? (
                <View style={styles.noStreams}>
                  <Ionicons
                    name="cloud-offline-outline"
                    size={32}
                    color="#666"
                  />
                  <Text style={styles.noStreamsText}>
                    No streams found
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={sortedStreams}
                  renderItem={renderStreamItem}
                  keyExtractor={(item, index) =>
                    String(
                      item.infoHash ||
                      item.url ||
                      index
                    )
                  }
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.streamsList}
                />
              )}
            </View>
          )}
          {/* No extra bottom padding â€” scroll locks at stream cards */}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f11',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f0f11',
  },
  backgroundImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: width,
    height: height,
  },
  gradientOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 15, 17, 0.75)',
  },
  autoPlayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // v238b â€” REVERTED back to original 0.95 dark.  Player.tsx's loading
    // screen (PATCH_V8_UNIFIED_LOADING) was designed to visually match
    // this overlay (blurred backdrop + logo + sliding gold bar + Loadingâ€¦).
    // My earlier change to solid black broke the unification.  Both
    // overlays now use the same backdrop-aware dark scheme â€” user sees
    // one continuous cinematic transition.
    backgroundColor: 'rgba(15, 15, 17, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  autoPlayText: {
    color: '#B8A05C',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  contentOverlay: {
    flex: 1,
  },
  backButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 30,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  backButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
  },
  scrollContent: {
    flex: 1,
  },
  scrollContentContainer: {
    paddingHorizontal: 20,
    // v238 â€” was paddingBottom: 40 which created a 40px void user could
    // scroll into past the stream cards.  No bottom pad now; ScrollView
    // ends exactly at the last stream card.
    paddingBottom: 0,
  },
  fixedTitleArea: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  fixedDescription: {
    fontSize: 13,
    color: '#D4BC78',
    lineHeight: 19,
    marginBottom: 8,
  },
  fixedActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
  },
  titleSection: {
    marginBottom: 8,
    alignItems: 'flex-start',
  },
  logoImage: {
    width: width * 0.6,
    height: 80,
    alignSelf: 'flex-start',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#B8A05C',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
    textAlign: 'left',
  },
  episodeSubtitle: {
    fontSize: 16,
    color: '#B8A05C',
    marginTop: 8,
    textAlign: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 8,
  },
  imdbBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(245, 197, 24, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  imdbLabel: {
    backgroundColor: '#F5C518',
    color: '#000000',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 2,
  },
  imdbRating: {
    color: '#F5C518',
    fontSize: 14,
    fontWeight: '600',
  },
  rtBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 99, 71, 0.16)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  rtIcon: {
    fontSize: 14,
  },
  rtRating: {
    color: '#FF6B5E',
    fontSize: 14,
    fontWeight: '600',
  },
  metaText: {
    color: '#AAAAAA',
    fontSize: 14,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  libraryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  libraryButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
  },
  libraryButtonText: {
    color: '#B8A05C',
    fontSize: 14,
    fontWeight: '600',
  },
  // Play button â€” matches the libraryButton/streamCard focus pattern so users
  // get a familiar gold border + slight scale on focus, instead of a custom
  // setNativeProps trick that doesn't repaint reliably on Android TV.
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minWidth: 150,
    paddingHorizontal: 26,
    paddingVertical: 11,
    backgroundColor: '#B8A05C',
    borderRadius: 8,
    marginRight: 0,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  preparingMediaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(184, 160, 92, 0.16)',
    borderRadius: 8,
    marginRight: 12,
    borderWidth: 2,
    borderColor: 'rgba(184, 160, 92, 0.35)',
  },
  preparingMediaText: {
    color: '#B8A05C',
    fontWeight: '600',
    fontSize: 15,
    marginLeft: 4,
  },
  playButtonFocused: {
    borderColor: '#FFFFFF',
    backgroundColor: '#D4BC78',
    transform: [{ scale: 1.06 }],
  },
  playButtonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 15,
    marginLeft: 4,
  },
  description: {
    fontSize: 14,
    color: '#D4BC78',
    lineHeight: 22,
    marginBottom: 16,
    textAlign: 'left',
  },
  castText: {
    fontSize: 13,
    color: '#888888',
    marginBottom: 24,
    textAlign: 'center',
  },
  chipSection: {
    marginBottom: 16,
    alignItems: 'flex-start',
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888888',
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: 8,
    marginBottom: 4,
  },
  chipScroll: {
    marginBottom: 4,
  },
  chipScrollContent: {
    gap: 8,
    paddingRight: 16,
  },
  chipButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  chipButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
    transform: [{ scale: 1.1 }],
  },
  chipText: {
    color: '#AAAAAA',
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextFocused: {
    color: '#FFFFFF',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#B8A05C',
    marginBottom: 12,
  },
  seasonSection: {
    marginBottom: 24,
  },
  seasonSelector: {
    marginBottom: 16,
    paddingVertical: 4,
  },
  seasonButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  seasonButtonActive: {
    backgroundColor: '#B8A05C',
  },
  seasonButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
  },
  seasonButtonText: {
    color: '#AAAAAA',
    fontSize: 13,
    fontWeight: '600',
  },
  seasonButtonTextActive: {
    color: '#000000',
  },
  episodesList: {
    gap: 12,
  },
  episodeCard: {
    width: 160,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  episodeCardFocused: {
    borderColor: '#B8A05C',
  },
  episodeThumbnail: {
    width: '100%',
    height: 90,
    backgroundColor: '#333',
  },
  episodeInfo: {
    padding: 8,
  },
  episodeTitle: {
    fontSize: 12,
    color: '#B8A05C',
    fontWeight: '500',
  },
  watchedBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  streamsSection: {
    marginBottom: 24,
  },
  streamLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 20,
  },
  streamLoadingText: {
    color: '#AAAAAA',
    fontSize: 14,
  },
  noStreams: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  noStreamsText: {
    color: '#666666',
    fontSize: 14,
    marginTop: 8,
  },
  streamsList: {
    gap: 12,
    paddingVertical: 8,
  },
  streamCard: {
    // V303_STREAMCARD_WIDTH_BUILD_TAG â€” width bump from 160â†’220 so the
    // bottom row [LANG][QUALITY][SIZE] always fits on one line at the
    // larger V302 font sizes.  Card height unchanged.
    width: 220,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'space-between',
  },
  streamCardFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.2)',
  },
  // V302: centered top play button
  streamPlayTop: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
    paddingBottom: 6,
  },
  // V302: file-size text in the footer badge row
  streamSizeText: {
    fontSize: 13,
    color: '#cccccc',
    fontWeight: '600',
    marginLeft: 4,
  },
  streamSource: {
    fontSize: 14,
    fontWeight: '700',
    color: '#B8A05C',
    flex: 1,
  },
  streamSourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  rdBadge: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 6,
  },
  rdBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  streamStatsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  qualityBadge: {
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  qualityBadge4K: {
    backgroundColor: 'rgba(184, 160, 92, 0.6)',
  },
  qualityText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#B8A05C',
  },
  langBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  v472cTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    width: '100%',
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 4,
  },
  v474PlayIcon: {
    marginHorizontal: 8,
  },
  v472cSizeText: {
    color: '#e0e0e0',
    fontSize: 12,
    fontWeight: '600',
  },
  v472cFlagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'stretch',
    width: '100%',
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  langBadgeEnglish: {
    backgroundColor: 'rgba(76, 175, 80, 0.3)',
  },
  langBadgeForeign: {
    backgroundColor: 'rgba(244, 67, 54, 0.3)',
  },
  langBadgeText: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  langBadgeTextEnglish: {
    color: '#4CAF50',
  },
  langBadgeTextForeign: {
    color: '#F44336',
  },
  streamStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  streamStatText: {
    fontSize: 14,
    color: '#aaaaaa',
    fontWeight: '500',
  },
  streamCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  streamBadgeRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  defaultFocused: {
    borderColor: '#B8A05C',
    borderWidth: 2,
  },
  // PATCH_V13_BADGE_STYLES
  commentaryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,140,0,0.18)',
    borderColor: '#FF8C00',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  commentaryBadgeText: {
    color: '#FF8C00',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  // PATCH_V18_TOPRIGHT_BUBBLE_STYLE
  commentaryBadgeTopRight: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderWidth: 1,
    borderColor: '#B8A05C',
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
});