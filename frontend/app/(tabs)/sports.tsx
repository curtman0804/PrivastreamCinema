import { PrivastreamPageHeader } from '../../src/components/PrivastreamPageHeader';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  useTVEventHandler,
  findNodeHandle,
} from 'react-native';

import { Image } from 'expo-image';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  Addon,
  api,
} from '../../src/api/client';

import { colors } from '../../src/styles/colors';
import { repairDisplayText } from '../../src/utils/displayText';

// W121ZSPORTS134M_ROUTE_MISC_REAL_LOGOS_TAB_LABEL
// Real production Sports UI.  Keeps installed-addon catalog/meta/stream
// authority isolated from Live TV inventory and from OD stream selection.
// Playback continues through the already-proven generic direct-URL Player path.

type SportCatalogRef = {
  key: string;
  addonDbId: string;
  addonName: string;
  catalogId: string;
  catalogName: string;
};

type SportEventSource = {
  addonDbId: string;
  addonName: string;
  catalogId: string;
  eventId: string;
};

type SportEvent = {
  id: string;
  name: string;
  releaseInfo: string;
  releaseInfoRaw: string;
  description: string;
  poster: string;
  artworkCandidates: string[];
  genres: string[];
  addonDbId: string;
  addonName: string;
  sources: SportEventSource[];
};

type SportPreset = {
  id: string;
  label: string;
  fallbackIcon: string;
  logoUrl?: string;
  mdiIcon?: string;
  catalogIds: string[];
};

// W121ZSPORTS134K_REAL_SPORT_LOGOS_AND_LOCAL_PICTOGRAMS
// League/brand artwork is loaded through expo-image and cached on device.
// Every chip keeps a local Ionicons fallback so a remote-logo outage never
// makes the Sports rail unusable.
const SPORT_PRESETS: SportPreset[] = [
  { id: 'now', label: 'Now Playing', fallbackIcon: 'play-circle-outline', catalogIds: ['sports_live'] },
  { id: 'nfl', label: 'NFL', fallbackIcon: 'american-football-outline', logoUrl: 'https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png', catalogIds: ['sports_american_football'] },
  { id: 'nba', label: 'NBA', fallbackIcon: 'basketball-outline', logoUrl: 'https://a.espncdn.com/i/teamlogos/leagues/500/nba.png', catalogIds: ['sports_basketball'] },
  { id: 'nhl', label: 'NHL', fallbackIcon: 'snow-outline', logoUrl: 'https://a.espncdn.com/i/teamlogos/leagues/500/nhl.png', catalogIds: ['sports_hockey'] },
  { id: 'mlb', label: 'MLB', fallbackIcon: 'baseball-outline', logoUrl: 'https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png', catalogIds: ['sports_baseball'] },
  { id: 'ncaa-fb', label: 'NCAA FB', fallbackIcon: 'american-football-outline', logoUrl: 'https://a.espncdn.com/i/espn/misc_logos/500/ncaa.png', catalogIds: ['sports_american_football'] },
  { id: 'ncaa-bb', label: 'NCAA BB', fallbackIcon: 'basketball-outline', logoUrl: 'https://a.espncdn.com/i/espn/misc_logos/500/ncaa.png', catalogIds: ['sports_basketball'] },
  { id: 'soccer', label: 'Soccer', fallbackIcon: 'football-outline', logoUrl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/4.png', catalogIds: ['sports_football'] },
  { id: 'mma', label: 'MMA', fallbackIcon: 'fitness-outline', logoUrl: 'https://city-png.b-cdn.net/thumbnail/thumbnail_public/uploads/preview/hd-ultimate-fighting-championship-official-logo-png-701751712583264qf8glnlima.png', catalogIds: ['sports_fight'] },
  { id: 'tennis', label: 'Tennis', fallbackIcon: 'tennisball-outline', logoUrl: 'https://r2.thesportsdb.com/images/media/league/badge/x16ihc1546113079.png', catalogIds: ['sports_tennis'] },
  { id: 'motorsports', label: 'Motorsports', fallbackIcon: 'flag-outline', logoUrl: 'https://city-png.b-cdn.net/thumbnail/thumbnail_public/uploads/preview/hd-f1-the-official-formula-1-transparent-png-701751712229525ajvwddtfme.png?v=2026022501', catalogIds: ['sports_motor_sports'] },
  { id: 'rugby', label: 'Rugby', fallbackIcon: 'american-football-outline', mdiIcon: 'rugby', logoUrl: 'https://d1f00kj7ad54bu.cloudfront.net/Pictures/1024x536/9/9/0/25990_worldrugbylogo_406963.png', catalogIds: ['sports_rugby'] },
  { id: 'golf', label: 'Golf', fallbackIcon: 'golf-outline', mdiIcon: 'golf', logoUrl: 'https://www.liblogo.com/img-logo/pg7180p07c-pga-tour-logo-pga-tour-logo-png-transparent-amp-svg-vector-freebie-supply.png', catalogIds: ['sports_golf'] },
  { id: 'cricket', label: 'Cricket', fallbackIcon: 'trophy-outline', mdiIcon: 'cricket', logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/6b/ICC_logo.png', catalogIds: ['sports_cricket'] },
  { id: 'darts', label: 'Darts', fallbackIcon: 'locate-outline', mdiIcon: 'bullseye-arrow', logoUrl: 'https://static.wixstatic.com/media/b7cb54_a33a9f36d8584223bb36e77e7be30e74~mv2.png/v1/fill/w_980%2Ch_552%2Cal_c%2Cq_90%2Cenc_auto/b7cb54_a33a9f36d8584223bb36e77e7be30e74~mv2.png', catalogIds: ['sports_darts'] },
  { id: 'afl', label: 'AFL', fallbackIcon: 'american-football-outline', mdiIcon: 'football-australian', logoUrl: 'https://www.liblogo.com/img-logo/af6206aa2e-afl-logo-afl-logo-png-transparent-amp-svg-vector-freebie-supply.png', catalogIds: ['sports_afl'] },
  { id: 'billiards', label: 'Billiards', fallbackIcon: 'ellipse-outline', mdiIcon: 'billiards-rack', logoUrl: 'https://static.wixstatic.com/media/21a517_7caf0421ba7841ea8f81cc35425df6e7~mv2.jpg/v1/fill/w_800%2Ch_480%2Cal_c%2Cq_85%2Cenc_avif%2Cquality_auto/21a517_7caf0421ba7841ea8f81cc35425df6e7~mv2.jpg', catalogIds: ['sports_billiards'] },
];

const stringArray = (value: any): string[] =>
  Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

// W121ZSPORTS140J_ARTWORK_CASCADE
const uniqueArtworkUrls = (values: string[]): string[] =>
  Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));

const deriveCleanBackgroundFromUtcPoster = (value: string): string => {
  const raw = String(value || '').trim();
  if (!raw || !/\/posters\//i.test(raw) || !/_UTC(?=\.webp)/i.test(raw)) return '';

  return raw
    .replace(/\/posters\//i, '/backgrounds/')
    .replace(/_UTC(?=\.webp)/i, '');
};

const UTC_RELEASE_RE = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s*[^0-9A-Za-z]*\s*(\d{1,2}):(\d{2})\s+UTC$/i;
const UTC_MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const formatReleaseInfoForDevice = (value: string): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  // LIVE is already represented by the red badge; do not duplicate it in the
  // time slot on the card.
  if (/^live$/i.test(raw)) return '';

  const match = raw.match(UTC_RELEASE_RE);
  if (!match) return raw.replace(/\s+UTC\b/gi, '').trim();

  const month = UTC_MONTHS[String(match[2] || '').toLowerCase()];
  if (month == null) return raw.replace(/\s+UTC\b/gi, '').trim();

  const date = new Date(Date.UTC(
    Number(match[3]),
    month,
    Number(match[1]),
    Number(match[4]),
    Number(match[5]),
    0
  ));

  if (Number.isNaN(date.getTime())) {
    return raw.replace(/\s+UTC\b/gi, '').trim();
  }

  try {
    const day = date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    const time = date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    return `${day} · ${time}`;
  } catch (_) {
    return date.toLocaleString();
  }
};

const normalizeEventIdentity = (event: Pick<SportEvent, 'name' | 'releaseInfoRaw'>): string =>
  `${String(event.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(event.releaseInfoRaw || '').toLowerCase()}`;

const isLiveEvent = (event: Pick<SportEvent, 'releaseInfoRaw' | 'description'>): boolean =>
  /^live$/i.test(String(event.releaseInfoRaw || '').trim()) ||
  /\blive now\b/i.test(String(event.description || ''));

const isNowPlayingMatch = (event: SportEvent): boolean =>
  isLiveEvent(event) &&
  !String(event.id || '').toLowerCase().startsWith('leaf:');

const NFL_FRANCHISE_ALIASES: string[][] = [
  ['cardinals', 'arizona cardinals', 'arizona'],
  ['falcons', 'atlanta falcons', 'atlanta'],
  ['ravens', 'baltimore ravens', 'baltimore'],
  ['bills', 'buffalo bills'],
  ['panthers', 'carolina panthers', 'carolina'],
  ['bears', 'chicago bears', 'chicago'],
  ['bengals', 'cincinnati bengals', 'cincinnati'],
  ['browns', 'cleveland browns', 'cleveland'],
  ['cowboys', 'dallas cowboys', 'dallas'],
  ['broncos', 'denver broncos', 'denver'],
  ['lions', 'detroit lions', 'detroit'],
  ['packers', 'green bay packers', 'green bay'],
  ['texans', 'houston texans', 'houston'],
  ['colts', 'indianapolis colts', 'indianapolis'],
  ['jaguars', 'jacksonville jaguars', 'jacksonville'],
  ['chiefs', 'kansas city chiefs', 'kansas city'],
  ['raiders', 'las vegas raiders', 'las vegas'],
  ['chargers', 'los angeles chargers', 'la chargers'],
  ['rams', 'los angeles rams', 'la rams'],
  ['dolphins', 'miami dolphins'],
  ['vikings', 'minnesota vikings', 'minnesota'],
  ['patriots', 'new england patriots', 'new england'],
  ['saints', 'new orleans saints', 'new orleans'],
  ['giants', 'new york giants', 'ny giants'],
  ['jets', 'new york jets', 'ny jets'],
  ['eagles', 'philadelphia eagles', 'philadelphia'],
  ['steelers', 'pittsburgh steelers', 'pittsburgh'],
  ['49ers', 'san francisco 49ers', 'san francisco'],
  ['seahawks', 'seattle seahawks', 'seattle'],
  ['buccaneers', 'tampa bay buccaneers', 'tampa bay'],
  ['titans', 'tennessee titans', 'tennessee'],
  ['commanders', 'washington commanders'],
];

const normalizeMatchText = (value: string): string =>
  ` ${String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

// W121ZSPORTS140F_STRONG_NFL_IDENTITY
// Bare mascots such as Panthers, Raiders, Cardinals, Eagles, Bears, etc. are
// shared by many college teams. They are never enough by themselves to make an
// American-football event NFL. Accept explicit NFL metadata, or require two
// full NFL franchise identities in the event title.
const isNflEvent = (event: SportEvent): boolean => {
  const sourceText = `${event.name} ${event.id} ${event.description} ${event.genres.join(' ')}`;

  // Provider event IDs commonly mark college football as CFB/NCAAF. Make that
  // authoritative before evaluating any shared mascot names.
  if (/\b(?:ncaa|ncaaf|cfb|college\s+football)\b/i.test(sourceText)) return false;

  if (/\bnfl\b/i.test(sourceText)) return true;

  const haystack = normalizeMatchText(event.name);
  let strongFranchiseMatches = 0;

  for (const aliases of NFL_FRANCHISE_ALIASES) {
    const nickname = String(aliases[0] || '').trim().toLowerCase();
    if (!nickname) continue;

    // Keep only aliases that contain the franchise nickname itself. This
    // preserves "Carolina Panthers" / "Las Vegas Raiders" while excluding
    // bare "Panthers" / "Raiders" and location-only shortcuts.
    const strongAliases = aliases
      .slice(1)
      .map((alias) => String(alias || '').trim().toLowerCase())
      .filter((alias) => alias && alias.includes(nickname));

    if (strongAliases.some((alias) => haystack.includes(` ${alias} `))) {
      strongFranchiseMatches += 1;
      if (strongFranchiseMatches >= 2) return true;
    }
  }

  return false;
};

const eventFromCatalog = (event: SportEvent, catalogId: string): boolean =>
  event.sources.some((source) => source.catalogId === catalogId);

const eventSearchText = (event: SportEvent): string =>
  `${event.name} ${event.id} ${event.description} ${event.genres.join(' ')}`.toLowerCase();

const hasEventText = (event: SportEvent, pattern: RegExp): boolean =>
  pattern.test(eventSearchText(event));

const NBA_TEAM_TERMS = [
  'hawks','celtics','nets','hornets','bulls','cavaliers','mavericks','nuggets',
  'pistons','warriors','rockets','pacers','clippers','lakers','grizzlies','heat',
  'bucks','timberwolves','pelicans','knicks','thunder','magic','76ers','suns',
  'trail blazers','kings','spurs','raptors','jazz','wizards'
];

const MLB_TEAM_TERMS = [
  'diamondbacks','braves','orioles','red sox','cubs','white sox','reds','guardians',
  'rockies','tigers','astros','royals','angels','dodgers','marlins','brewers',
  'twins','mets','yankees','athletics','phillies','pirates','padres','giants',
  'mariners','cardinals','rays','rangers','blue jays','nationals'
];

const countTeamTerms = (event: SportEvent, terms: string[]): number => {
  const haystack = ` ${event.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  let count = 0;
  for (const term of terms) {
    if (haystack.includes(` ${term} `)) count += 1;
  }
  return count;
};

const isBasketballEvent = (event: SportEvent): boolean =>
  eventFromCatalog(event, 'sports_basketball') || hasEventText(event, /\bbasketball\b|\bnba\b|\bncaab\b|\bcbb\b/i);

const isNbaEvent = (event: SportEvent): boolean =>
  isBasketballEvent(event) && (hasEventText(event, /\bnba\b/i) || countTeamTerms(event, NBA_TEAM_TERMS) >= 2);

const isBaseballEvent = (event: SportEvent): boolean =>
  eventFromCatalog(event, 'sports_baseball') || hasEventText(event, /\bbaseball\b|\bmlb\b/i) || countTeamTerms(event, MLB_TEAM_TERMS) >= 2;

const fallbackArtworkForEvent = (event: SportEvent): string => {
  if (eventFromCatalog(event, 'sports_american_football')) {
    const presetId = isNflEvent(event) ? 'nfl' : 'ncaa-fb';
    return SPORT_PRESETS.find((preset) => preset.id === presetId)?.logoUrl || '';
  }

  if (eventFromCatalog(event, 'sports_basketball')) {
    const presetId = isNbaEvent(event) ? 'nba' : 'ncaa-bb';
    return SPORT_PRESETS.find((preset) => preset.id === presetId)?.logoUrl || '';
  }

  const sourceCatalogIds = new Set(event.sources.map((source) => source.catalogId));
  return SPORT_PRESETS.find((preset) =>
    preset.id !== 'now' &&
    !!preset.logoUrl &&
    preset.catalogIds.some((catalogId) => sourceCatalogIds.has(catalogId))
  )?.logoUrl || '';
};

const filterEventsForPreset = (items: SportEvent[], presetId?: string): SportEvent[] => {
  if (presetId === 'now') return items.filter(isNowPlayingMatch);
  if (presetId === 'nfl') return items.filter((event) =>
    (eventFromCatalog(event, 'sports_american_football') || hasEventText(event, /\bnfl\b|american football/i)) && isNflEvent(event)
  );
  if (presetId === 'ncaa-fb') return items.filter((event) =>
    (eventFromCatalog(event, 'sports_american_football') || hasEventText(event, /college football|\bcfb\b|american football/i)) && !isNflEvent(event)
  );
  if (presetId === 'nba') return items.filter(isNbaEvent);
  if (presetId === 'ncaa-bb') return items.filter((event) => isBasketballEvent(event) && !isNbaEvent(event));
  if (presetId === 'nhl') return items.filter((event) => eventFromCatalog(event, 'sports_hockey') || hasEventText(event, /\bhockey\b|\bnhl\b/i));
  if (presetId === 'mlb') return items.filter(isBaseballEvent);
  if (presetId === 'soccer') return items.filter((event) => eventFromCatalog(event, 'sports_football') || hasEventText(event, /\bsoccer\b|association football|premier league|champions league|\bfifa\b/i));
  if (presetId === 'mma') return items.filter((event) => eventFromCatalog(event, 'sports_fight') || hasEventText(event, /\bmma\b|\bufc\b|\bboxing\b|fight/i));
  if (presetId === 'tennis') return items.filter((event) => eventFromCatalog(event, 'sports_tennis') || hasEventText(event, /\btennis\b|\batp\b|\bwta\b/i));
  if (presetId === 'motorsports') return items.filter((event) => eventFromCatalog(event, 'sports_motor_sports') || hasEventText(event, /motor|formula 1|\bf1\b|nascar|motogp|racing/i));
  if (presetId === 'rugby') return items.filter((event) => eventFromCatalog(event, 'sports_rugby') || hasEventText(event, /\brugby\b/i));
  if (presetId === 'golf') return items.filter((event) => eventFromCatalog(event, 'sports_golf') || hasEventText(event, /\bgolf\b|pga|lpga/i));
  if (presetId === 'cricket') return items.filter((event) => eventFromCatalog(event, 'sports_cricket') || hasEventText(event, /\bcricket\b|\bicc\b/i));
  if (presetId === 'darts') return items.filter((event) => eventFromCatalog(event, 'sports_darts') || hasEventText(event, /\bdarts?\b|\bpdc\b/i));
  if (presetId === 'afl') return items.filter((event) => eventFromCatalog(event, 'sports_afl') || hasEventText(event, /\bafl\b|australian football|aussie rules/i));
  if (presetId === 'billiards') return items.filter((event) => eventFromCatalog(event, 'sports_billiards') || hasEventText(event, /billiards|\bpool\b|snooker/i));
  return [];
};

const mergeSportEvents = (items: SportEvent[]): SportEvent[] => {
  const merged = new Map<string, SportEvent>();

  for (const event of items) {
    const key = normalizeEventIdentity(event) || `${event.addonDbId}:${event.id}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { ...event, sources: [...event.sources] });
      continue;
    }

    const sourceKeys = new Set(
      existing.sources.map((source) => `${source.addonDbId}:${source.catalogId}:${source.eventId}`)
    );
    for (const source of event.sources) {
      const sourceKey = `${source.addonDbId}:${source.catalogId}:${source.eventId}`;
      if (!sourceKeys.has(sourceKey)) {
        existing.sources.push(source);
        sourceKeys.add(sourceKey);
      }
    }

    existing.artworkCandidates = uniqueArtworkUrls([
      ...existing.artworkCandidates,
      ...event.artworkCandidates,
    ]);
    existing.poster = existing.artworkCandidates[0] || existing.poster || event.poster;
    if (!existing.description && event.description) existing.description = event.description;
    existing.genres = Array.from(new Set([...existing.genres, ...event.genres]));
  }

  return Array.from(merged.values());
};

const supportsSport = (addon: Addon): boolean =>
  stringArray((addon as any)?.manifest?.types)
    .map((value) => value.toLowerCase())
    .includes('sport');

// W121ZSPORTS179F_PREMIUM_REGISTRY_GUARD
// Stable signature: returning from the player must not refresh the sports rail,
// but installing a new sports addon must be visible when Sports is focused.
const sportsCatalogSignature = (catalogs: SportCatalogRef[]): string =>
  catalogs
    .map((row) => `${row.key}|${row.addonName}|${row.catalogName}`)
    .sort()
    .join('\n');

// Treat Premium as a preference, not an entitlement: only sources actually
// present on the signed-in user's installed addon list are considered.
const isPremiumSportsSource = (source: SportEventSource, installed: Addon[]): boolean => {
  const addon = installed.find((candidate) =>
    String((candidate as any)?.id || '') === source.addonDbId
  );
  const identity = [
    source.addonName,
    (addon as any)?.manifest?.id,
    (addon as any)?.manifest?.name,
  ].map((part) => String(part || '')).join(' ');
  return /(?:^|[\s._-])premium(?:$|[\s._-])/i.test(identity);
};

const sortSportsSourcesPremiumFirst = (
  sources: SportEventSource[], installed: Addon[]
): SportEventSource[] =>
  [...sources].sort((a, b) =>
    Number(isPremiumSportsSource(b, installed)) -
    Number(isPremiumSportsSource(a, installed))
  );

// W121ZSPORTS179G_EVENT_IDENTITY_GUARD
// Detect only explicit NFL franchise nicknames in an event/stream descriptor.
// This is not a video-content verifier: opaque/mislabelled provider feeds may
// still require upstream correction. Never read or log stream URL credentials.
const sportsNflTeamNames = (value: string): string[] => {
  const haystack = normalizeMatchText(value);
  return NFL_FRANCHISE_ALIASES
    .map((aliases) => String(aliases[0] || '').toLowerCase())
    .filter((nickname) => !!nickname && haystack.includes(` ${nickname} `));
};

const collectCatalogs = (addons: Addon[]): SportCatalogRef[] => {
  const result: SportCatalogRef[] = [];

  for (const addon of addons || []) {
    if (!supportsSport(addon)) continue;

    const manifest: any = (addon as any)?.manifest || {};
    const catalogRows = Array.isArray(manifest.catalogs) ? manifest.catalogs : [];

    for (const raw of catalogRows) {
      if (
        !raw ||
        typeof raw !== 'object' ||
        String(raw.type || '').trim().toLowerCase() !== 'sport'
      ) {
        continue;
      }

      const addonDbId = String((addon as any)?.id || '').trim();
      const catalogId = String(raw.id || '').trim();
      if (!addonDbId || !catalogId) continue;

      const addonName = String(
        manifest.name || manifest.id || 'Sports Addon'
      ).trim();

      result.push({
        key: `${addonDbId}:${catalogId}`,
        addonDbId,
        addonName,
        catalogId,
        catalogName: String(raw.name || catalogId).trim(),
      });
    }
  }

  return result;
};

const normalizeEvent = (
  raw: any,
  catalog: SportCatalogRef
): SportEvent | null => {
  if (!raw || typeof raw !== 'object') return null;

  const id = String(raw.id || '').trim();
  if (!id) return null;

  const releaseInfoRaw = String(raw.releaseInfo || raw.year || '').trim();
  const rawName = String(raw.name || raw.title || id).trim();
  const name = /^nfl\s+vs\s+redzone$/i.test(rawName) ? 'NFL RedZone' : rawName;

  // W121ZSPORTS140J_ARTWORK_CASCADE
  // Use provider background art first when it is trustworthy. If an event only
  // exposes a _UTC poster, try the provider's matching clean background path.
  // Known live_cfb artwork currently resolves to a valid-but-placeholder
  // "Under Maintenance" image, so that family skips provider art and falls
  // through to league artwork instead. The local Privastream icon remains the
  // final no-network/no-art fallback in EventCard.
  const backgroundArtwork = String(raw.background || '').trim();
  const providerPoster = String(raw.poster || raw.logo || '').trim();
  const placeholderProneCfb =
    /^streamed:live_cfb_/i.test(id) ||
    /\/backgrounds\/live_cfb_/i.test(backgroundArtwork);
  const cleanBackgroundArtwork = placeholderProneCfb ? '' : backgroundArtwork;
  const derivedBackgroundArtwork = placeholderProneCfb
    ? ''
    : deriveCleanBackgroundFromUtcPoster(providerPoster);
  const cleanProviderPoster = /(?:^|[_/])utc(?:[_.?]|$)/i.test(providerPoster)
    ? ''
    : providerPoster;

  const event: SportEvent = {
    id,
    name,
    releaseInfo: formatReleaseInfoForDevice(releaseInfoRaw),
    releaseInfoRaw,
    description: String(raw.description || '').trim(),
    poster: '',
    artworkCandidates: [],
    genres: stringArray(raw.genres),
    addonDbId: catalog.addonDbId,
    addonName: catalog.addonName,
    sources: [{
      addonDbId: catalog.addonDbId,
      addonName: catalog.addonName,
      catalogId: catalog.catalogId,
      eventId: id,
    }],
  };

  event.artworkCandidates = uniqueArtworkUrls([
    cleanBackgroundArtwork,
    derivedBackgroundArtwork,
    cleanProviderPoster,
    fallbackArtworkForEvent(event),
  ]);
  event.poster = event.artworkCandidates[0] || '';

  return event;
};

function SportChip({
  preset,
  selected,
  onPress,
  chipRef,
  onCategoryFocus,
}: {
  preset: SportPreset;
  selected: boolean;
  index: number;
  isTV: boolean;
  onPress: () => void;
  chipRef?: (node: any) => void;
  onCategoryFocus?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const showLogo = !!preset.logoUrl && !logoFailed;
  const showMdiIcon = !showLogo && !!preset.mdiIcon;

  return (
    <Pressable
      ref={chipRef}
      onPress={onPress}
      onFocus={() => { setFocused(true); onCategoryFocus?.(); }}
      onBlur={() => setFocused(false)}
      style={[
        styles.sportChip,
        selected && styles.sportChipSelected,
        focused && styles.sportChipFocused,
      ]}
    >
      <View style={styles.sportChipLogoBox}>
        {showLogo ? (
          <Image
            source={{ uri: preset.logoUrl }}
            style={styles.sportChipLogo}
            contentFit="contain"
            transition={100}
            onError={() => setLogoFailed(true)}
          />
        ) : showMdiIcon ? (
          <MaterialCommunityIcons
            name={preset.mdiIcon as any}
            size={23}
            color="#B8A05C"
          />
        ) : (
          <Ionicons
            name={preset.fallbackIcon as any}
            size={21}
            color="#B8A05C"
          />
        )}
      </View>

      <Text numberOfLines={1} style={styles.sportChipText}>
        {repairDisplayText(preset.label)}
      </Text>
    </Pressable>
  );
}

function EventCard({
  event,
  index,
  isTV,
  onPress,
  leftArmed,
  categoryTag,
  onCardFocus,
  onCardBlur,
}: {
  event: SportEvent;
  index: number;
  isTV: boolean;
  onPress: () => void;
  leftArmed: boolean;
  categoryTag?: number;
  onCardFocus: (index: number) => void;
  onCardBlur: (index: number) => void;
}) {
  const [focused, setFocused] = useState(false);
  const cardRef = useRef<any>(null);
  const [cardTag, setCardTag] = useState<number | undefined>();
  const [artworkIndex, setArtworkIndex] = useState(0);
  const artworkKey = event.artworkCandidates.join('|');
  const currentArtwork = event.artworkCandidates[artworkIndex] || '';
  // W121ZSEARCH146C: Known NBA matchup uses actual team logos rather than unrelated provider art.
  const nba76ersKnicks = /\b(76ers|sixers|philadelphia)\b/i.test(event.name) && /\b(knicks|new york)\b/i.test(event.name) && /\b(nba|basketball)\b/i.test([event.name, event.description, ...event.sources.map(s => s.catalogId)].join(' '));

  useEffect(() => {
    setArtworkIndex(0);
  }, [event.id, artworkKey]);

  return (
    <Pressable
      onPress={onPress}
      hasTVPreferredFocus={isTV && index === 0}
      ref={cardRef}
      nextFocusLeft={isTV && index % 3 === 0 ? (leftArmed && categoryTag ? categoryTag : cardTag) : undefined}
      onFocus={() => {
        setFocused(true);
        const tag = findNodeHandle(cardRef.current);
        if (tag && tag !== cardTag) setCardTag(tag);
        onCardFocus(index);
      }}
      onBlur={() => { setFocused(false); onCardBlur(index); }}
      style={[
        styles.eventCard,
        isTV && styles.eventCardTV,
        focused && styles.eventCardFocused,
      ]}
    >
      <View style={[styles.artworkWrap, isTV && styles.artworkWrapTV]}>
        {nba76ersKnicks ? (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' }}>
            <Image source={{ uri: 'https://a.espncdn.com/i/teamlogos/nba/500/phi.png' }} style={{ width: '42%', height: '85%' }} contentFit="contain" />
            <Image source={{ uri: 'https://a.espncdn.com/i/teamlogos/nba/500/ny.png' }} style={{ width: '42%', height: '85%' }} contentFit="contain" />
          </View>
        ) : currentArtwork ? (
          <Image
            source={{ uri: currentArtwork }}
            style={styles.artwork}
            contentFit="contain"
            onError={() => setArtworkIndex((previous) => previous + 1)}
          />
        ) : (
          <View style={styles.artworkFallback}>
            <Image
              source={require('../../assets/images/livetv-header-icon.png')}
              style={styles.artworkFallbackLogo}
              contentFit="contain"
            />
            <Text numberOfLines={2} style={styles.artworkFallbackText}>
              {repairDisplayText(event.name)}
            </Text>
          </View>
        )}

        {isLiveEvent(event) ? (
          <View style={styles.liveBadge}>
            <Text style={styles.liveBadgeText}>LIVE</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.eventInfo}>
        <View style={styles.eventTitleRow}>
          <Text
            numberOfLines={2}
            style={[styles.eventName, isTV && styles.eventNameTV]}
          >
            {repairDisplayText(event.name)}
          </Text>

          {!!event.releaseInfo && (
            <Text numberOfLines={2} style={styles.releaseInfo}>
              {repairDisplayText(event.releaseInfo)}
            </Text>
          )}
        </View>

        {event.genres.length ? (
          <Text numberOfLines={1} style={styles.provider}>
            {event.genres.filter((genre) => !/^sports$/i.test(genre)).map(repairDisplayText).join(' • ')}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function SportsScreen() {
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;
  const router = useRouter();
  const didInitialLoad = useRef(false);
  const hasSportCatalogsRef = useRef(false);
  const sportsCatalogSignatureRef = useRef('');
  // W121ZNAV145D2: two-step left edge handoff into sports category chip.
  const focusedSportsCard = useRef(-1);
  const [sportsLeftArmed, setSportsLeftArmed] = useState(false);
  const [selectedCategoryTag, setSelectedCategoryTag] = useState<number | undefined>();
  useTVEventHandler((event: any) => {
    if (!isTV || event?.eventType !== "left") return;
    if (focusedSportsCard.current >= 0 && focusedSportsCard.current % 3 === 0) {
      setSportsLeftArmed(true);
    }
  });

  const [addons, setAddons] = useState<Addon[]>([]);
  const [catalogs, setCatalogs] = useState<SportCatalogRef[]>([]);
  const [selectedSportId, setSelectedSportId] = useState('now');
  const [events, setEvents] = useState<SportEvent[]>([]);
  const [loadingAddons, setLoadingAddons] = useState(true);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [errorText, setErrorText] = useState('');

  const availablePresets = useMemo(() => {
    const ids = new Set(catalogs.map((catalog) => catalog.catalogId));
    return SPORT_PRESETS.filter((preset) =>
      preset.catalogIds.some((catalogId) => ids.has(catalogId))
    );
  }, [catalogs]);

  const selectedPreset = useMemo(
    () =>
      availablePresets.find((preset) => preset.id === selectedSportId) ||
      availablePresets[0] ||
      null,
    [availablePresets, selectedSportId]
  );

  const selectedCatalogs = useMemo(() => {
    if (!selectedPreset) return [];
    return catalogs.filter((catalog) =>
      selectedPreset.catalogIds.includes(catalog.catalogId) ||
      (selectedPreset.id !== 'now' && catalog.catalogId === 'sports_other')
    );
  }, [catalogs, selectedPreset]);

  const loadAddons = useCallback(async () => {
    const initial = !didInitialLoad.current;
    if (initial) {
      setLoadingAddons(true);
      setErrorText('');
    }

    try {
      const installed = await api.addons.getAll();
      const safe = Array.isArray(installed) ? installed : [];
      const nextCatalogs = collectCatalogs(safe);
      const signature = sportsCatalogSignature(nextCatalogs);

      // W121ZSPORTS179F: Do not refresh Sports on return from Player when
      // installed sports catalogs are unchanged. Newly installed Premium is
      // detected without clearing focus or rebuilding the existing rail.
      if (!initial && signature === sportsCatalogSignatureRef.current) {
        return;
      }
      sportsCatalogSignatureRef.current = signature;
      setErrorText('');
      setAddons(safe);
      setCatalogs(nextCatalogs);
      console.log('[W121ZSPORTS179F ADDON REGISTRY]',
        'sportsCatalogs=' + nextCatalogs.length,
        'changed=' + !initial);

      const availableCatalogIds = new Set(
        nextCatalogs.map((catalog) => catalog.catalogId)
      );
      const firstAvailable = SPORT_PRESETS.find((preset) =>
        preset.catalogIds.some((catalogId) => availableCatalogIds.has(catalogId))
      );

      setSelectedSportId((previous) => {
        const previousPreset = SPORT_PRESETS.find((preset) => preset.id === previous);
        if (
          previousPreset &&
          previousPreset.catalogIds.some((catalogId) =>
            availableCatalogIds.has(catalogId)
          )
        ) {
          return previous;
        }
        return firstAvailable?.id || 'now';
      });
    } catch (error: any) {
      if (initial) {
        setAddons([]);
        setCatalogs([]);
        setEvents([]);
        setErrorText(
          error?.response?.data?.detail ||
            error?.message ||
            'Could not load installed sports addons.'
        );
      } else {
        // Transient refresh errors must NOT wipe the last working Sports rail.
        console.warn('[W121ZSPORTS179F ADDON REGISTRY]', 'refresh-failed');
      }
    } finally {
      didInitialLoad.current = true;
      if (initial) setLoadingAddons(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      // W121ZSPORTS179F: cheap manifest-only check on focus.  The callback
      // does not set catalog state unless sports addon inventory changed.
      // No media requests and no Player-return card refetch for stable addons.
      void loadAddons();
      return undefined;
    }, [loadAddons])
  );

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (selectedCatalogs.length === 0) {
        setEvents([]);
        return;
      }

      setLoadingCatalog(true);
      setEvents([]); // W121ZLIVE173S: do not display events from the prior category.
      setErrorText('');

      try {
        // W121ZLIVE173S: publish a provider's first *real* catalog page while
        // remaining pages and other providers continue loading. The existing
        // full-page dedupe, pagination caps, and final merge remain authoritative.
        const firstPages = new Map<string, SportEvent[]>();
        const publishFirstPage = (catalog: SportCatalogRef, raw: any[]) => {
          if (cancelled || firstPages.has(catalog.key)) return;
          const normalized = raw
            .map((item: any) => normalizeEvent(item, catalog))
            .filter((event: SportEvent | null): event is SportEvent => !!event);
          firstPages.set(catalog.key, normalized);
          const early = filterEventsForPreset(
            mergeSportEvents(Array.from(firstPages.values()).flat()),
            selectedPreset?.id
          );
          if (early.length > 0) {
            setEvents(early);
            setLoadingCatalog(false);
            console.log('[W121ZLIVE173S SPORTS FIRST PAGE]',
              'catalog=' + catalog.catalogId, 'visible=' + early.length);
          }
        };
        const results = await Promise.allSettled(
          selectedCatalogs.map(async (catalog) => {
            // W121ZSPORTS140I_PROVIDER_PAGINATION
            // Stremio catalog paging uses skip=N. Pull successive pages until
            // the provider returns empty/repeated content, with hard caps so a
            // broken provider cannot create an unbounded request loop.
            const rawItems: any[] = [];
            const seenPageSignatures = new Set<string>();
            const seenIds = new Set<string>();
            let skip = 0;

            for (let page = 0; page < 10 && rawItems.length < 200; page += 1) {
              const result = await api.addons.getCatalog(
                catalog.addonDbId,
                'sport',
                catalog.catalogId,
                skip
              );

              const metas = Array.isArray(result?.metas) ? result.metas : [];
              if (metas.length === 0) break;

              const signature = metas
                .map((raw: any) => String(raw?.id || raw?.name || ''))
                .join('|');
              if (seenPageSignatures.has(signature)) break;
              seenPageSignatures.add(signature);

              let freshCount = 0;
              for (const raw of metas) {
                const rawId = String(raw?.id || '').trim();
                const dedupeKey = rawId || String(raw?.name || '') + '|' + String(raw?.releaseInfo || '');
                if (!dedupeKey || seenIds.has(dedupeKey)) continue;
                seenIds.add(dedupeKey);
                rawItems.push(raw);
                freshCount += 1;
                if (rawItems.length >= 200) break;
              }

              if (page === 0 && freshCount > 0) {
                publishFirstPage(catalog, rawItems);
              }
              if (freshCount === 0 || rawItems.length >= 200) break;
              skip += metas.length;
            }

            return rawItems
              .map((raw: any) => normalizeEvent(raw, catalog))
              .filter((event: SportEvent | null): event is SportEvent => !!event);
          })
        );

        if (cancelled) return;

        const combined: SportEvent[] = [];
        let successCount = 0;

        for (const result of results) {
          if (result.status === 'fulfilled') {
            successCount += 1;
            combined.push(...result.value);
          }
        }

        if (successCount === 0) {
          throw new Error('All installed sports providers failed to load this category.');
        }

        const merged = mergeSportEvents(combined);
        const visible = filterEventsForPreset(merged, selectedPreset?.id);

        setEvents(visible);
      } catch (error: any) {
        if (cancelled) return;
        setEvents([]);
        setErrorText(
          error?.response?.data?.detail ||
            error?.message ||
            'Could not load this sports category.'
        );
      } finally {
        if (!cancelled) setLoadingCatalog(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedCatalogs, selectedPreset?.id]);

  // W121ZSPORTS179G_EVENT_IDENTITY_GUARD
  // Never promote an explicitly different NFL matchup merely because its
  // provider is Premium. Confirm event-specific descriptors before tier.
  const openEvent = useCallback(
    async (event: SportEvent) => {
      try {
        setErrorText('');
        const orderedSources = sortSportsSourcesPremiumFirst(event.sources, addons);
        const expectedTeams = sportsNflTeamNames(event.name);
        const checkNflMatch = isNflEvent(event) && expectedTeams.length === 2;
        const sourceResults = await Promise.allSettled(
          orderedSources.map(async (source) => {
            const [metaResult, streamResult] = await Promise.all([
              api.addons
                .getMeta(source.addonDbId, 'sport', source.eventId)
                .catch(() => ({ meta: null })),
              api.addons.getStreams(source.addonDbId, 'sport', source.eventId),
            ]);
            return {
              source,
              meta: metaResult?.meta || null,
              streams: Array.isArray(streamResult?.streams) ? streamResult.streams : [],
            };
          })
        );

        const candidates: Array<{
          url: string;
          confidence: number;
          premium: boolean;
          order: number;
        }> = [];
        const seenUrls = new Set<string>();
        let rawCount = 0;
        let rejectedOtherGame = 0;
        let namedCandidates = 0;
        let meta: any = null;
        let sourceOrder = 0;

        for (const result of sourceResults) {
          if (result.status !== 'fulfilled') continue;
          rawCount += result.value.streams.length;
          const providerMetaName = String(result.value.meta?.name || result.value.meta?.title || '');
          const metaTeams = checkNflMatch ? sportsNflTeamNames(providerMetaName) : [];
          const wrongMeta = checkNflMatch && metaTeams.some((team) => !expectedTeams.includes(team));
          const premium = isPremiumSportsSource(result.value.source, addons);

          for (const stream of result.value.streams) {
            const url = String(
              (stream as any)?.url ||
                (stream as any)?.externalUrl ||
                (stream as any)?.direct_url ||
                (stream as any)?.directUrl ||
                ''
            ).trim();
            if (!/^https?:\/\//i.test(url)) continue;

            // Provider stream descriptors are safer than a regional-channel
            // assumption. Include URL pathname only for event words; never
            // inspect/log signed query parameters, headers or cookies.
            let pathHint = '';
            try { pathHint = decodeURIComponent(new URL(url).pathname); } catch (_) { /* opaque URL */ }
            const streamDescriptor = [
              (stream as any)?.name,
              (stream as any)?.title,
              (stream as any)?.description,
              (stream as any)?.behaviorHints?.filename,
              pathHint,
            ].map((part) => String(part || '')).join(' ');
            const streamTeams = checkNflMatch ? sportsNflTeamNames(streamDescriptor) : [];
            const wrongStream = checkNflMatch && streamTeams.some((team) => !expectedTeams.includes(team));
            if (wrongMeta || wrongStream) {
              rejectedOtherGame += 1;
              continue;
            }

            let confidence = 0;
            if (checkNflMatch) {
              if (streamTeams.length >= 2) confidence = 3;
              else if (streamTeams.length === 1) confidence = 2;
              else if (metaTeams.length >= 2) confidence = 1;
            }
            if (confidence) namedCandidates += 1;
            candidates.push({ url, confidence, premium, order: sourceOrder++ });
          }
          if (!wrongMeta && !meta && result.value.meta) meta = result.value.meta;
        }

        // Confirmed matching descriptors win over opaque URLs. Within each
        // confidence tier, the accepted 179F Premium-first policy remains.
        candidates.sort((a, b) =>
          b.confidence - a.confidence ||
          Number(b.premium) - Number(a.premium) ||
          a.order - b.order
        );
        const uniqueCandidates = candidates.filter((candidate) => {
          if (seenUrls.has(candidate.url)) return false;
          seenUrls.add(candidate.url);
          return true;
        });
        console.log('[W121ZSPORTS179G MATCH]',
          'event=' + event.id,
          'providers=' + event.sources.length,
          'raw=' + rawCount,
          'matched=' + uniqueCandidates.length,
          'named=' + namedCandidates,
          'rejectedOtherGame=' + rejectedOtherGame,
          'firstConfidence=' + (uniqueCandidates[0]?.confidence ?? -1),
          'firstPremium=' + (uniqueCandidates[0]?.premium ?? false),
          'opaqueUnverifiable=' + (checkNflMatch && namedCandidates === 0)
        );

        if (!uniqueCandidates.length) {
          Alert.alert('Stream Unavailable',
            rejectedOtherGame
              ? 'Available streams identify a different game. Refusing to play the wrong matchup.'
              : 'None of the installed sports providers has a playable stream for this event right now.');
          return;
        }
        const poster = String(meta?.poster || event.poster || '').trim();
        // Event card is the authority for the selected title; a provider meta
        // title may refer to another game or a generic regional network feed.
        const primary = uniqueCandidates[0].url;
        const fallbacks = uniqueCandidates.slice(1).map((candidate) => candidate.url);
        router.push({
          pathname: '/player',
          params: {
            directUrl: primary,
            title: String(event.name || 'Sports Event').trim(),
            poster,
            backdrop: '',
            logo: poster,
            fallbackStreams: fallbacks.length ? JSON.stringify(fallbacks) : '',
          },
        } as any);
      } catch (error: any) {
        console.warn('[W121ZSPORTS179G MATCH] failed', error?.message || error);
        Alert.alert('Sports Event',
          error?.response?.data?.detail ||
          error?.message || 'Could not load a playable stream for this event.');
      }
    },
    [router, addons]
  );

  const hasSportAddon = addons.some(supportsSport);

  return (
    <View style={styles.screen}>
      <PrivastreamPageHeader title="LIVE SPORTS" />

      {hasSportAddon && availablePresets.length > 0 ? (
        <View style={styles.categoryShell}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryRail}
          >
            {availablePresets.map((preset, index) => (
              <SportChip
                key={preset.id}
                preset={preset}
                selected={preset.id === selectedPreset?.id}
                index={index}
                isTV={isTV}
                chipRef={(node: any) => {
                  if (node && preset.id === selectedPreset?.id) {
                    const tag = findNodeHandle(node);
                    if (tag) setSelectedCategoryTag(previous => previous === tag ? previous : tag);
                  }
                }}
                onCategoryFocus={() => { focusedSportsCard.current = -1; setSportsLeftArmed(false); }}
                onPress={() => { setSportsLeftArmed(false); setSelectedSportId(preset.id); }}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.contentArea}>
        {loadingAddons ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.status}>Loading live sports…</Text>
          </View>
        ) : !hasSportAddon ? (
          <View style={styles.center}>
            <Image
              source={require('../../assets/images/livetv-header-icon.png')}
              style={styles.emptyLogo}
              contentFit="contain"
            />
            <Text style={styles.emptyTitle}>No Sports Addon Installed</Text>
            <Text style={styles.emptyText}>
              Install a sports addon from Addons to populate Live Sports.
            </Text>
          </View>
        ) : availablePresets.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>No Sports Categories</Text>
          </View>
        ) : loadingCatalog ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.status}>Loading {repairDisplayText(selectedPreset?.label || 'sports')}…</Text>
          </View>
        ) : events.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>No Events Available</Text>
            {!!errorText && <Text style={styles.errorText}>{repairDisplayText(errorText)}</Text>}
          </View>
        ) : (
          <FlatList
            key={isTV ? 'sports-tv-3' : 'sports-phone-1'}
            data={events}
            numColumns={isTV ? 3 : 1}
            keyExtractor={(event) => `${event.addonDbId}:${event.id}`}
            contentContainerStyle={styles.grid}
            columnWrapperStyle={isTV ? styles.gridRow : undefined}
            renderItem={({ item, index }) => (
              <View style={isTV ? styles.eventCellTV : styles.eventCellPhone}>
                <EventCard
                  event={item}
                  index={index}
                  isTV={isTV}
                  leftArmed={sportsLeftArmed}
                  categoryTag={selectedCategoryTag}
                  onCardFocus={(i) => {
                    if (focusedSportsCard.current !== i) setSportsLeftArmed(false);
                    focusedSportsCard.current = i;
                  }}
                  onCardBlur={(i) => { if (focusedSportsCard.current === i) focusedSportsCard.current = -1; }}
                  onPress={() => void openEvent(item)}
                />
              </View>
            )}
            initialNumToRender={18}
            maxToRenderPerBatch={18}
            windowSize={7}
            removeClippedSubviews={false}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors?.background || '#0c0c0c',
  },

  brandHeader: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 5,
  },

  brandHeaderTV: {
    minHeight: 52,
    paddingTop: 5,
  },

  brandLogo: {
    width: 54,
    height: 40,
    marginRight: 10,
  },

  brandTitle: {
    color: '#B8A05C',
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  brandTitleTV: {
    fontSize: 28,
  },

  categoryShell: {
    height: 50,
    justifyContent: 'center',
  },

  categoryRail: {
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 4,
  },

  sportChip: {
    height: 38,
    minHeight: 38,
    paddingHorizontal: 12,
    marginRight: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#343434',
    backgroundColor: '#171717',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  sportChipSelected: {
    backgroundColor: '#171717',
    borderColor: '#B8A05C',
  },

  sportChipFocused: {
    borderColor: '#B8A05C',
    borderWidth: 3,
    transform: [{ scale: 1.025 }],
  },

  sportChipLogoBox: {
    width: 30,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sportChipLogo: {
    width: 28,
    height: 26,
  },

  sportChipText: {
    color: '#f2f2f2',
    fontSize: 13,
    fontWeight: '700',
  },

  contentArea: {
    flex: 1,
  },

  grid: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 24,
  },

  gridRow: {
    alignItems: 'stretch',
  },

  eventCellTV: {
    flex: 1,
    maxWidth: '33.3333%',
    paddingHorizontal: 6,
    paddingBottom: 12,
  },

  eventCellPhone: {
    width: '100%',
    paddingHorizontal: 6,
    paddingBottom: 12,
  },

  eventCard: {
    width: '100%',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#303030',
    backgroundColor: '#151515',
  },

  eventCardTV: {
    height: 176,
    minHeight: 176,
    maxHeight: 176,
  },

  eventCardFocused: {
    borderColor: '#B8A05C',
  },

  artworkWrap: {
    height: 120,
    minHeight: 120,
    backgroundColor: '#0f0f0f',
    position: 'relative',
    overflow: 'hidden',
  },

  artworkWrapTV: {
    height: 110,
    minHeight: 110,
    maxHeight: 110,
  },

  artwork: {
    width: '100%',
    height: '100%',
  },

  artworkFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  artworkFallbackLogo: {
    width: 72,
    height: 46,
    opacity: 0.8,
  },

  artworkFallbackText: {
    marginTop: 6,
    maxWidth: '88%',
    color: '#d8d8d8',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    textAlign: 'center',
  },

  liveBadge: {
    position: 'absolute',
    left: 9,
    top: 8,
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#d91f26',
  },

  liveBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.3,
  },

  eventInfo: {
    flex: 1,
    paddingHorizontal: 11,
    paddingTop: 6,
    paddingBottom: 7,
    justifyContent: 'center',
  },

  eventTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },

  eventName: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 18,
    paddingRight: 8,
  },

  eventNameTV: {
    fontSize: 16,
    lineHeight: 19,
  },

  releaseInfo: {
    maxWidth: 96,
    color: '#c8c8c8',
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'right',
  },

  provider: {
    color: '#999',
    marginTop: 5,
    fontSize: 11,
    fontWeight: '600',
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },

  status: {
    color: '#aaa',
    marginTop: 14,
    fontSize: 15,
  },

  emptyLogo: {
    width: 92,
    height: 64,
    marginBottom: 4,
  },

  emptyTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 10,
    textAlign: 'center',
  },

  emptyText: {
    color: '#999',
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 560,
    marginTop: 9,
    textAlign: 'center',
  },

  errorText: {
    color: '#ff8f8f',
    marginTop: 12,
    textAlign: 'center',
  },
});

// /W121ZSPORTS134M_ROUTE_MISC_REAL_LOGOS_TAB_LABEL
