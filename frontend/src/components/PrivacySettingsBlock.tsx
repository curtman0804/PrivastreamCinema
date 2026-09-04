// V509_PREMIUMIZE_PROFILE_PROVISIONING
// API key entry remains available in Profile, but credentials are stored and used server-side only.
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
import { Ionicons } from '@expo/vector-icons';
import {
  configurePremiumize,
  disconnectPremiumize,
  isPremiumizeConfigured,
  clearCache,
  setClientSideStreamsEnabled,
} from '../services/premiumizeClient';

const ACCENT = '#B8A05C';

export function PrivacySettingsBlock() {
  const [draftKey, setDraftKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [keyUsername, setKeyUsername] = useState<string | null>(null);
  const [premiumUntil, setPremiumUntil] = useState<number | null>(null);
  const [validating, setValidating] = useState(false);
  const [syncing, setSyncing] = useState(true);
  const [inputFocused, setInputFocused] = useState(false);
  const [connectFocused, setConnectFocused] = useState(false);
  const [disconnectFocused, setDisconnectFocused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { await setClientSideStreamsEnabled(true); } catch (_) {}
      try {
        const configured = await isPremiumizeConfigured();
        if (!cancelled) setKeySaved(configured);
      } catch (_) {}
      if (!cancelled) setSyncing(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const showAlert = (title: string, msg: string) => {
    if (Platform.OS === 'web') {
      window.alert(title + '\n\n' + msg);
    } else {
      Alert.alert(title, msg);
    }
  };

  const confirmDestructive = (title: string, msg: string, onYes: () => void) => {
    if (Platform.OS === 'web') {
      if (window.confirm(title + '\n\n' + msg)) onYes();
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
      showAlert('Premiumize', 'Type or paste the Premiumize API key first.');
      return;
    }
    setValidating(true);
    try {
      const res = await configurePremiumize(trimmed);
      if (!res.configured) {
        showAlert('Premiumize', 'Premiumize could not be configured for this account.');
        return;
      }
      setKeySaved(true);
      setKeyUsername(res.username || null);
      setPremiumUntil(res.premium_until || null);
      setDraftKey('');
      await clearCache().catch(() => 0);
    } catch (e: any) {
      showAlert('Premiumize', String(e?.message || e));
    } finally {
      setValidating(false);
    }
  };

  const onDisconnect = () => {
    confirmDestructive(
      'Disconnect Premiumize?',
      'Premiumize will be removed from this Privastream account. Streams requiring Premiumize will stop working until another key is configured.',
      async () => {
        try {
          await disconnectPremiumize();
          await clearCache().catch(() => 0);
          setKeySaved(false);
          setDraftKey('');
          setKeyUsername(null);
          setPremiumUntil(null);
        } catch (e: any) {
          showAlert('Premiumize', String(e?.message || e));
        }
      }
    );
  };

  const expiryText = (() => {
    if (!premiumUntil) return null;
    try {
      const d = new Date(premiumUntil * 1000);
      return 'Premium until ' + d.toLocaleDateString();
    } catch (_) { return null; }
  })();

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.iconCircle}>
          <Ionicons name='key' size={20} color={ACCENT} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Premiumize</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, keySaved ? styles.statusDotOn : styles.statusDotOff]} />
            <Text style={styles.statusText}>
              {syncing ? 'Checking account…' : keySaved
                ? (keyUsername ? 'Connected · ' + keyUsername : 'Connected')
                : 'Not configured'}
            </Text>
          </View>
          {keySaved && expiryText ? (
            <Text style={styles.statusSub}>{expiryText} · Securely stored with this Privastream account</Text>
          ) : keySaved ? (
            <Text style={styles.statusSub}>Securely stored with this Privastream account</Text>
          ) : !syncing ? (
            <Text style={styles.statusSub}>Enter the Premiumize key to provision this Privastream account.</Text>
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
          <Text style={[styles.btnGhostText, disconnectFocused && styles.btnGhostTextFocused]}>Disconnect</Text>
        </Pressable>
      ) : !syncing ? (
        <>
          <Text style={styles.label}>API Key</Text>
          <TextInput
            style={[styles.input, inputFocused && styles.inputFocused]}
            value={draftKey}
            onChangeText={setDraftKey}
            placeholder='Paste or type the Premiumize API key'
            placeholderTextColor='#666'
            autoCapitalize='none'
            autoCorrect={false}
            secureTextEntry={true}
            editable={!validating}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            returnKeyType='done'
          />
          <Text style={styles.hint}>The key is sent securely to Privastream and is not stored on this device.</Text>
          <Pressable
            style={[styles.btnPrimary, connectFocused && styles.btnPrimaryFocused, validating && styles.btnDisabled]}
            onPress={onConnect}
            disabled={validating}
            onFocus={() => setConnectFocused(true)}
            onBlur={() => setConnectFocused(false)}
          >
            {validating ? (
              <ActivityIndicator size='small' color='#000' />
            ) : (
              <Text style={styles.btnPrimaryText}>Connect Premiumize</Text>
            )}
          </Pressable>
        </>
      ) : (
        <View style={styles.syncingBox}>
          <ActivityIndicator size='small' color={ACCENT} />
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
