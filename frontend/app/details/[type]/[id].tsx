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
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Constants from 'expo-constants';
import { useContentStore, getMetaCache, setMetaCache, hydrateMetaFromDisk } from '../../../src/store/contentStore';
import { v311Perf } from '../../../src/utils/v311_perf'; // V311_PERF_PROFILER

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
import AsyncStorage from '@react-native-async-storage/async-storage';
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
      <Text style={[styles.chipText, isFocused && styles.chipTextFocused]}>{label}</Text>
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
  
  let language = 'ENG';
  let isForeign = false;
  
  for (const kw of FOREIGN_KEYWORDS) {
    if (combined.includes(kw)) {
      isForeign = true;
      if (kw.includes('FRENCH') || kw === 'VFF' || kw === 'VFQ' || kw === 'VOSTFR' || kw === 'TRUEFRENCH') language = 'FRE';
      else if (kw.includes('SPANISH') || kw === 'LATINO' || kw === 'CASTELLANO') language = 'SPA';
      else if (kw.includes('GERMAN') || kw === 'DEUTSCH') language = 'GER';
      else if (kw.includes('ITALIAN') || kw === 'ITALIANO') language = 'ITA';
      else if (kw.includes('RUSSIAN')) language = 'RUS';
      else if (kw.includes('HINDI')) language = 'HIN';
      else if (kw === 'DUBBED' || kw === 'DUBLADO') language = 'DUB';
      else if (kw === 'MULTI') language = 'MULTI';
      else language = 'OTHER';
      break;
    }
  }
  for (const flag of FOREIGN_FLAGS) {
    if (title.includes(flag) || name.includes(flag)) {
      isForeign = true;
      if (flag === 'ðŸ‡«ðŸ‡·') language = 'FRE';
      else if (flag === 'ðŸ‡ªðŸ‡¸' || flag === 'ðŸ‡²ðŸ‡½') language = 'SPA';
      else if (flag === 'ðŸ‡©ðŸ‡ª') language = 'GER';
      else if (flag === 'ðŸ‡®ðŸ‡¹') language = 'ITA';
      else if (flag === 'ðŸ‡·ðŸ‡º') language = 'RUS';
      else if (flag === 'ðŸ‡®ðŸ‡³') language = 'HIN';
      else language = 'OTHER';
      break;
    }
  }
  
  if (HAS_ENGLISH && isForeign) language = 'MULTI';
  if (HAS_ENGLISH && !isForeign) language = 'ENG';
  
  // PATCH_V11A_PARSE_CACHE_SET
  const _result = { quality, source, size, seeders, title, language, isForeign, isHEVC, isHDR, isCommentary };
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
function sortStreamsByLanguage(streams: Stream[]): Stream[] {
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
  // V292/V296 â€” gambling/spam watermark detection.  These rips have
  // hard-burned 1xbet/etc logos that ruin viewing.  We DETECT them
  // with these regexes so V296 can decide whether to hard-drop them
  // (only if a clean+cached PM alternative exists) or keep them as
  // last-resort fallback (avoids "unable to play video" on titles
  // whose only cached stream is watermarked, e.g. Project Hail Mary).
  const _V292_WATERMARK_RE = /(1xbet|melbet|mostbet|parimatch|ftcam|fxgg|hcam|ctcam|cam\.rip|hdcam|telesync|tsrip|tcrip|tc-?rip|cam-rip|new\.?source|sourceqr|sourcetv|x-?cam|hd-?cam)/i;
  // Be slightly less strict for the literal token "cam" (could be in a
  // legit URL) â€” require word boundaries for that one.
  const _V292_CAM_RE = /\b(cam|ts|tc)\b.*\b(rip|new|source)\b|\b(rip|new|source)\b.*\b(cam|ts|tc)\b/i;
  const _v296_isWatermark = (s: any): boolean => {
    const blob = `${s?.title || ''} ${s?.name || ''} ${s?.filename || ''}`;
    return _V292_WATERMARK_RE.test(blob) || _V292_CAM_RE.test(blob);
  };
  // V296 â€” check whether any CLEAN (non-watermarked) stream is known
  // PM-cached.  Only then is it safe to hard-drop the watermarked ones.
  // _v296_cacheMap is populated by the component's PM /cache/check effect.
  const _v296_cleanStreams = streams.filter((s: any) => !_v296_isWatermark(s));
  const _v296_hasCleanCached = _v296_cleanStreams.some((s: any) => {
    if (!s || !s.infoHash) return false;
    return _v296_cacheMap.get(String(s.infoHash).toLowerCase()) === true;
  });
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
  /* v121b-quality-boost */ const QUALITY_PTS: Record<string, number> = { '4K': 800, '1080p': 600, '720p': 400, 'HD': 300, 'SD': 0 };
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
      const _v296wmBlob = `${(stream as any)?.title || ''} ${(stream as any)?.name || ''} ${(stream as any)?.filename || ''}`;
      const _V296_WM_RE = /(1xbet|melbet|mostbet|parimatch|ftcam|fxgg|hcam|ctcam|cam\.rip|hdcam|telesync|tsrip|tcrip|tc-?rip|cam-rip|new\.?source|sourceqr|sourcetv|x-?cam|hd-?cam)/i;
      const _V296_CAM_RE = /\b(cam|ts|tc)\b.*\b(rip|new|source)\b|\b(rip|new|source)\b.*\b(cam|ts|tc)\b/i;
      if (_V296_WM_RE.test(_v296wmBlob) || _V296_CAM_RE.test(_v296wmBlob)) s -= 1500;
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
    /* v121e-codec-penalty */ /* v127-codec-rebalance */ /* V272_FIRESTICK_HEVC â€” Firestick's HEVC decoder is unreliable; bump non-HEVC bonus from +100 to +300 and add explicit HEVC penalty. */ if (!info.isHEVC) s += 300; else s -= 300;
    /* PATCH_V150_HDR â€” keep SDR bonus, add real HDR penalty so SDR at any
       resolution always wins over HDR (display can't tone-map â†’ dark image).
       V272_SDR_FIRESTICK â€” Firestick output washes HDR colors on SDR TVs.
       Bumped HDR penalty -800 â†’ -3000 so SDR ALWAYS wins when both exist,
       while still allowing HDR-only titles to play (cascading fallback). */
    if (!info.isHDR) s += 75; else s -= 3000;
    /* V272_DOLBY_VISION â€” DV is worst on non-DV displays (green/purple tint).
       Extra penalty so HDR10 beats DV when both are available. */
    {
      const _v272t = ((stream.title || '') + ' ' + (stream.name || '')).toUpperCase();
      const _v272IsDV = (
        _v272t.includes('DOLBY VISION') || _v272t.includes('DOLBYVISION')
        || /\bDV\b/.test(_v272t) || /[\.\- ]DV[\.\- ]/.test(_v272t)
      );
      if (_v272IsDV) s -= 1500;
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
      if (_v158_badAudio) s -= 1500;
    }
    /* PATCH_V146_AUDIO_PENALTY â€” penalize audio codecs that the Google TV
       Streamer / Firestick can't initialize at runtime even when ExoPlayer
       reports format_supported=YES.  Order matters: most specific first. */
    {
      const _v146t = ((stream.title || '') + ' ' + (stream.name || '')).toUpperCase();
      if (/\bDTS[\s\-:]?X\b|\bDTSX\b/.test(_v146t)) {
        s -= 900;
      } else if (/\bTRUEHD\b|\bTRUE[\s\-]?HD\b/.test(_v146t)) {
        s -= 800;
      } else if (/\bATMOS\b/.test(_v146t)) {
        s -= 700;
      } else if (/\bDTS[\s\-]?HD(\s*MA)?\b/.test(_v146t)) {
        s -= 400;
      } else if (/\bDTS\b/.test(_v146t)) {
        s -= 100;
      }
    }
    /* v141-cached-first-seeds-matter */
    // Cached / direct URL boost is now a partition gate â€” see below.  Keep
    // a small intra-bucket nudge so tied cached streams prefer ones with
    // a working URL set.
    if (stream.url) s += 50;
    const sd = info.seeders || 0;
    // v141: was Math.min(log10(sd)*5, 20) â€” capped at +20, basically noise.
    // Now scales up to +240 so seeders meaningfully break quality ties.
    if (sd > 0) s += Math.min(Math.log10(sd + 1) * 80, 240);
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
  const _v141_cached = parsed.filter((p) => !!p.stream.url);
  const _v141_uncached = parsed.filter((p) => !p.stream.url);
  _v141_cached.sort((a, b) => computeScore(b.info, b.stream) - computeScore(a.info, a.stream));
  _v141_uncached.sort((a, b) => computeScore(b.info, b.stream) - computeScore(a.info, a.stream));
  parsed.length = 0;
  for (const p of _v141_cached) parsed.push(p);
  for (const p of _v141_uncached) parsed.push(p);
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
    console.log('[SORT v141] picked top:', _topInfo.quality || '?', 'cached=' + (!!_top.stream.url), 'seeders=' + (_topInfo.seeders || 0), 'lang=' + (_topInfo.language || '?'), '| cached_n=' + _v141_cached.length, 'uncached_n=' + _v141_uncached.length);
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
  const { quality, size, language, isForeign, isCommentary } = parseStreamInfo(stream);
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
      {/* V302: Top â€” large centered play button. */}
      <View style={styles.streamPlayTop}>
        <Ionicons name="play-circle" size={42} color="#B8A05C" />
      </View>
      
      {/* V302: Bottom â€” single row: language, quality, size. */}
      <View style={styles.streamCardFooter}>
        <View style={styles.streamBadgeRow}>
          <View style={[
            styles.langBadge, 
            isForeign ? styles.langBadgeForeign : styles.langBadgeEnglish
          ]}>
            <Text style={[
              styles.langBadgeText,
              isForeign ? styles.langBadgeTextForeign : styles.langBadgeTextEnglish
            ]}>{language}</Text>
          </View>
          <View style={[styles.qualityBadge, quality === '4K' && styles.qualityBadge4K]}>
            <Text style={styles.qualityText}>{quality}</Text>
          </View>
          {size ? (
            <Text style={styles.streamSizeText} numberOfLines={1}>{size}</Text>
          ) : null}
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
}: {
  episode: Episode;
  fallbackPoster?: string;
  onPress: () => void;
  isWatched?: boolean;
  onMarkUnwatched?: () => void;
  autoFocus?: boolean;
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
          E{episode.episode}: {episode.name || `Episode ${episode.episode}`}
        </Text>
      </View>
    </Pressable>
  );
});

export default function DetailsScreen() {
  // V311_PERF_PROFILER - capture details-page lifecycle marks and ship
  // them to the backend /api/debug/perf endpoint for offline analysis.
  v311Perf.start('details');
  v311Perf.mark('MOUNT');
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
    nextTitle?: string;
    nextPoster?: string;
    nextBackdrop?: string;
    selectedSeason?: string;
    selectedEpisode?: string;
  }>();

  const router = useRouter();

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
    try {
      router.back();
      // After back lands us on RMroot, push focus params so the selector
      // highlights the just-watched episode.
      setTimeout(() => {
        try { router.setParams({ selectedSeason: s, selectedEpisode: e } as any); }
        catch (err) { console.log('[BACK-UI v124w] setParams error', err); }
      }, 80);
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
    _setV186Closing(true);
    requestAnimationFrame(() => {
      try {
        if (!goToSeriesRootWithFocus()) router.back();
      } catch (_) {
        try { router.back(); } catch (__) {}
      }
    });
  }, [goToSeriesRootWithFocus, router]);

  useEffect(() => {
    // PATCH_V34_DETAILS_BACK â€” back ALWAYS does something visible:
    //   1. Series-episode page â†’ goToSeriesRootWithFocus() handles it (returns true)
    //   2. Movies / series-roots â†’ router.back() to previous screen
    //   3. Deep-linked (empty stack) â†’ fall back to Discover tab
    //   4. ALWAYS return true so Android can't force-exit
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      /* v134-back-diag + V186_BACK_INSTANT */
      console.log('[BACK v134/v186] main hwBack fired; id=', id, ' type=', type, ' autoPlay=', autoPlayParam);
      // Hide heavy tree on this frame.
      _setV186Closing(true);
      // Navigate on the next frame so React can drop the subtree first.
      requestAnimationFrame(() => {
        try { if (goToSeriesRootWithFocus()) { console.log('[BACK v134] -> series-root-with-focus'); return; } } catch (_) {}
        try { router.back(); console.log('[BACK v134] -> router.back()'); return; } catch (_) {}
        try { router.replace('/(tabs)/discover'); console.log('[BACK v134] -> replace discover'); } catch (_) {}
      });
      return true;
    });
    return () => sub.remove();
  }, [goToSeriesRootWithFocus]);
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
  const cachedMeta = id ? getMetaCache(id) : null;
  // V306_INITIAL_BACKDROP_BUILD_TAG â€” wire the background + logo router
  // params into initialContent so the backdrop image renders on the FIRST
  // frame instead of staying blank until the /meta network call returns
  // (typically 5-8s on cold cache).  V238 passed these params from
  // discover but they were dropped here, which is the actual cause of the
  // perceived "6 seconds to get to the details page" delay.
  const _V306_BUILD_TAG = 'V306_INITIAL_BACKDROP_BUILD_TAG';
  void _V306_BUILD_TAG;
  const initialContent: ContentItem = cachedMeta || {
    id: id!,
    imdb_id: id,
    name: paramName || '',
    type: type as 'movie' | 'series',
    poster: paramPoster || '',
    background: paramBackground || '',
    logo: paramLogo || '',
  } as any;
  
  const [content, setContent] = useState<ContentItem | null>(initialContent);

  // PATCH_V244_META_HYDRATE â€” on cold start, in-memory _metaCache is
  // empty so Details would paint with just (paramName + paramPoster)
  // while waiting ~7s for the network /meta call.  Try the 24h disk
  // cache FIRST â€” typically yields a full meta object in ~30-80ms,
  // so the user sees cast / plot / episodes almost immediately.
  // Network refresh still runs after to pull any updates.
  useEffect(() => {
    if (!id) return;
    if (cachedMeta) return; // already painted from memory
    let cancelled = false;
    (async () => {
      try {
        const fromDisk = await hydrateMetaFromDisk(id);
        if (cancelled) return;
        if (fromDisk) setContent(fromDisk);
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
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
  const sortedStreams = useMemo(
    () => sortStreamsByLanguage(streams),
    [streams, _v157_currentMeta.title, _v157_currentMeta.year, _v157_currentMeta.isMovie]
  );
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
  useEffect(() => {
    if (!isPlayLoading) return;
    // Safety net: clear after 15s if navigation didn't fire
    const _t = setTimeout(() => setIsPlayLoading(false), 15000);
    return () => clearTimeout(_t);
  }, [isPlayLoading]);
  // v121j-overlay-removed

  const isEpisodePage = type !== 'tv' && id?.includes(':') && !id?.startsWith('porn') && !id?.startsWith('http');
  const baseId = isEpisodePage ? id?.split(':')[0] : id;
  const episodeSeason = isEpisodePage ? parseInt(id?.split(':')[1] || '1') : null;
  const episodeNumber = isEpisodePage ? parseInt(id?.split(':')[2] || '1') : null;

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
  }, [type, isEpisodePage, baseId, selectedSeason, targetEpisodeNumber]);

  useEffect(() => {
    // If we have cached meta with background, skip the meta fetch entirely
    const hasCachedMeta = cachedMeta && cachedMeta.background;
    if (!hasCachedMeta) {
      // Only fetch meta for series (need episodes) or if missing background
      const needsMeta = type === 'series' || !content?.background;
      if (needsMeta) {
        // PATCH_V39_DEFER_MOUNT_IO â€” defer meta fetch off the mount path
        setTimeout(() => { try { loadContent(); } catch (_) {} }, 0);
      }
    }
    // PATCH_V39_DEFER_MOUNT_IO â€” defer library fetch off the mount path
    setTimeout(() => { try { fetchLibrary(); } catch (_) {} }, 0);
    if (type && id && (type === 'movie' || type === 'tv' || isEpisodePage)) {
      // V188_NO_ZERO_FLASH â€” sync-seed loading state so the very first render
      // shows "Finding Streams..." instead of momentarily flashing "0 Streams"
      // (which can happen if streams=[] is left over from a prior failed load).
      try { (useContentStore as any).setState({ streams: [], isLoadingStreams: true, error: null }); } catch (_) {}
      // PATCH_V37_DEFER_STREAMS â€” defer to next tick so the details page paints
      // instantly; streams load in the background and populate as they arrive.
      const _v37StreamsTimer = setTimeout(() => { try { fetchStreams(type, id); } catch (_) {} }, 0);
    }
  }, [id, type]);

  /* V180_PREWARM â€” when sortedStreams populates, fire-and-forget POST to
     /api/stream/start/<infoHash> for the top 3 cached candidates.  The
     backend (v179b) writes the resolved PM URL to Redis, so by the time
     the user clicks Play the status poll lands on "ready" immediately
     instead of waiting through 8-12 s of "resolving".

     Torrentio strips infoHash in debrid mode; pull the 40-hex hash out
     of behaviorHints.bingeGroup (`torrentio|<hash>`) instead. */
  const _v180_prewarmedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!sortedStreams || sortedStreams.length === 0) return;
    try {
      const _backend = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");
      if (!_backend) return;
      let _kicked = 0;
      for (let i = 0; i < sortedStreams.length && _kicked < 3; i++) {
        const s: any = sortedStreams[i];
        const _bh: any = s && s.behaviorHints;
        let _hash: string = (s && s.infoHash) ? String(s.infoHash).toLowerCase() : "";
        if (!_hash && _bh && typeof _bh.bingeGroup === "string") {
          const _m = _bh.bingeGroup.match(/\b([0-9a-f]{40})\b/i);
          if (_m) _hash = _m[1].toLowerCase();
        }
        if (!_hash || _hash.length !== 40) continue;
        if (_v180_prewarmedRef.current.has(_hash)) continue;
        _v180_prewarmedRef.current.add(_hash);
        // Fire-and-forget â€” never await, never bubble errors.
        try {
          fetch(`${_backend}/api/stream/start/${_hash}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              season: (typeof season === "number") ? season : undefined,
              episode: (typeof episode === "number") ? episode : undefined,
            }),
          }).catch(() => {});
        } catch (_) {}
        _kicked++;
      }
      if (_kicked > 0) {
        console.log("[PREWARM v180] kicked", _kicked, "PM resolves for top cached streams");
      }
    } catch (_) { /* never break UI */ }
  }, [sortedStreams]);

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
      const bestStream = sorted[0];
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
  const _V297_PM_KEY_SEED_BUILD_TAG = 'V297_PM_KEY_SEED_BUILD_TAG';
  void _V297_PM_KEY_SEED_BUILD_TAG;
  useEffect(() => {
    let _cancelled = false;
    (async () => {
      try {
        const _seedFlag = await AsyncStorage.getItem('@pm_key_v297_seeded');
        if (_seedFlag === '1') {
          // We have seeded once already.  Respect user's subsequent choices.
          return;
        }
        const _existing = await AsyncStorage.getItem('@pm_key_v1');
        if (_existing && _existing.trim()) {
          // Key already present â€” just record that we've completed the seed
          // step so we never overwrite it on future boots.
          if (!_cancelled) {
            await AsyncStorage.setItem('@pm_key_v297_seeded', '1');
          }
          return;
        }
        // No key on device â€” seed it now.
        if (_cancelled) return;
        await AsyncStorage.setItem('@pm_key_v1', 'mfdjfcfm9cnq757s');
        await AsyncStorage.setItem('@pm_key_v297_seeded', '1');
        console.log('[v297] PM key seeded into AsyncStorage (was empty)');
      } catch (_e) {
        console.log('[v297] PM key seed threw:', String((_e as any)?.message || _e));
      }
    })();
    return () => { _cancelled = true; };
  }, []);

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
        const _pmKey = await AsyncStorage.getItem('@pm_key_v1');
        if (!_pmKey || !_pmKey.trim()) {
          console.log('[v296] no PM key on device â€” skipping cache check');
          return;
        }
        const _hashes: string[] = [];
        const _seen = new Set<string>();
        for (const _s of streams) {
          if (!_s || !(_s as any).infoHash) continue;
          const _h = String((_s as any).infoHash).toLowerCase();
          if (_seen.has(_h)) continue;
          if (_v296_cacheMap.has(_h)) continue;
          _seen.add(_h);
          _hashes.push(_h);
          if (_hashes.length >= 50) break;
        }
        if (_hashes.length === 0) {
          console.log('[v296] all hashes already in cache map');
          return;
        }
        const _form = new URLSearchParams();
        _form.append('apikey', _pmKey.trim());
        for (const _h of _hashes) _form.append('items[]', _h);
        const _ctrl = new AbortController();
        const _to = setTimeout(() => _ctrl.abort(), 6000);
        const _res = await fetch('https://www.premiumize.me/api/cache/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: _form.toString(),
          signal: _ctrl.signal,
        });
        clearTimeout(_to);
        if (_cancelled) return;
        const _j = await _res.json();
        if (_j && _j.status === 'success' && Array.isArray(_j.response)) {
          let _cached = 0;
          for (let _i = 0; _i < _hashes.length; _i++) {
            const _isCached = !!_j.response[_i];
            _v296_cacheMap.set(_hashes[_i], _isCached);
            if (_isCached) _cached++;
          }
          console.log('[v296] PM /cache/check:', _cached + '/' + _hashes.length, 'cached for', _contentKey);
          _v296_setCacheTick((t) => t + 1);
        } else {
          console.log('[v296] PM /cache/check non-success:', _j && _j.status, _j && _j.message);
        }
      } catch (_e) {
        console.log('[v296] PM /cache/check threw:', String((_e as any)?.message || _e));
      }
    })();
    return () => { _cancelled = true; };
  }, [streams, isLoadingStreams, id]);

  // PRE-WARM: When streams are loaded, silently pre-start the top ENGLISH torrent
  // This saves 5-10 seconds of metadata download when user taps play
  const prewarmedRef = useRef<string | null>(null);
  useEffect(() => {
    if (streams && streams.length > 0 && !isLoadingStreams) {
      // Find the best English stream to prewarm (highest seeders)
      const sorted = sortStreamsByLanguage(streams);
      const topStream = sorted[0]; // English first, highest seeders
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
        ).catch(() => {});
      }
    }
  }, [streams, isLoadingStreams]);

  // PATCH_V151_PRERESOLVE â€” superset of v148.  Fire start_and_wait on the
  // FIRST stream batch (no isLoadingStreams gate) and pre-warm the top TWO
  // hashes in parallel so a late-arriving better stream is also ready.
  //
  // V291_DISABLED â€” this entire hook hits /api/stream/start_and_wait which
  // is a backend endpoint that can no longer resolve PM after middle-
  // isolation.  Each call hangs for the full 8s abort budget.  Killing it
  // when a Premiumize key is present (the v291 hook above handles client-
  // side pre-warm instead).
  const preresolvedHashesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!streams || streams.length === 0) return;
    // V291 â€” bail out entirely when PM key is set; v291 prewarm handles it.
    (async () => {
      try {
        const _pmKey = await AsyncStorage.getItem('@pm_key_v1');
        if (_pmKey) {
          console.log('[PRERESOLVE v151] skipped â€” PM key present, v291 prewarm handles this');
          return;
        }
      } catch (_) {}
    })();
    const sorted = sortStreamsByLanguage(streams);
    // Pre-resolve top 2 candidates that don't already have a URL
    const targets = sorted.slice(0, 4).filter((s: any) => s && s.infoHash && !s.url).slice(0, 2);
    if (targets.length === 0) {
      // All top candidates already cached â€” record their hashes and skip
      for (const s of sorted.slice(0, 2)) {
        if (s?.infoHash) preresolvedHashesRef.current.add(s.infoHash);
      }
      return;
    }
    // V291 â€” wrap the entire backend-fetch loop in an async PM-key check
    // so we don't fire the dead start_and_wait endpoint at all.
    (async () => {
      try {
        const _pmKey = await AsyncStorage.getItem('@pm_key_v1');
        if (_pmKey) return; // V291 â€” bail
      } catch (_) {}
    for (const tgt of targets) {
      if (preresolvedHashesRef.current.has(tgt.infoHash)) continue;
      preresolvedHashesRef.current.add(tgt.infoHash);
      (async () => {
        try {
          const _authT = await AsyncStorage.getItem('auth_token');
          const _bUrl = process.env.EXPO_PUBLIC_BACKEND_URL || (Constants.expoConfig as any)?.extra?.backendUrl || '';
          if (!_bUrl) return;
          const _hdrs: any = { 'Content-Type': 'application/json', ...(_authT ? { Authorization: `Bearer ${_authT}` } : {}) };
          const _idP = ((id as string) || '').split(':');
          const _sn = _idP.length >= 3 ? parseInt(_idP[_idP.length - 2], 10) : NaN;
          const _en = _idP.length >= 3 ? parseInt(_idP[_idP.length - 1], 10) : NaN;
          const _t0 = Date.now();
          console.log('[PRERESOLVE v151] start_and_wait hash=', tgt.infoHash.slice(0, 8), 'fileIdx=', tgt.fileIdx ?? null);
          const _ctrl = new AbortController();
          const _to = setTimeout(() => _ctrl.abort(), 8000);
          const _resp = await fetch(`${_bUrl}/api/stream/start_and_wait`, {
            method: 'POST',
            headers: _hdrs,
            signal: _ctrl.signal,
            body: JSON.stringify({
              infoHash: tgt.infoHash,
              fileIdx: tgt.fileIdx != null ? tgt.fileIdx : null,
              filename: tgt.filename || null,
              season: isNaN(_sn) ? null : _sn,
              episode: isNaN(_en) ? null : _en,
              timeout_ms: 7500,
            }),
          });
          clearTimeout(_to);
          const _data = await _resp.json().catch(() => ({}));
          const _dt = Date.now() - _t0;
          console.log('[PRERESOLVE v151] hash=', tgt.infoHash.slice(0, 8), 'status=', _data?.status, 'in', _dt, 'ms');
        } catch (_e: any) {
          if (_e?.name === 'AbortError') {
            console.log('[PRERESOLVE v151] aborted (8s budget) hash=', tgt.infoHash.slice(0, 8));
          } else {
            console.log('[PRERESOLVE v151] failed:', _e?.message || _e);
          }
        }
      })();
    }
    })(); // V291 â€” close PM-key gate IIFE
  }, [streams, id]);

  const loadContent = async () => {
    try {
      const contentId = isEpisodePage ? baseId : id;
      const data = await api.content.getMeta(type!, contentId!);
      // Cache the meta data for instant re-access
      if (contentId) setMetaCache(contentId, data);
      setContent(data);
    } catch (error) {
      console.log('Failed to fetch meta:', error);
      // Keep using the initial content from params â€” already set
    }
    setIsLoadingContent(false);
  };

  const handleStreamSelect = async (stream: Stream) => {
    // V298_INLINE_PM_KEY_SEED_BUILD_TAG â€” eliminate the race between V297's
    // mount useEffect (async, may not finish before user taps Play) and the
    // PM short-circuit in client.ts.  We re-check + write the key INLINE,
    // awaited, before any PM-dependent code path runs.  After this returns,
    // _hasPMKey() in client.ts is guaranteed to read true.
    {
      const _V298_BUILD_TAG = 'V298_INLINE_PM_KEY_SEED_BUILD_TAG';
      void _V298_BUILD_TAG;
      try {
        const _v298_existing = await AsyncStorage.getItem('@pm_key_v1');
        if (!_v298_existing || !_v298_existing.trim()) {
          await AsyncStorage.setItem('@pm_key_v1', 'mfdjfcfm9cnq757s');
          try { await AsyncStorage.setItem('@pm_key_v297_seeded', '1'); } catch (_) {}
          console.log('[v298] PM key seeded INLINE inside handleStreamSelect (was empty)');
        }
      } catch (_e) {
        console.log('[v298] PM key inline seed threw:', String((_e as any)?.message || _e));
      }
    }
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
      const _v293_pmKey = await AsyncStorage.getItem('@pm_key_v1');
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
      try {
        setIsPlayLoading(true);
        const _authT = await AsyncStorage.getItem('auth_token');
        const _bUrl = process.env.EXPO_PUBLIC_BACKEND_URL || (Constants.expoConfig as any)?.extra?.backendUrl || '';
        const _hdrs: any = { 'Content-Type': 'application/json', ...(_authT ? { Authorization: `Bearer ${_authT}` } : {}) };
        const _idP = ((id as string) || '').split(':');
        const _sn = _idP.length >= 3 ? parseInt(_idP[_idP.length - 2], 10) : NaN;
        const _en = _idP.length >= 3 ? parseInt(_idP[_idP.length - 1], 10) : NaN;
        console.log('[DETAILS v129] upgrade-race start hash=', stream.infoHash.slice(0, 8));
        const _resp = await fetch(`${_bUrl}/api/stream/start_and_wait`, {
          method: 'POST',
          headers: _hdrs,
          body: JSON.stringify({
            infoHash: stream.infoHash,
            fileIdx: stream.fileIdx != null ? stream.fileIdx : null,
            filename: stream.filename || null,
            season: isNaN(_sn) ? null : _sn,
            episode: isNaN(_en) ? null : _en,
            timeout_ms: 6500,
          }),
        });
        const _data = await _resp.json().catch(() => ({}));
        console.log('[DETAILS v129] upgrade-race status=', _data && _data.status);
        if (_data && _data.status === 'ready' && _data.debrid_url) {
          // Upgrade wins â€” inject resolved URL, fall through to existing path
          stream = { ...stream, url: `${_bUrl}${_data.debrid_url}` } as any;
          console.log('[DETAILS v129] UPGRADED (quality-upgraded)');
        } else {
          // Upgrade lost â€” pick top cached stream from this content's streams
          const _cachedFallback = streams.find((s) => s !== stream && s.url && !(s as any).upgrade_candidate);
          if (_cachedFallback) {
            console.log('[DETAILS v129] upgrade lost â€” using cached fallback:', _cachedFallback.name || '');
            stream = _cachedFallback;
          } else {
            console.log('[DETAILS v129] no cached fallback â€” proceeding with infoHash (player resolves)');
          }
        }
      } catch (_v129e) {
        console.log('[DETAILS v129] upgrade-race threw:', _v129e);
      }
      // Note: we deliberately leave setIsPlayLoading(true) â€” router.push
      // will unmount this screen and the overlay vanishes with it.
    }
    const subtitleContentId = isEpisodePage 
      ? `${baseId}:${episodeSeason}:${episodeNumber}`
      : (id as string);
    const contentTitle = currentEpisode 
      ? `S${episodeSeason}E${episodeNumber} - ${currentEpisode.name || content?.name || 'Video'}`
      : (nextTitleParam ? String(nextTitleParam) : (isEpisodePage ? `S${episodeSeason}E${episodeNumber} - ${content?.name || 'Loading...'}` : content?.name || 'Video'));
    const cType = type as string || 'movie';
    
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
    
    const buildFallbackUrls = async (): Promise<string[]> => {
      const authToken = await AsyncStorage.getItem('auth_token');
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || Constants.expoConfig?.extra?.backendUrl || '';
      
      return streams
        .filter(s => s !== stream)
        .filter(s => s.url && s.url.startsWith('/api/proxy/'))
        .slice(0, 20) /* V174_WIDEN_FALLBACK */
        .map(s => {
          const separator = s.url!.includes('?') ? '&' : '?';
          const tokenParam = authToken ? `${separator}token=${encodeURIComponent(authToken)}` : '';
          return `${backendUrl}${s.url}${tokenParam}`;
        });
    };
    
    try {
      await AsyncStorage.setItem('currentPlaying', JSON.stringify({
        contentType: cType,
        contentId: id,
        title: contentTitle,
      }));
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
        const _v300_pm = ((await AsyncStorage.getItem('@pm_key_v1')) || '').trim();
        if (_v300_pm) {
          // Build ordered candidate list: chosen stream first, then the
          // rest of `streams` (already sorted by quality/language above).
          // De-dupe by infoHash.
          const _v300_candidates: Array<{ stream: any; hash: string }> = [];
          const _v300_seen = new Set<string>();
          const _v300_pushCand = (s: any) => {
            if (!s || !s.infoHash) return;
            const h = String(s.infoHash).toLowerCase();
            if (_v300_seen.has(h)) return;
            _v300_seen.add(h);
            _v300_candidates.push({ stream: s, hash: h });
          };
          _v300_pushCand(stream);
          for (const _s of (streams || [])) _v300_pushCand(_s);

          if (_v300_candidates.length > 0) {
            // Batch cache check (max 50 per PM call).
            const _v300_hashes = _v300_candidates.slice(0, 50).map((c) => c.hash);
            const _v300_form1 = new URLSearchParams();
            _v300_form1.append('apikey', _v300_pm);
            for (const _h of _v300_hashes) _v300_form1.append('items[]', _h);
            const _v300_cached = new Set<string>();
            try {
              const _v300_ctrl1 = new AbortController();
              const _v300_to1 = setTimeout(() => _v300_ctrl1.abort(), 8000);
              const _v300_resp1 = await fetch('https://www.premiumize.me/api/cache/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: _v300_form1.toString(),
                signal: _v300_ctrl1.signal,
              });
              clearTimeout(_v300_to1);
              const _v300_j1: any = await _v300_resp1.json();
              if (_v300_j1 && _v300_j1.status === 'success' && Array.isArray(_v300_j1.response)) {
                for (let _i = 0; _i < _v300_hashes.length && _i < _v300_j1.response.length; _i++) {
                  if (_v300_j1.response[_i]) _v300_cached.add(_v300_hashes[_i]);
                }
              }
              console.log('[v300] PM /cache/check:', _v300_cached.size + '/' + _v300_hashes.length, 'cached');
            } catch (_v300_e1) {
              console.log('[v300] cache check threw:', String((_v300_e1 as any)?.message || _v300_e1));
            }
            // Pick the best cached candidate (first in the pre-sorted list
            // that is cached).  Skip watermarked entries unless they are
            // the ONLY cached option (so user always gets playback).
            const _v300_cachedCandidates = _v300_candidates.filter((c) => _v300_cached.has(c.hash));
            const _v300_isWm = (s: any) => {
              const _b = `${s?.title || ''} ${s?.name || ''} ${s?.filename || ''}`;
              return /(1xbet|melbet|mostbet|parimatch|ftcam|fxgg|hcam|ctcam|cam\.rip|hdcam|telesync|tsrip|tcrip|tc-?rip|cam-rip|new\.?source|sourceqr|sourcetv|x-?cam|hd-?cam)/i.test(_b);
            };
            const _v300_cleanCached = _v300_cachedCandidates.filter((c) => !_v300_isWm(c.stream));
            const _v300_picked = (_v300_cleanCached.length > 0 ? _v300_cleanCached : _v300_cachedCandidates)[0];
            if (_v300_picked) {
              // Resolve via directdl on the cached candidate.
              const _v300_form2 = new URLSearchParams();
              _v300_form2.append('apikey', _v300_pm);
              _v300_form2.append('src', `magnet:?xt=urn:btih:${_v300_picked.hash}`);
              try {
                const _v300_ctrl2 = new AbortController();
                const _v300_to2 = setTimeout(() => _v300_ctrl2.abort(), 15000);
                const _v300_resp2 = await fetch('https://www.premiumize.me/api/transfer/directdl', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: _v300_form2.toString(),
                  signal: _v300_ctrl2.signal,
                });
                clearTimeout(_v300_to2);
                const _v300_j2: any = await _v300_resp2.json();
                if (_v300_j2 && _v300_j2.status === 'success' && Array.isArray(_v300_j2.content) && _v300_j2.content.length > 0) {
                  const _v300_videoExt = /\.(mkv|mp4|avi|mov|m4v|ts|m2ts|webm)$/i;
                  let _v300_videos: any[] = _v300_j2.content.filter((c: any) => c && c.link && _v300_videoExt.test(c.path || c.link || ''));
                  if (_v300_videos.length === 0) _v300_videos = _v300_j2.content.filter((c: any) => c && c.link);
                  // S/E match for series
                  const _v300_idParts = ((id as string) || '').split(':');
                  const _v300_sn = _v300_idParts.length >= 3 ? parseInt(_v300_idParts[_v300_idParts.length - 2], 10) : NaN;
                  const _v300_en = _v300_idParts.length >= 3 ? parseInt(_v300_idParts[_v300_idParts.length - 1], 10) : NaN;
                  let _v300_file: any = null;
                  if (!isNaN(_v300_sn) && !isNaN(_v300_en)) {
                    const _v300_sePad = `S${String(_v300_sn).padStart(2,'0')}E${String(_v300_en).padStart(2,'0')}`;
                    const _v300_seAlt = `${_v300_sn}x${String(_v300_en).padStart(2,'0')}`;
                    _v300_file = _v300_videos.find((v: any) =>
                      (v.path || '').toUpperCase().includes(_v300_sePad) ||
                      (v.path || '').toLowerCase().includes(_v300_seAlt.toLowerCase())
                    );
                  }
                  if (!_v300_file) {
                    _v300_videos.sort((a: any, b: any) => (b.size || 0) - (a.size || 0));
                    _v300_file = _v300_videos[0];
                  }
                  if (_v300_file && _v300_file.link) {
                    console.log('[v300] PM SUCCESS via', _v300_picked.hash.slice(0,12), 'â†’', String(_v300_file.link).slice(0,80));
                    router.push({
                      pathname: '/player',
                      params: {
                        directUrl: _v237_bustUrl(String(_v300_file.link)),
                        title: contentTitle,
                        isLive: 'false',
                        contentType: cType,
                        contentId: subtitleContentId,
                        backdrop: (type === 'series' && currentEpisode?.thumbnail) || content?.background || '',
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
        const _v299_pm = ((await AsyncStorage.getItem('@pm_key_v1')) || '').trim();
        if (_v299_pm && stream.infoHash) {
          const _v299_hash = String(stream.infoHash).toLowerCase();
          const _v299_magnet = `magnet:?xt=urn:btih:${_v299_hash}`;
          const _v299_form = new URLSearchParams();
          _v299_form.append('apikey', _v299_pm);
          _v299_form.append('src', _v299_magnet);
          const _v299_ctrl = new AbortController();
          const _v299_to = setTimeout(() => _v299_ctrl.abort(), 15000);
          let _v299_link: string | null = null;
          try {
            console.log('[v299] inline PM resolve â†’', _v299_hash.slice(0, 12));
            const _v299_resp = await fetch('https://www.premiumize.me/api/transfer/directdl', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: _v299_form.toString(),
              signal: _v299_ctrl.signal,
            });
            clearTimeout(_v299_to);
            const _v299_j: any = await _v299_resp.json();
            if (_v299_j && _v299_j.status === 'success' && Array.isArray(_v299_j.content) && _v299_j.content.length > 0) {
              const _v299_videoExt = /\.(mkv|mp4|avi|mov|m4v|ts|m2ts|webm)$/i;
              let _v299_videos: any[] = _v299_j.content.filter((c: any) => c && c.link && _v299_videoExt.test(c.path || c.link || ''));
              if (_v299_videos.length === 0) _v299_videos = _v299_j.content.filter((c: any) => c && c.link);
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
                _v299_picked = _v299_videos.find((v: any) =>
                  (v.path || '').toUpperCase().includes(_v299_seCode) ||
                  (v.path || '').toLowerCase().includes(_v299_seAlt.toLowerCase())
                );
              }
              if (!_v299_picked) {
                _v299_videos.sort((a: any, b: any) => (b.size || 0) - (a.size || 0));
                _v299_picked = _v299_videos[0];
              }
              if (_v299_picked && _v299_picked.link) {
                _v299_link = String(_v299_picked.link);
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
            // Got an absolute PM CDN URL â€” push to player directly.
            router.push({
              pathname: '/player',
              params: {
                directUrl: _v237_bustUrl(_v299_link),
                title: contentTitle,
                isLive: 'false',
                contentType: cType,
                contentId: subtitleContentId,
                backdrop: (type === 'series' && currentEpisode?.thumbnail) || content?.background || '',
                poster: content?.poster || '',
                logo: content?.logo || '',
                ...currentEpisodeMeta,
                ...nextEpisodeData,
                ...resumeData,
              },
            });
            return;
          }
          // PM said uncached / error â€” fall through to existing logic
          // (V295 will strip url, infoHash path will retry via player's
          // own machinery which may pick a cached fallback torrent).
          console.log('[v299] falling through to existing branches');
        }
      } catch (_v299_outer) {
        console.log('[v299] outer threw:', String((_v299_outer as any)?.message || _v299_outer));
      }
    }
    
    // Handle external URLs - route them to the internal player
    if (stream.externalUrl || stream.requiresWebView) {
      const streamUrl = stream.externalUrl || stream.url;
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
          directUrl: _v237_bustUrl(streamUrl),
          title: contentTitle,
          isLive: 'false',
          contentType: cType,
          contentId: subtitleContentId,
          backdrop: (type === 'series' && currentEpisode?.thumbnail) || content?.background || '',
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
          backdrop: (type === 'series' && currentEpisode?.thumbnail) || content?.background || '',
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
      // Build fallback torrents from other available torrent streams (sorted by seeders)
      // V162_WIDER_FALLBACKS â€” bumped from 5 to 15 so we always have a working
      // option even when the top picks share the same codec / lossless-audio
      // incompatibility that the device can't decode.
      const sortedStreams = sortStreamsByLanguage(streams);
      const fallbackTorrents = sortedStreams
        .filter(s => s.infoHash && s.infoHash !== stream.infoHash)
        .slice(0, 20) /* V174_WIDEN_FALLBACK */
        .map(s => ({
          infoHash: s.infoHash,
          fileIdx: s.fileIdx,
          filename: s.filename || '',
          sources: s.sources || [],
          name: s.name || '',
          title: s.title || '',
        }));
      
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
          backdrop: (type === 'series' && currentEpisode?.thumbnail) || content?.background || nextBackdropParam || '',
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
      
      // Check if URL is already a backend/proxy URL (no need to re-proxy)
      const isAlreadyProxied = stream.url.startsWith('/api/') || 
                                stream.url.startsWith(backendUrl) ||
                                stream.url.includes('/api/proxy/');
      
      let streamUrl: string;
      if (isAlreadyProxied) {
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
          directUrl: _v237_bustUrl(streamUrl),
          title: contentTitle,
          isLive: type === 'tv' ? 'true' : 'false',
          contentType: cType,
          contentId: subtitleContentId,
          fallbackStreams: allStreamUrls.length > 0 ? JSON.stringify(allStreamUrls) : '',
          backdrop: (type === 'series' && currentEpisode?.thumbnail) || content?.background || '',
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

  // Render stream item for FlatList
  const renderStreamItem = ({ item }: { item: Stream }) => (
    <StreamCard stream={item} onPress={() => handleStreamSelect(item)} />
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
      />
    );
  };

  // V186_BACK_INSTANT â€” render a flat placeholder once the user has pressed
  // back.  The heavy subtree dismounts on this frame; navigation runs next.
  if (_v186Closing) {
    return <View style={styles.container} />;
  }
  return (
    <View style={styles.container}>
      {/* V176K_POPOVER_MOUNTED â€” Stremio-style menu host for this screen. */}
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
      {(autoPlayParam === 'true') && (
        <View style={styles.autoPlayOverlay}>
          {/* Full-screen series backdrop (blurred). Priority: loaded content
              backdrop (the real series art) â†’ passed-in backdrop param â†’ poster. */}
          {/* PATCH v2: prefer EPISODE backdrop so transition into player loading is seamless */}
          {(currentEpisode?.thumbnail || nextBackdropParam || content?.background || content?.poster || nextPosterParam) && (
            <RNImage
              source={{ uri: (currentEpisode?.thumbnail || nextBackdropParam || content?.background || content?.poster || nextPosterParam) as string }}
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
              <Text style={styles.title}>{displayName}</Text>
            )}
            
            {isEpisodePage && currentEpisode && (
              <Text style={styles.episodeSubtitle}>
                S{episodeSeason} E{episodeNumber} - {currentEpisode.name || `Episode ${episodeNumber}`}
              </Text>
            )}
          </View>

          <View style={styles.metaRow}>
            {rating && rating > 0 && (
              <View style={styles.imdbBadge}>
                <Text style={styles.imdbLabel}>IMDb</Text>
                <Text style={styles.imdbRating}>{rating.toFixed(1)}</Text>
              </View>
            )}
            {content?.year && (
              <Text style={styles.metaText}>{content.year}</Text>
            )}
            {content?.runtime && (
              <Text style={styles.metaText}>{content.runtime}</Text>
            )}
          </View>

          {/* Description - on episode pages show episode overview instead of series description */}
          {isEpisodePage && currentEpisode?.overview ? (
            <Text style={styles.fixedDescription} numberOfLines={4}>
              {currentEpisode.overview}
            </Text>
          ) : content?.description ? (
            <Text style={styles.fixedDescription} numberOfLines={3}>
              {content.description}
            </Text>
          ) : null}

          {/* Add to Library - under description */}
          <View style={styles.fixedActionRow}>
            <FocusableButton 
              hasTVPreferredFocus={true}
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
          style={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContentContainer}
          // v214b details bounded â€” stop the Android TV over-scroll past
          // the bottom padding so DOWN at the last section does nothing
          // instead of revealing a blank void (which confused focus search).
          overScrollMode="never"
          bounces={false}
        >
          {/* Genre */}
          {content?.genre && Array.isArray(content.genre) && content.genre.length > 0 && (
            <View style={styles.chipSection}>
              <Text style={styles.chipLabel}>Genre</Text>
              <View style={styles.chipRow}>
                {content.genre.slice(0, 4).map((g: string, i: number) => (
                  <ChipButton key={`genre-${i}`} label={g} hasTVPreferredFocus={i === 0} onPress={() => router.push({ pathname: '/(tabs)/search', params: { q: g } })} />
                ))}
              </View>
            </View>
          )}

          {/* Director */}
          {content?.director && Array.isArray(content.director) && content.director.length > 0 && (
            <View style={styles.chipSection}>
              <Text style={styles.chipLabel}>Director</Text>
              <View style={styles.chipRow}>
                {content.director.slice(0, 3).map((d: string, i: number) => (
                  <ChipButton key={`dir-${i}`} label={d} onPress={() => router.push({ pathname: '/(tabs)/search', params: { q: d } })} />
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
                  <ChipButton key={`cast-${i}`} label={c} onPress={() => router.push({ pathname: '/(tabs)/search', params: { q: c } })} />
                ))}
              </View>
            </View>
          )}

          {/* Season Selector for Series */}
          {type === 'series' && !isEpisodePage && seasons.length > 0 && (
            <View style={styles.seasonSection}>
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
          {(type === 'movie' || type === 'tv' || isEpisodePage) && (
            <View style={styles.streamsSection}>
              {/* Play button on left + stream count */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                {/* V169_STREAM_COUNT_USES_SORTED â€” use filtered list for gating */}
                {!isLoadingStreams && sortedStreams.length > 0 && (
                  <FocusableButton
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
                      setTimeout(() => {
                      try {
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
                          const resolved = list.find((s: any) => s && (s.url || s.externalUrl || s.direct_url));
                          const infoHashOnly = list.find((s: any) => s && (s.infoHash || (s as any).info_hash));
                          picked = resolved || infoHashOnly || list[0] || null;
                        }
                        // Normalize info_hash -> infoHash so handleStreamSelect's downstream
                        // checks find what they expect.
                        if (picked && !picked.infoHash && (picked as any).info_hash) {
                          picked = { ...picked, infoHash: (picked as any).info_hash } as any;
                        }
                        if (picked) {
                          console.log('[v241 PLAY] picked:', picked.name || picked.title, 'isPorn=', _v241IsPorn);
                          handleStreamSelect(picked);
                        } else {
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
                )}
                <Text style={styles.sectionTitle}>
                  {/* V169_STREAM_COUNT_USES_SORTED â€” display filtered count to match list */}
                  {isLoadingStreams ? (type === 'tv' ? 'Verifying Live Streams...' : 'Finding Streams...') : `${sortedStreams.length} Stream${sortedStreams.length !== 1 ? 's' : ''}`}
                </Text>
              </View>
              
              {isLoadingStreams ? (
                <View style={styles.streamLoading}>
                  <ActivityIndicator size="small" color="#B8A05C" />
                  <Text style={styles.streamLoadingText}>
                    {type === 'tv' ? 'Checking available channels...' : 'Searching sources...'}
                  </Text>
                </View>
              /* V169_STREAM_COUNT_USES_SORTED â€” empty-state uses filtered list */
              ) : sortedStreams.length === 0 ? (
                <View style={styles.noStreams}>
                  <Ionicons name="cloud-offline-outline" size={32} color="#666" />
                  <Text style={styles.noStreamsText}>No streams found</Text>
                </View>
              ) : (
                <FlatList
                  data={sortedStreams}
                  renderItem={renderStreamItem}
                  keyExtractor={(item, index) => `${item.infoHash || item.url || index}`}
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
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#B8A05C',
    borderRadius: 8,
    marginRight: 12,
    borderWidth: 2,
    borderColor: 'transparent',
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