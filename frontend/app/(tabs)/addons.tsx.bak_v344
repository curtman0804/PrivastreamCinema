import { ToSGate, hasAcceptedToS } from '../../src/components/ToSGate';
import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  Pressable,
  Platform,
  Share,
  useWindowDimensions,
  InteractionManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useContentStore } from '../../src/store/contentStore';
import { Addon, api } from '../../src/api/client';
import { Image } from 'expo-image';
import { colors } from '../../src/styles/colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';

// V309_SHORT_SHARE_CODES â€” replaces the V308 PRIVA on-device share code
// with a backend-generated 7-digit numeric code (same UX as the AFTVnews
// Downloader codes the app already supports).  When a user taps Share on
// an installed addon, the app calls POST /api/addons/share-code to mint
// (or fetch the existing) 7-digit code for that manifest URL.  Recipients
// type the 7-digit code into the Share Code field â†’ GET /api/addons/
// resolve-code/<code> returns the URL â†’ addon installs.
const _V309_TAG = 'V309_SHORT_SHARE_CODES';

// V310_DIRECT_URL_SOURCES â€” adds support for direct M3U / M3U8 / HLS / MP4
// URLs as a "Direct Sources" sidecar alongside Stremio addons.  Sources are
// stored on-device in AsyncStorage (Middle Isolation: backend never sees the
// URLs nor what plays).  M3U playlists are parsed client-side into channel
// lists.  Single-stream URLs (HLS .m3u8 with #EXT-X-TARGETDURATION, or .mp4)
// become one-tap direct-play tiles.
const _V310_TAG = 'V310_DIRECT_URL_SOURCES';
const _V310_SAVED_SOURCES_KEY = 'privastream:saved_sources';

type V310SourceType = 'm3u' | 'hls' | 'mp4';
interface V310Channel {
  name: string;
  url: string;
  logo?: string;
  group?: string;
}
interface V310SavedSource {
  id: string;
  type: V310SourceType;
  name: string;
  url: string;
  channels?: V310Channel[]; // present only for type === 'm3u'
  created_at: number;
}

// V310 / V310b â€” extension-first detection.  Now distinguishes .m3u8 (HLS
// single stream â€” most common shape) from .m3u (M3U playlist that needs
// channel parsing).  This avoids the V310a bug where ALL .m3u8 URLs were
// treated as IPTV playlists and "Empty Playlist" was shown when the body
// fetch failed (CORS, etc.).
function _v310DetectByExtension(url: string): V310SourceType | 'unknown' {
  const u = (url || '').toLowerCase();
  if (/\.m3u8(\?|$)/i.test(u)) return 'hls';  // HLS single stream
  if (/\.m3u(\?|$)/i.test(u)) return 'm3u';   // IPTV playlist (no 8)
  if (/\.mp4(\?|$)/i.test(u)) return 'mp4';
  return 'unknown';
}

// HLS single-stream playlists contain #EXT-X-TARGETDURATION or
// #EXT-X-VERSION; M3U playlists do NOT (they contain #EXTINF entries
// followed by http(s) URLs).
function _v310IsHlsStream(text: string): boolean {
  if (!text) return false;
  return /#EXT-X-TARGETDURATION|#EXT-X-VERSION/i.test(text);
}

// Parse an M3U/M3U8 playlist into a list of channels.  Handles the
// common IPTV format:
//   #EXTM3U
//   #EXTINF:-1 tvg-id="..." tvg-logo="https://..." group-title="News",CNN
//   https://stream.example.com/cnn.m3u8
function _v310ParseM3UPlaylist(text: string): V310Channel[] {
  if (!text) return [];
  const out: V310Channel[] = [];
  const lines = text.split(/\r?\n/);
  let pending: { name: string; logo?: string; group?: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const nameMatch = line.match(/,(.+)$/);
      const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
      const groupMatch = line.match(/group-title="([^"]+)"/i);
      pending = {
        name: nameMatch ? nameMatch[1].trim() : 'Unnamed',
        logo: logoMatch ? logoMatch[1] : undefined,
        group: groupMatch ? groupMatch[1] : undefined,
      };
    } else if (!line.startsWith('#') && /^https?:\/\//i.test(line)) {
      if (pending) {
        out.push({ url: line, name: pending.name, logo: pending.logo, group: pending.group });
        pending = null;
      } else {
        // URL without preceding EXTINF â€” use the filename as the name
        const tail = line.split('/').pop() || 'Stream';
        out.push({ name: tail, url: line });
      }
    }
  }
  return out;
}

// AsyncStorage CRUD for saved direct sources
async function _v310LoadSavedSources(): Promise<V310SavedSource[]> {
  try {
    const raw = await AsyncStorage.getItem(_V310_SAVED_SOURCES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s) => s && s.id && s.url && s.type);
  } catch (_) {
    return [];
  }
}
async function _v310PersistSavedSources(sources: V310SavedSource[]): Promise<void> {
  try {
    await AsyncStorage.setItem(_V310_SAVED_SOURCES_KEY, JSON.stringify(sources));
  } catch (_) {
    /* ignore â€” best effort */
  }
}

// Reusable TV-friendly focus button
function FocusButton({ 
  onPress, 
  children, 
  disabled, 
  style, 
  focusedStyle,
}: { 
  onPress: () => void; 
  children: React.ReactNode; 
  disabled?: boolean;
  style?: any;
  focusedStyle?: any;
}) {
  const [isFocused, setIsFocused] = useState(false);
  return (
    <Pressable
      style={[
        style || { padding: 4, borderWidth: 3, borderColor: 'transparent', borderRadius: 8 },
        isFocused && (focusedStyle || { borderColor: colors.primary }),
      ]}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onPress={onPress}
      disabled={disabled}
    >
      {children}
    </Pressable>
  );
}

export default function AddonsScreen() {
  // V326_TOS_GATE - one-time Terms of Service on first Addons entry
  const [_v326TosVisible, _setV326TosVisible] = React.useState(false);
  React.useEffect(() => {
    hasAcceptedToS().then((acked) => { if (!acked) _setV326TosVisible(true); });
  }, []);
  const { addons, isLoadingAddons, fetchAddons, fetchDiscover } = useContentStore();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [addonUrl, setAddonUrl] = useState('');
  const [shortCode, setShortCode] = useState('');
  const [directUrl, setDirectUrl] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [isResolvingCode, setIsResolvingCode] = useState(false);
  const [isLoadingDirectUrl, setIsLoadingDirectUrl] = useState(false);
  const [inputMode, setInputMode] = useState<'url' | 'code' | 'direct'>('code');
  const [deletingAddonId, setDeletingAddonId] = useState<string | null>(null);
  const [addBtnFocused, setAddBtnFocused] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);
  const [directFocused, setDirectFocused] = useState(false);
  const [urlTabFocused, setUrlTabFocused] = useState(false);
  const [codeTabFocused, setCodeTabFocused] = useState(false);
  const [directTabFocused, setDirectTabFocused] = useState(false);
  // V310 â€” saved direct sources (M3U / HLS / MP4) loaded from AsyncStorage
  const [savedSources, setSavedSources] = useState<V310SavedSource[]>([]);
  // V310 â€” channel picker modal for M3U sources with multiple channels
  const [channelPickerData, setChannelPickerData] = useState<V310SavedSource | null>(null);
  // V309 â€” share modal state.  `shareCode` is the 7-digit code fetched from
  // the backend (POST /api/addons/share-code).  No more PRIVA, no more
  // legacy hardcoded numeric map â€” one path to rule them all.
  const [shareModalData, setShareModalData] = useState<{ name: string; url: string; shareCode: string } | null>(null);
  const [isMintingShareCode, setIsMintingShareCode] = useState(false);
  const [shareCopyFocused, setShareCopyFocused] = useState(false);
  const [shareCloseFocused, setShareCloseFocused] = useState(false);
  
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;

  useEffect(() => {
    fetchAddons(true);
    // V310 â€” load saved direct sources from device on mount
    _v310LoadSavedSources().then(setSavedSources);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAddons(true);
    setSavedSources(await _v310LoadSavedSources());
    setRefreshing(false);
  }, []);

  // V310 â€” handle "Direct URL" install: detect by extension, fetch only
  // when we need to parse an M3U playlist or sniff an unknown URL.
  const _v310HandleAddDirectUrl = async () => {
    const u = directUrl.trim();
    if (!u) {
      Alert.alert('Error', 'Please enter a URL');
      return;
    }
    if (!/^https?:\/\//i.test(u)) {
      Alert.alert('Invalid URL', 'URL must start with http:// or https://');
      return;
    }

    setIsLoadingDirectUrl(true);
    try {
      // Step 1: detect by extension
      let detected: V310SourceType | 'unknown' = _v310DetectByExtension(u);
      let bodyText = '';

      // Step 2: only fetch when we MUST parse the body (.m3u IPTV
      // playlist) or sniff an unknown extension.  Skip fetch for .m3u8
      // (HLS single stream) and .mp4 (direct file) â€” extension alone is
      // enough and the fetch would often fail on RN/Firestick due to CORS
      // or unsupported headers.
      if (detected === 'm3u' || detected === 'unknown') {
        try {
          const resp = await fetch(u, { method: 'GET' });
          if (!resp.ok) {
            throw new Error(`Server returned HTTP ${resp.status}`);
          }
          const ctype = (resp.headers.get('content-type') || '').toLowerCase();
          if (ctype.includes('video/mp4') || ctype.includes('application/octet-stream')) {
            detected = 'mp4';
          } else {
            bodyText = await resp.text();
            if (detected === 'unknown') {
              // Sniff body to disambiguate
              if (/^#EXTM3U/m.test(bodyText)) {
                detected = _v310IsHlsStream(bodyText) ? 'hls' : 'm3u';
              } else if (/^https?:\/\//m.test(bodyText)) {
                // Treat as M3U-style line list (just URLs)
                detected = 'm3u';
              }
            }
            // For detected === 'm3u' (from extension), keep bodyText for parsing.
          }
        } catch (e: any) {
          if (detected === 'm3u') {
            Alert.alert(
              'Could Not Fetch Playlist',
              `Failed to download the M3U playlist:\n${e?.message || e}`,
            );
            setIsLoadingDirectUrl(false);
            return;
          }
          // unknown extension AND fetch failed â€” give up
          throw e;
        }
      }

      if (detected === 'unknown') {
        Alert.alert(
          'Unsupported URL',
          'Could not detect the source type.  This tab accepts .m3u/.m3u8 playlists, HLS streams, and .mp4 files.',
        );
        setIsLoadingDirectUrl(false);
        return;
      }

      // Build the saved source
      const id = `src_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const fallbackName = (() => {
        try {
          const p = new URL(u);
          const last = p.pathname.split('/').filter(Boolean).pop() || '';
          return p.hostname.replace(/^www\./i, '') + (last ? '/' + last : '');
        } catch (_) {
          return u.split('/').pop() || 'Direct Source';
        }
      })();

      let saved: V310SavedSource;
      if (detected === 'm3u') {
        const channels = _v310ParseM3UPlaylist(bodyText);
        if (channels.length === 0) {
          Alert.alert('Empty Playlist', 'Could not find any channels in that M3U playlist.');
          setIsLoadingDirectUrl(false);
          return;
        }
        saved = {
          id,
          type: 'm3u',
          name: `M3U â€¢ ${fallbackName} â€¢ ${channels.length} channels`,
          url: u,
          channels,
          created_at: Date.now(),
        };
      } else {
        saved = {
          id,
          type: detected,
          name: `${detected.toUpperCase()} â€¢ ${fallbackName}`,
          url: u,
          created_at: Date.now(),
        };
      }

      const next = [saved, ...savedSources];
      setSavedSources(next);
      await _v310PersistSavedSources(next);

      setShowModal(false);
      setDirectUrl('');
      Alert.alert(
        'Source Saved',
        detected === 'm3u'
          ? `Saved M3U playlist with ${saved.channels?.length || 0} channels`
          : `Saved ${detected.toUpperCase()} stream â€” tap to play`,
      );
    } catch (error: any) {
      const msg = error?.message || 'Failed to load URL';
      Alert.alert('Could Not Add Source', msg);
    } finally {
      setIsLoadingDirectUrl(false);
    }
  };

  // V310 / V310b â€” launch player for a single direct stream.  Pass ONLY
  // directUrl + title.  Omitting isLive avoids the player's live-TV path
  // (which keeps the loader visible until the first frame paints â€” caused
  // flashing/error on VOD MP4s/HLS).  The player auto-detects HLS vs MP4
  // from the URL extension internally.
  const _v310PlayDirectStream = (
    streamUrl: string,
    title: string,
    _isLive: boolean,
  ) => {
    try {
      router.push({
        pathname: '/player',
        params: {
          directUrl: streamUrl,
          title: title || 'Direct Stream',
        },
      } as any);
    } catch (e: any) {
      Alert.alert('Playback Error', e?.message || 'Failed to launch player');
    }
  };

  // V310 â€” handle tap on a saved Direct Source card
  const _v310HandleSourceTap = (src: V310SavedSource) => {
    if (src.type === 'm3u' && src.channels && src.channels.length > 1) {
      setChannelPickerData(src);
      return;
    }
    if (src.type === 'm3u' && src.channels && src.channels.length === 1) {
      // single-channel M3U â€” go straight to player
      const ch = src.channels[0];
      _v310PlayDirectStream(ch.url, ch.name || src.name, /\.m3u8?(\?|$)/i.test(ch.url));
      return;
    }
    if (src.type === 'hls' || src.type === 'mp4') {
      _v310PlayDirectStream(src.url, src.name, src.type === 'hls');
      return;
    }
    Alert.alert('Empty Source', 'This source has no playable streams.');
  };

  // V310 â€” delete a saved direct source
  const _v310HandleDeleteSource = (src: V310SavedSource) => {
    Alert.alert(
      'Remove Source',
      `Remove "${src.name}" from saved sources?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const next = savedSources.filter((s) => s.id !== src.id);
            setSavedSources(next);
            await _v310PersistSavedSources(next);
          },
        },
      ],
    );
  };

  // V309 â€” share-code resolver.  Accepts 6-8 digit numeric codes.  Backend
  // checks MongoDB share-codes table first, then falls back to AFTVnews.
  const handleResolveAndInstall = async () => {
    const code = shortCode.trim();
    if (!code) {
      Alert.alert('Error', 'Please enter a share code');
      return;
    }

    if (!/^[0-9]{6,8}$/.test(code)) {
      Alert.alert(
        'Invalid Code',
        'Share codes are 6-8 digits long (e.g. 8762337). Make sure you have entered the code correctly.',
      );
      return;
    }

    setIsResolvingCode(true);
    try {
      const response = await api.addons.resolveCode(code);
      const resolvedUrl = response.url;
      setIsResolvingCode(false);
      
      // Now install with the resolved URL
      setIsInstalling(true);
      try {
        await api.addons.install(resolvedUrl);
        setShowModal(false);
        setShortCode('');
        // V204_SOFT_REFRESH â€” install: keep posters on screen (soft nuke) and
      // defer the heavy refetch until D-pad interactions settle.
      try { await (useContentStore.getState() as any).nukeDiscoverCache?.(true); } catch (_) {}
      await fetchAddons(true);
      InteractionManager.runAfterInteractions(() => { fetchDiscover(true); });
        Alert.alert('Success', 'Addon installed!');
      } catch (error: any) {
        const msg = error?.response?.data?.detail || error.message || 'Failed to install addon';
        Alert.alert('Install Failed', msg);
      } finally {
        setIsInstalling(false);
      }
    } catch (error: any) {
      setIsResolvingCode(false);
      const msg = error?.response?.data?.detail || error.message || 'Failed to resolve code';
      Alert.alert('Invalid Code', msg);
    }
  };

  // V308_URL_HARDENING â€” validate manifest URLs before attempting install.
  // Accept *.json or */manifest URLs (standard Stremio addon spec).
  // Reject M3U with a clear "coming soon" message (V309 will add M3U support).
  const _v308ValidateManifestUrl = (raw: string): { ok: boolean; reason?: string } => {
    const u = (raw || '').trim().toLowerCase();
    if (!/^https?:\/\//i.test(u)) {
      return { ok: false, reason: 'URL must start with http:// or https://' };
    }
    if (/\.m3u8?(\?|$)/i.test(u)) {
      return { ok: false, reason: 'M3U playlists are not yet supported â€” coming in V309.' };
    }
    // Accept .json endpoints or URLs containing /manifest
    const looksLikeManifest = /\.json($|\?)/i.test(u) || /\/manifest($|[/?])/i.test(u);
    if (!looksLikeManifest) {
      return {
        ok: false,
        reason: 'Expected a Stremio addon manifest URL (must end in .json or contain /manifest).',
      };
    }
    return { ok: true };
  };

  const handleInstallAddon = async () => {
    const urls = addonUrl.split(/[;\n]+/).map(u => u.trim()).filter(Boolean);
    if (urls.length === 0) {
      Alert.alert('Error', 'Please enter at least one manifest URL');
      return;
    }

    // V308 â€” validate every URL up-front so we don't surface a backend 4xx
    // for something we can catch locally.
    const invalid: { url: string; reason: string }[] = [];
    const valid: string[] = [];
    for (const u of urls) {
      const r = _v308ValidateManifestUrl(u);
      if (r.ok) valid.push(u);
      else invalid.push({ url: u, reason: r.reason || 'invalid' });
    }
    if (invalid.length > 0 && valid.length === 0) {
      Alert.alert('Invalid URL', invalid.map(i => `â€¢ ${i.reason}`).join('\n'));
      return;
    }

    setIsInstalling(true);
    let successCount = 0;
    let failCount = invalid.length;

    for (const url of valid) {
      try {
        await api.addons.install(url);
        successCount++;
      } catch (error: any) {
        console.log(`Failed to install ${url}:`, error?.response?.data || error.message);
        failCount++;
      }
    }

    setIsInstalling(false);

    if (successCount > 0) {
      setShowModal(false);
      setAddonUrl('');
      // V204_SOFT_REFRESH â€” install: keep posters on screen (soft nuke) and
      // defer the heavy refetch until D-pad interactions settle.
      try { await (useContentStore.getState() as any).nukeDiscoverCache?.(true); } catch (_) {}
      await fetchAddons(true);
      InteractionManager.runAfterInteractions(() => { fetchDiscover(true); });
    }

    if (failCount > 0) {
      Alert.alert(
        'Installation Results',
        `${successCount} addon(s) installed successfully, ${failCount} failed.`,
      );
    } else if (successCount > 0) {
      Alert.alert('Success', `${successCount} addon(s) installed!`);
    }
  };

  // V187_SHARE_MODAL â€” themed dialog (no more native Alert).
  // V309 â€” share code is generated by the backend (POST /api/addons/share-code).
  // Same URL always yields the same 7-digit code, so spam-tapping Share
  // doesn't proliferate codes.
  const handleShareAddon = async (addon: Addon) => {
    const addonUrl = (addon as any).manifestUrl || addon.url || '';
    const addonName = addon.manifest?.name || 'Addon';
    if (!addonUrl) {
      Alert.alert('No URL', 'This addon does not have a shareable URL.');
      return;
    }
    setIsMintingShareCode(true);
    try {
      const { code } = await api.addons.createShareCode(addonUrl);
      setShareModalData({ name: addonName, url: addonUrl, shareCode: code });
    } catch (error: any) {
      const msg = error?.response?.data?.detail || error.message || 'Could not generate share code';
      Alert.alert('Share Code Error', msg);
    } finally {
      setIsMintingShareCode(false);
    }
  };
  const handleShareConfirm = async () => {
    if (!shareModalData) return;
    const { name, url, shareCode } = shareModalData;
    // V309 â€” clean share message: code first, URL second.
    const shareMessage = `${name}\n\nShare code: ${shareCode}\nManifest URL: ${url}`;
    try {
      await Share.share({ message: shareMessage, title: `Share ${name} Addon` });
    } catch (error) {
      console.log('Share error:', error);
    } finally {
      setShareModalData(null);
    }
  };

  const handleUninstall = (addon: Addon) => {
    Alert.alert(
      'Uninstall Addon',
      `Remove "${addon.manifest?.name || 'addon'}"? This will remove all content from this addon.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Uninstall',
          style: 'destructive',
          onPress: async () => {
            setDeletingAddonId(addon.id);
            try {
              await api.addons.uninstall(addon.id);
              // V204_HARD_REFRESH â€” uninstall: posters vanish instantly, heavy
              // refetch deferred so the Addons screen stays responsive.
              try { await (useContentStore.getState() as any).nukeDiscoverCache?.(); } catch (_) {}
              await fetchAddons(true);
              InteractionManager.runAfterInteractions(() => { fetchDiscover(true); });
            } catch (error: any) {
              Alert.alert('Error', error?.response?.data?.detail || 'Failed to uninstall addon');
            } finally {
              setDeletingAddonId(null);
            }
          },
        },
      ],
    );
  };

  const getAddonIcon = (types?: string[]) => {
    if (!types) return 'extension-puzzle-outline';
    if (types.includes('movie')) return 'film-outline';
    if (types.includes('series')) return 'tv-outline';
    if (types.includes('tv')) return 'radio-outline';
    return 'extension-puzzle-outline';
  };

  const renderAddon = ({ item }: { item: Addon }) => {
    if (!item || !item.manifest) return null;
    
    return (
    <>
      <ToSGate visible={_v326TosVisible} onAccepted={() => _setV326TosVisible(false)} />

      <AddonCard 
        addon={item}
        isTV={isTV}
        onShare={() => handleShareAddon(item)}
        onUninstall={() => handleUninstall(item)}
        isDeleting={deletingAddonId === item.id}
        getAddonIcon={getAddonIcon}
      />
    
    </>
  );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, isTV && styles.headerTV]}>
        <Text style={[styles.headerTitle, isTV && styles.headerTitleTV]}>Addons</Text>
        <Pressable
          style={[styles.addButton, addBtnFocused && styles.addButtonFocused]}
          onFocus={() => setAddBtnFocused(true)}
          onBlur={() => setAddBtnFocused(false)}
          onPress={() => setShowModal(true)}
        >
          <Ionicons name="add" size={24} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Disclaimer */}
      <View style={styles.disclaimer}>
        <Ionicons name="alert-circle" size={22} color={colors.primary} style={{ marginRight: 8, marginTop: 2 }} />
        <Text style={styles.disclaimerText}>
          This app enables third-party addons. All content is provided externally; the app developer assumes no responsibility for its legality, accuracy, or availability.
        </Text>
      </View>

      {/* Addon List */}
      {isLoadingAddons && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading addons...</Text>
        </View>
      ) : addons.length === 0 && savedSources.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="extension-puzzle-outline" size={64} color={colors.primary} />
          <Text style={styles.emptyTitle}>No Addons Installed</Text>
          <Text style={styles.emptySubtitle}>Install addons to start streaming</Text>
          <FocusButton
            onPress={() => setShowModal(true)}
            style={styles.installButton}
            focusedStyle={styles.installButtonFocused}
          >
            <Ionicons name="extension-puzzle" size={20} color={colors.primary} />
            <Text style={styles.installButtonText}>Install Addon</Text>
          </FocusButton>
        </View>
      ) : (
        <FlatList
          data={addons}
          renderItem={renderAddon}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            savedSources.length > 0 ? (
              <View style={styles.directSourcesSection}>
                <Text style={styles.directSourcesHeading}>Direct Sources</Text>
                {savedSources.map((src) => (
                  <V310DirectSourceCard
                    key={src.id}
                    src={src}
                    onPress={() => _v310HandleSourceTap(src)}
                    onDelete={() => _v310HandleDeleteSource(src)}
                  />
                ))}
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}

      {/* Install Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isTV && styles.modalContentTV]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Install Addon</Text>
              <FocusButton onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </FocusButton>
            </View>

            {/* V309 â€” share code helper strip in the install modal */}
            <View style={styles.privacyStrip}>
              <Ionicons name="keypad-outline" size={16} color={colors.primary} style={{ marginRight: 6 }} />
              <Text style={styles.privacyStripText}>
                Got a 7-digit code from another user? Paste it below to install.
              </Text>
            </View>

            {/* Tab switcher */}
            <View style={styles.tabRow}>
              <Pressable
                style={[
                  styles.tab,
                  inputMode === 'code' && styles.tabActive,
                  codeTabFocused && styles.tabFocused,
                ]}
                onFocus={() => setCodeTabFocused(true)}
                onBlur={() => setCodeTabFocused(false)}
                onPress={() => setInputMode('code')}
              >
                <Ionicons name="keypad-outline" size={18} color={inputMode === 'code' ? colors.primary : '#888888'} />
                <Text style={[styles.tabText, inputMode === 'code' && styles.tabTextActive]}>Share Code</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.tab,
                  inputMode === 'url' && styles.tabActive,
                  urlTabFocused && styles.tabFocused,
                ]}
                onFocus={() => setUrlTabFocused(true)}
                onBlur={() => setUrlTabFocused(false)}
                onPress={() => setInputMode('url')}
              >
                <Ionicons name="link-outline" size={18} color={inputMode === 'url' ? colors.primary : '#888888'} />
                <Text style={[styles.tabText, inputMode === 'url' && styles.tabTextActive]}>Manifest URL</Text>
              </Pressable>
              {/* V310 â€” Direct URL tab for M3U / HLS / MP4 */}
              <Pressable
                style={[
                  styles.tab,
                  inputMode === 'direct' && styles.tabActive,
                  directTabFocused && styles.tabFocused,
                ]}
                onFocus={() => setDirectTabFocused(true)}
                onBlur={() => setDirectTabFocused(false)}
                onPress={() => setInputMode('direct')}
              >
                <Ionicons name="play-circle-outline" size={18} color={inputMode === 'direct' ? colors.primary : '#888888'} />
                <Text style={[styles.tabText, inputMode === 'direct' && styles.tabTextActive]}>Direct URL</Text>
              </Pressable>
            </View>

            {inputMode === 'direct' ? (
              <>
                {/* V310 â€” Direct URL tab: accept M3U/M3U8/HLS/MP4 */}
                <Text style={styles.modalLabel}>Direct URL</Text>
                <TextInput
                  style={[styles.modalInput, directFocused && styles.modalInputFocused]}
                  placeholder="https://example.com/playlist.m3u or stream.m3u8 or video.mp4"
                  placeholderTextColor="#666666"
                  value={directUrl}
                  onChangeText={setDirectUrl}
                  onFocus={() => setDirectFocused(true)}
                  onBlur={() => setDirectFocused(false)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline={true}
                  numberOfLines={3}
                />
                <Text style={styles.modalHint}>
                  M3U playlists are parsed into channel lists. HLS (.m3u8) and MP4 URLs play directly. Sources are stored on this device only.
                </Text>
                <FocusButton
                  onPress={_v310HandleAddDirectUrl}
                  disabled={isLoadingDirectUrl}
                  style={[styles.modalButton, isLoadingDirectUrl && styles.modalButtonDisabled]}
                  focusedStyle={styles.modalButtonFocused}
                >
                  {isLoadingDirectUrl ? (
                    <View style={styles.buttonRow}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.modalButtonText}>  Loading...</Text>
                    </View>
                  ) : (
                    <Text style={styles.modalButtonText}>Add Source</Text>
                  )}
                </FocusButton>
              </>
            ) : inputMode === 'code' ? (
              <>
                <Text style={styles.modalLabel}>Share Code</Text>
                <TextInput
                  style={[styles.modalInput, codeFocused && styles.modalInputFocused]}
                  /* V309 â€” 7-digit codes generated by POST /api/addons/share-code
                     Legacy AFTVnews codes (e.g. 8762337 Cinemeta) still resolve. */
                  placeholder="e.g. 1234567"
                  placeholderTextColor="#666666"
                  value={shortCode}
                  onChangeText={setShortCode}
                  onFocus={() => setCodeFocused(true)}
                  onBlur={() => setCodeFocused(false)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="number-pad"
                  maxLength={8}
                />
                <Text style={styles.modalHint}>
                  Enter a 6-8 digit share code from another PrivaStream user (or a legacy AFTVnews Downloader code).
                </Text>
                <FocusButton 
                  onPress={handleResolveAndInstall} 
                  disabled={isInstalling || isResolvingCode}
                  style={[styles.modalButton, (isInstalling || isResolvingCode) && styles.modalButtonDisabled]}
                  focusedStyle={styles.modalButtonFocused}
                >
                  {isResolvingCode ? (
                    <View style={styles.buttonRow}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.modalButtonText}>  Resolving code...</Text>
                    </View>
                  ) : isInstalling ? (
                    <View style={styles.buttonRow}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.modalButtonText}>  Installing...</Text>
                    </View>
                  ) : (
                    <Text style={styles.modalButtonText}>Install</Text>
                  )}
                </FocusButton>
              </>
            ) : (
              <>
                <Text style={styles.modalLabel}>Manifest URL</Text>
                <TextInput
                  style={[styles.modalInput, inputFocused && styles.modalInputFocused]}
                  /* V182_LEGAL_EXAMPLE â€” Cinemeta (Stremio first-party metadata addon, 100% legal). */
                  placeholder="https://v3-cinemeta.strem.io/manifest.json"
                  placeholderTextColor="#666666"
                  value={addonUrl}
                  onChangeText={setAddonUrl}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline={true}
                  numberOfLines={3}
                />
                <Text style={styles.modalHint}>
                  Paste a Stremio addon manifest URL (must end in .json or contain /manifest). Multiple URLs: separate with semicolon or new line.
                </Text>
                <FocusButton 
                  onPress={handleInstallAddon} 
                  disabled={isInstalling}
                  style={[styles.modalButton, isInstalling && styles.modalButtonDisabled]}
                  focusedStyle={styles.modalButtonFocused}
                >
                  {isInstalling ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text style={styles.modalButtonText}>Install</Text>
                  )}
                </FocusButton>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* V187_SHARE_MODAL â€” themed Share dialog (dark/gold like the rest of the app) */}
      {/* V309 â€” single 7-digit share code (backend-minted), no PRIVA, no dual legacy code surface */}
      <Modal
        visible={shareModalData != null}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShareModalData(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isTV && styles.modalContentTV, { borderWidth: 2, borderColor: colors.primary }]}>
            <View style={styles.modalHeader}>
              {/* V188_SHARE_NOX â€” bottom Close button is enough; remove redundant X */}
              <Text style={styles.modalTitle}>Share {shareModalData?.name || 'Addon'}</Text>
            </View>

            {/* V309 â€” primary 7-digit share code (big, centered, gold) */}
            {shareModalData?.shareCode ? (
              <>
                <Text style={styles.modalLabel}>Share Code</Text>
                <View style={[styles.modalInput, { minHeight: 0, paddingVertical: 18 }]}>
                  <Text
                    selectable={true}
                    style={{ color: colors.primary, fontSize: 32, fontWeight: '800', letterSpacing: 6, textAlign: 'center' }}
                  >
                    {shareModalData.shareCode}
                  </Text>
                </View>
                <View style={{ height: 12 }} />
              </>
            ) : null}

            <Text style={styles.modalLabel}>Manifest URL</Text>
            <View style={[styles.modalInput, { minHeight: 0, paddingVertical: 14 }]}>
              <Text style={{ color: '#FFFFFF', fontSize: 13 }} selectable={true}>
                {shareModalData?.url || ''}
              </Text>
            </View>
            <Text style={styles.modalHint}>
              {/* V309 â€” recipients paste the 7-digit code (or the URL) into the Addons section to install */}
              Recipient can paste the share code or manifest URL into the Addons section of PrivaStream to install this addon.
            </Text>

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable
                onPress={handleShareConfirm}
                onFocus={() => setShareCopyFocused(true)}
                onBlur={() => setShareCopyFocused(false)}
                style={[styles.modalButton, { flex: 1 }, shareCopyFocused && styles.modalButtonFocused]}
              >
                <View style={styles.buttonRow}>
                  <Ionicons name="share-outline" size={18} color={colors.primary} />
                  <Text style={[styles.modalButtonText, { marginLeft: 8 }]}>Copy & Share</Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => setShareModalData(null)}
                onFocus={() => setShareCloseFocused(true)}
                onBlur={() => setShareCloseFocused(false)}
                style={[styles.modalButton, { flex: 1, backgroundColor: '#2A2A2E' }, shareCloseFocused && styles.modalButtonFocused]}
              >
                <Text style={[styles.modalButtonText, { color: '#AAAAAA' }]}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* V310 â€” Channel Picker Modal (M3U with multiple channels) */}
      <Modal
        visible={channelPickerData != null}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setChannelPickerData(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isTV && styles.modalContentTV, { maxHeight: '85%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {channelPickerData?.name || 'Channels'}
              </Text>
              <FocusButton onPress={() => setChannelPickerData(null)}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </FocusButton>
            </View>
            <FlatList
              data={channelPickerData?.channels || []}
              keyExtractor={(item, idx) => `${item.url}_${idx}`}
              renderItem={({ item }) => (
                <V310ChannelRow
                  channel={item}
                  onPress={() => {
                    const isLive = /\.m3u8?(\?|$)/i.test(item.url);
                    setChannelPickerData(null);
                    setTimeout(() => _v310PlayDirectStream(item.url, item.name, isLive), 80);
                  }}
                />
              )}
              ListEmptyComponent={
                <Text style={[styles.modalHint, { textAlign: 'center', marginTop: 40 }]}>
                  No channels in this playlist.
                </Text>
              }
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// Addon Card Component
function AddonCard({ 
  addon, 
  isTV, 
  onShare, 
  onUninstall, 
  isDeleting,
  getAddonIcon,
}: {
  addon: Addon;
  isTV: boolean;
  onShare: () => void;
  onUninstall: () => void;
  isDeleting: boolean;
  getAddonIcon: (types?: string[]) => string;
}) {
  const [shareFocused, setShareFocused] = useState(false);
  const [trashFocused, setTrashFocused] = useState(false);

  return (
    <View style={styles.addonCard}>
      <View style={styles.addonIconContainer}>
        {addon.manifest.logo ? (
          <Image
            source={{ uri: addon.manifest.logo }}
            style={styles.addonLogo}
            contentFit="contain"
          />
        ) : (
          <Ionicons
            name={getAddonIcon(addon.manifest.types) as any}
            size={28}
            color={colors.primary}
          />
        )}
      </View>
      <View style={styles.addonInfo}>
        <Text style={styles.addonName}>{addon.manifest.name || 'Unknown Addon'}</Text>
        <Text style={styles.addonVersion}>v{addon.manifest.version || '?'}</Text>
        <Text style={styles.addonDescription} numberOfLines={2}>
          {addon.manifest.description || 'No description'}
        </Text>
        <View style={styles.addonTypes}>
          {(addon.manifest.types || []).map((type, index) => (
            <View key={index} style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>{type}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.addonActions}>
        <Pressable 
          style={[styles.actionButton, shareFocused && styles.actionButtonFocused]}
          onFocus={() => setShareFocused(true)}
          onBlur={() => setShareFocused(false)}
          onPress={onShare}
        >
          <Ionicons name="share-outline" size={22} color={shareFocused ? colors.primary : '#888888'} />
        </Pressable>
        <Pressable 
          style={[styles.actionButton, trashFocused && styles.actionButtonFocused]}
          onFocus={() => setTrashFocused(true)}
          onBlur={() => setTrashFocused(false)}
          onPress={onUninstall} 
          disabled={isDeleting}
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color={colors.error} />
          ) : (
            <Ionicons name="trash-outline" size={22} color="#FF4444" />
          )}
        </Pressable>
      </View>
    </View>
  );
}

// V310 â€” Direct Source Card (M3U / HLS / MP4 saved on device)
function V310DirectSourceCard({
  src,
  onPress,
  onDelete,
}: {
  src: V310SavedSource;
  onPress: () => void;
  onDelete: () => void;
}) {
  const [pressFocused, setPressFocused] = useState(false);
  const [delFocused, setDelFocused] = useState(false);
  const typeColor = src.type === 'm3u' ? '#7BB0FF' : src.type === 'hls' ? '#FFB870' : '#9FE7B0';
  const iconName: any =
    src.type === 'm3u' ? 'list-outline' : src.type === 'hls' ? 'radio-outline' : 'film-outline';
  return (
    <View style={styles.addonCard}>
      <Pressable
        style={[styles.addonCardBody, pressFocused && styles.addonCardBodyFocused]}
        onFocus={() => setPressFocused(true)}
        onBlur={() => setPressFocused(false)}
        onPress={onPress}
      >
        <View style={[styles.addonIconContainer, { backgroundColor: 'rgba(184,160,92,0.10)' }]}>
          <Ionicons name={iconName} size={28} color={typeColor} />
        </View>
        <View style={styles.addonInfo}>
          <Text style={styles.addonName} numberOfLines={2}>{src.name}</Text>
          <View style={[styles.addonTypes, { marginTop: 6 }]}>
            <View style={[styles.typeBadge, { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
              <Text style={[styles.typeBadgeText, { color: typeColor }]}>{src.type.toUpperCase()}</Text>
            </View>
            {src.type === 'm3u' && src.channels ? (
              <View style={[styles.typeBadge, { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
                <Text style={[styles.typeBadgeText, { color: colors.primary }]}>
                  {src.channels.length} channels
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
      <View style={styles.addonActions}>
        <Pressable
          style={[styles.actionButton, delFocused && styles.actionButtonFocused]}
          onFocus={() => setDelFocused(true)}
          onBlur={() => setDelFocused(false)}
          onPress={onDelete}
        >
          <Ionicons name="trash-outline" size={22} color="#FF4444" />
        </Pressable>
      </View>
    </View>
  );
}

// V310 â€” single Channel row inside the channel picker modal
function V310ChannelRow({
  channel,
  onPress,
}: {
  channel: V310Channel;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      style={[styles.channelRow, focused && styles.channelRowFocused]}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
    >
      {channel.logo ? (
        <Image source={{ uri: channel.logo }} style={styles.channelLogo} contentFit="contain" />
      ) : (
        <View style={styles.channelLogoFallback}>
          <Ionicons name="play" size={18} color={colors.primary} />
        </View>
      )}
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.channelName} numberOfLines={1}>
          {channel.name || channel.url}
        </Text>
        {channel.group ? (
          <Text style={styles.channelGroup} numberOfLines={1}>{channel.group}</Text>
        ) : null}
      </View>
      <Ionicons name="play-circle" size={28} color={focused ? colors.primary : '#666'} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerTV: {
    paddingHorizontal: 40,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.primary,
  },
  headerTitleTV: {
    fontSize: 32,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#888888',
  },
  addButtonFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(184, 160, 92, 0.15)',
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  disclaimerText: {
    flex: 1,
    fontSize: 17,
    color: colors.primary,
    lineHeight: 24,
    fontWeight: '800',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: colors.textMuted,
    marginTop: 12,
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.primary,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.primary,
    textAlign: 'center',
    marginTop: 8,
  },
  installButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 24,
    gap: 8,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  installButtonFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(184, 160, 92, 0.15)',
  },
  installButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
  },
  addonCard: {
    flexDirection: 'row',
    backgroundColor: colors.backgroundLight,
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  addonIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  addonLogo: {
    width: 32,
    height: 32,
    borderRadius: 4,
  },
  addonInfo: {
    flex: 1,
  },
  addonName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  addonVersion: {
    fontSize: 12,
    color: '#888888',
    marginTop: 2,
  },
  addonDescription: {
    fontSize: 13,
    color: '#AAAAAA',
    marginTop: 4,
  },
  addonTypes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    gap: 6,
  },
  typeBadge: {
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 11,
    color: colors.primary,
    textTransform: 'capitalize',
  },
  addonActions: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  actionButton: {
    padding: 10,
    borderWidth: 3,
    borderColor: 'transparent',
    borderRadius: 10,
  },
  actionButtonFocused: {
    borderColor: colors.primary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
  },
  modalContent: {
    backgroundColor: '#1E1E22',
    borderRadius: 16,
    padding: 24,
    marginHorizontal: 20,
  },
  modalContentTV: {
    marginHorizontal: 150,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  modalLabel: {
    fontSize: 14,
    color: '#AAAAAA',
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: '#2A2A2E',
    borderRadius: 8,
    padding: 14,
    color: '#FFFFFF',
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  modalInputFocused: {
    borderColor: colors.primary,
  },
  modalHint: {
    fontSize: 12,
    color: '#666666',
    marginTop: 8,
    marginBottom: 20,
  },
  modalButton: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  modalButtonDisabled: {
    opacity: 0.6,
  },
  modalButtonFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(184, 160, 92, 0.15)',
  },
  modalButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  tabRow: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2A2A2E',
    gap: 6,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  tabActive: {
    backgroundColor: 'rgba(184, 160, 92, 0.15)',
    borderColor: colors.primary,
  },
  tabFocused: {
    borderColor: colors.primary,
  },
  tabText: {
    fontSize: 13,
    color: '#888888',
    fontWeight: '600',
  },
  tabTextActive: {
    color: colors.primary,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // V308 â€” Middle Isolation privacy posture strip in the install modal
  privacyStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(184, 160, 92, 0.08)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(184, 160, 92, 0.25)',
  },
  privacyStripText: {
    flex: 1,
    fontSize: 11,
    color: colors.primary,
    fontWeight: '600',
  },
  // V310 â€” Direct Sources section + cards + channel picker
  directSourcesSection: {
    marginBottom: 16,
  },
  directSourcesHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 10,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  addonCardBody: {
    flex: 1,
    flexDirection: 'row',
    borderWidth: 3,
    borderColor: 'transparent',
    borderRadius: 8,
  },
  addonCardBodyFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(184, 160, 92, 0.10)',
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
    backgroundColor: '#2A2A2E',
    borderRadius: 8,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  channelRowFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(184, 160, 92, 0.15)',
  },
  channelLogo: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: '#1A1A1E',
  },
  channelLogoFallback: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: '#1A1A1E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  channelName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  channelGroup: {
    fontSize: 11,
    color: '#888888',
    marginTop: 2,
  },
});
