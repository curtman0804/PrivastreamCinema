// ============================================================
// V288_PRIVACY_SETTINGS_BLOCK — sync-aware, no modal, TV focus
// ============================================================
// Replaces v286.  Identical UI; adds cross-device sync:
//   - On mount: pulls key from /api/user/settings if local is empty
//   - On validate success: pushes key to backend  (handled in client)
//   - On Disconnect: wipes local AND backend
//   - Status row shows "Synced across your devices" when connected
//
// Save as:
//   src/components/PrivacySettingsBlock.tsx
// ============================================================

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  validateKey,
  setClientSideStreamsEnabled,
  trySyncFromBackend,
  deleteKeyOnBackend,
  resetSyncFlag,
} from '../services/premiumizeClient';

const KEY_STORAGE = '@pm_key_v1';
const ACCENT = '#B8A05C';

export function PrivacySettingsBlock() {
  const [savedKey, setSavedKey] = useState('');
  const [draftKey, setDraftKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [keyUsername, setKeyUsername] = useState<string | null>(null);
  const [premiumUntil, setPremiumUntil] = useState<number | null>(null);
  const [validating, setValidating] = useState(false);
  const [syncing, setSyncing] = useState(true);

  const [inputFocused, setInputFocused] = useState(false);
  const [connectFocused, setConnectFocused] = useState(false);
  const [disconnectFocused, setDisconnectFocused] = useState(false);

  // Force client-side resolution ON every boot, then sync from backend
  // before reading local key.
  useEffect(() => {
    (async () => {
      try { await setClientSideStreamsEnabled(true); } catch (_) {}
      try {
        // Lazy-pull from server if local is empty.  Falls back to local.
        const synced = await trySyncFromBackend();
        const k = synced.key || (await AsyncStorage.getItem(KEY_STORAGE));
        if (k) {
          setSavedKey(k);
          setKeySaved(true);
        }
      } catch (_) {}
      setSyncing(false);
    })();
  }, []);

  const showAlert = (title: string, msg: string) => {
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      window.alert(`${title}\n\n${msg}`);
    } else {
      Alert.alert(title, msg);
    }
  };

  const confirmDestructive = (title: string, msg: string, onYes: () => void) => {
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (window.confirm(`${title}\n\n${msg}`)) onYes();
    } else {
      Alert.alert(title, msg, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: onYes },
      ]);
    }
  };

  const onConnect = async () => {
    const trimmed = draftKey.trim();
    if (!trimmed) {
      showAlert('Premiumize', 'Type or paste your API key first.');
      return;
    }
    setValidating(true);
    try {
      const res = await validateKey(trimmed);   // also pushes to backend on success
      if (!res.valid) {
        showAlert('Premiumize', 'That key was rejected by Premiumize. Double-check at premiumize.me/account.');
        setValidating(false);
        return;
      }
      await AsyncStorage.setItem(KEY_STORAGE, trimmed);
      setSavedKey(trimmed);
      setKeySaved(true);
      setKeyUsername(res.username || null);
      setPremiumUntil(res.premium_until || null);
      setDraftKey('');
      setValidating(false);
    } catch (e: any) {
      setValidating(false);
      showAlert('Premiumize', 'Network error: ' + String(e?.message || e));
    }
  };

  const onDisconnect = () => {
    confirmDestructive(
      'Disconnect Premiumize?',
      'Your key will be removed from this device AND from your other devices. Streams will stop working until you reconnect.',
      async () => {
        try { await AsyncStorage.removeItem(KEY_STORAGE); } catch (_) {}
        try { await deleteKeyOnBackend(); } catch (_) {}
        resetSyncFlag();
        setSavedKey('');
        setDraftKey('');
        setKeySaved(false);
        setKeyUsername(null);
        setPremiumUntil(null);
      }
    );
  };

  const expiryText = (() => {
    if (!premiumUntil) return null;
    try {
      const d = new Date(premiumUntil * 1000);
      return `Premium until ${d.toLocaleDateString()}`;
    } catch (_) { return null; }
  })();

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.iconCircle}>
          <Ionicons name="key" size={20} color={ACCENT} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Premiumize</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, keySaved ? styles.statusDotOn : styles.statusDotOff]} />
            <Text style={styles.statusText}>
              {syncing ? 'Syncing…' : keySaved
                ? (keyUsername ? `Connected · ${keyUsername}` : 'Connected')
                : 'Not connected'}
            </Text>
          </View>
          {keySaved && expiryText ? (
            <Text style={styles.statusSub}>{expiryText} · Synced across your devices</Text>
          ) : keySaved ? (
            <Text style={styles.statusSub}>Synced across your devices</Text>
          ) : !syncing ? (
            <Text style={styles.statusSub}>Required to play any stream. Enter once, syncs everywhere.</Text>
          ) : null}
        </View>
      </View>

      {keySaved ? (
        <Pressable
          style={[styles.btnGhost, disconnectFocused && styles.btnGhostFocused]}
          onPress={onDisconnect}
          onFocus={() => setDisconnectFocused(true)}
          onBlur={() => setDisconnectFocused(false)}
        >
          <Text style={[styles.btnGhostText, disconnectFocused && styles.btnGhostTextFocused]}>
            Disconnect
          </Text>
        </Pressable>
      ) : !syncing ? (
        <>
          <Text style={styles.label}>API Key</Text>
          <TextInput
            style={[styles.input, inputFocused && styles.inputFocused]}
            value={draftKey}
            onChangeText={setDraftKey}
            placeholder="Paste or type your Premiumize API key"
            placeholderTextColor="#666"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!validating}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            returnKeyType="done"
          />
          <Text style={styles.hint}>
            Get yours at premiumize.me/account on a phone or PC. Enter it once — every device on your account picks it up automatically.
          </Text>

          <Pressable
            style={[
              styles.btnPrimary,
              connectFocused && styles.btnPrimaryFocused,
              validating && styles.btnDisabled,
            ]}
            onPress={onConnect}
            disabled={validating}
            onFocus={() => setConnectFocused(true)}
            onBlur={() => setConnectFocused(false)}
          >
            {validating ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text style={styles.btnPrimaryText}>Connect Premiumize</Text>
            )}
          </Pressable>
        </>
      ) : (
        <View style={styles.syncingBox}>
          <ActivityIndicator size="small" color={ACCENT} />
          <Text style={styles.syncingText}>Checking your account…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 8, padding: 16, backgroundColor: '#1a1a1a', borderRadius: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  iconCircle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(184, 160, 92, 0.15)',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  cardTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statusDotOn: { backgroundColor: '#7CFF8A' },
  statusDotOff: { backgroundColor: '#666' },
  statusText: { color: '#CCCCCC', fontSize: 13 },
  statusSub: { color: '#888', fontSize: 12, marginTop: 2 },

  syncingBox: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 12, justifyContent: 'center' },
  syncingText: { color: '#888', fontSize: 13 },

  label: { color: '#FFF', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: '#0c0c0c', color: '#FFF', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 14,
    marginBottom: 8, borderWidth: 3, borderColor: '#333', minHeight: 48,
  },
  inputFocused: { borderColor: ACCENT, backgroundColor: '#1a1408' },
  hint: { color: '#777', fontSize: 12, marginBottom: 14 },

  btnPrimary: {
    backgroundColor: ACCENT, paddingVertical: 14, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', minHeight: 48,
    borderWidth: 3, borderColor: 'transparent',
  },
  btnPrimaryFocused: { borderColor: '#FFF', transform: [{ scale: 1.02 }] },
  btnPrimaryText: { color: '#000', fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.6 },

  btnGhost: {
    paddingVertical: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    minHeight: 44, borderWidth: 3, borderColor: 'transparent', backgroundColor: 'transparent',
  },
  btnGhostFocused: { borderColor: ACCENT, backgroundColor: 'rgba(184, 160, 92, 0.12)' },
  btnGhostText: { color: '#888', fontSize: 14, fontWeight: '600' },
  btnGhostTextFocused: { color: ACCENT },
});
