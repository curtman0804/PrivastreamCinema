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

const UTC_RELEASE_RE = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s*[^0-9A-Za-z]?\s*(\d{1,2}):(\d{2})\s+UTC$/i;
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

    if (!existing.poster && event.poster) existing.poster = event.poster;
    if (!existing.description && event.description) existing.description = event.description;
    existing.genres = Array.from(new Set([...existing.genres, ...event.genres]));
  }

  return Array.from(merged.values());
};

const supportsSport = (addon: Addon): boolean =>
  stringArray((addon as any)?.manifest?.types)
    .map((value) => value.toLowerCase())
    .includes('sport');

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

  return {
    id,
    name: String(raw.name || raw.title || id).trim(),
    releaseInfo: formatReleaseInfoForDevice(releaseInfoRaw),
    releaseInfoRaw,
    description: String(raw.description || '').trim(),
    poster: String(raw.background || raw.poster || raw.logo || '').trim(),
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
};

function SportChip({
  preset,
  selected,
  onPress,
}: {
  preset: SportPreset;
  selected: boolean;
  index: number;
  isTV: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const showLogo = !!preset.logoUrl && !logoFailed;
  const showMdiIcon = !showLogo && !!preset.mdiIcon;

  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
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
}: {
  event: SportEvent;
  index: number;
  isTV: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      hasTVPreferredFocus={isTV && index === 0}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.eventCard,
        isTV && styles.eventCardTV,
        focused && styles.eventCardFocused,
      ]}
    >
      <View style={[styles.artworkWrap, isTV && styles.artworkWrapTV]}>
        {event.poster ? (
          <Image
            source={{ uri: event.poster }}
            style={styles.artwork}
            contentFit="contain"
          />
        ) : (
          <View style={styles.artworkFallback}>
            <Image
              source={require('../../assets/images/livetv-header-icon.png')}
              style={styles.artworkFallbackLogo}
              contentFit="contain"
            />
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
    if (!didInitialLoad.current) setLoadingAddons(true);
    setErrorText('');

    try {
      const installed = await api.addons.getAll();
      const safe = Array.isArray(installed) ? installed : [];
      const nextCatalogs = collectCatalogs(safe);

      setAddons(safe);
      setCatalogs(nextCatalogs);

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
      setAddons([]);
      setCatalogs([]);
      setEvents([]);
      setErrorText(
        error?.response?.data?.detail ||
          error?.message ||
          'Could not load installed sports addons.'
      );
    } finally {
      didInitialLoad.current = true;
      setLoadingAddons(false);
    }
  }, []);

  useEffect(() => {
    hasSportCatalogsRef.current = catalogs.length > 0;
  }, [catalogs]);

  useFocusEffect(
    useCallback(() => {
      // W121ZSPORTS134L_PRESERVE_RETURN_STATE
      // Returning from /player must not refetch/replace the already-loaded
      // Sports catalog.  This keeps Now Playing/category cards stable and
      // preserves focus instead of visibly reloading the rail.
      if (!didInitialLoad.current || !hasSportCatalogsRef.current) {
        void loadAddons();
      }
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
      setErrorText('');

      try {
        const results = await Promise.allSettled(
          selectedCatalogs.map(async (catalog) => {
            const result = await api.addons.getCatalog(
              catalog.addonDbId,
              'sport',
              catalog.catalogId
            );
            return (result?.metas || [])
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

  // W121ZSPORTS134D_GENERIC_SPORT_PLAYBACK
  const openEvent = useCallback(
    async (event: SportEvent) => {
      try {
        setErrorText('');

        const sourceResults = await Promise.allSettled(
          event.sources.map(async (source) => {
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

        let meta: any = null;
        const urls: string[] = [];
        let rawCount = 0;

        for (const result of sourceResults) {
          if (result.status !== 'fulfilled') continue;
          if (!meta && result.value.meta) meta = result.value.meta;
          rawCount += result.value.streams.length;

          for (const stream of result.value.streams) {
            const url = String(
              (stream as any)?.url ||
                (stream as any)?.externalUrl ||
                (stream as any)?.direct_url ||
                (stream as any)?.directUrl ||
                ''
            ).trim();

            if (/^https?:\/\//i.test(url) && !urls.includes(url)) {
              urls.push(url);
            }
          }
        }

        const name = String(meta?.name || event.name || 'Sports Event').trim();
        const poster = String(meta?.poster || event.poster || '').trim();

        console.log(
          '[W121ZSPORTS134J PLAY]',
          'providers=' + event.sources.length,
          'event=' + event.id,
          'raw=' + rawCount,
          'direct=' + urls.length
        );

        if (!urls.length) {
          Alert.alert(
            'Stream Unavailable',
            'None of your installed sports providers has a playable stream for this event right now.'
          );
          return;
        }

        const primary = urls[0];
        const fallbacks = urls.slice(1);

        router.push({
          pathname: '/player',
          params: {
            directUrl: primary,
            title: name,
            poster,
            backdrop: '',
            logo: poster,
            fallbackStreams: fallbacks.length
              ? JSON.stringify(fallbacks)
              : '',
          },
        } as any);
      } catch (error: any) {
        console.warn(
          '[W121ZSPORTS134J PLAY] failed',
          error?.message || error
        );
        Alert.alert(
          'Sports Event',
          error?.response?.data?.detail ||
            error?.message ||
            'Could not load a playable stream for this event.'
        );
      }
    },
    [router]
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
                onPress={() => setSelectedSportId(preset.id)}
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
    width: 88,
    height: 58,
    opacity: 0.8,
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
