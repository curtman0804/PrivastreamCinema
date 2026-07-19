/* ToSGate.tsx — V336
 * USER-SCOPED persistence fix.
 *
 * V335 BUG: cached "accepted" under a single key across all users on the
 * device. User1 accepts -> User2 logs in -> hasAcceptedToS() returns true
 * without User2 ever seeing the modal. Legal compliance leak.
 *
 * V336 FIX: every persistence layer is keyed by username:
 *   - AsyncStorage: `v326:tos_acked_v1:<username>`
 *   - File backup:  `tos_ack_<username>.json`
 *   - Server:       GET /api/legal/tos-status?username=<x>
 * Result: each username has independent acceptance state. User switch on
 * the same device correctly re-prompts the new user.
 *
 * Backward compat: if the legacy key `v326:tos_acked_v1` exists from V335,
 * we migrate it to the current user's scoped key on first read.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import Constants from 'expo-constants';
import { useAuthStore } from '../store/authStore';

const TOS_ACK_KEY_PREFIX = 'v326:tos_acked_v1';   // user-scoped: ":<username>"
const TOS_ACK_LEGACY_KEY = 'v326:tos_acked_v1';   // pre-V336 single key (for migration only)
export const TOS_VERSION = 'v1';
const TOS_DOC_DIR = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';

const BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  process.env.EXPO_BACKEND_URL ||
  'https://api.privastreamsolutions.com';

const GOLD = '#d4af37';
const GOLD_BRIGHT = '#ffd84a';
const GOLD_DIM = '#7a6420';
const BG = '#0a0a0a';
const BG_CARD = '#141414';

const TOS_BODY = `PRIVASTREAM CINEMA – End-User Terms of Service

By clicking "I Agree" and utilizing Privastream Cinema, you acknowledge and agree to the following legally binding terms:

1. Neutral Pipeline: You understand that this application is a media playback utility and does not contain, provide, or host any content.

2. User Liability: You assume absolute liability for all digital streams, JSON links, or data feeds you input into this application. You agree not to use this software to access unauthorized or pirated copyrighted material.

3. No Indemnification: Privastream Solutions, LLC explicitly disclaims all liability for user-generated activities. You agree to hold harmless and indemnify the developers from any claims arising from your breach of third-party copyright laws.

4. Termination of Service: We reserve the right to terminate access to application updates or support services for any user found utilizing the software in a manner that violates our neutral integrity.

By proceeding past this notice, you confirm that you are at least 18 years of age and that you have read, understood, and agree to be bound by the terms above.`;

const TOS_PARAGRAPHS = TOS_BODY.split('\n\n').map((s) => s.trim()).filter(Boolean);

interface ToSGateProps {
  visible: boolean;
  onAccepted: () => void;
}

// ---------- per-user key helpers ----------
function _ackKeyFor(username: string): string {
  return `${TOS_ACK_KEY_PREFIX}:${username}`;
}
function _ackFileFor(username: string): string {
  // sanitize username for use in a filename
  const safe = username.replace(/[^a-zA-Z0-9._@-]/g, '_');
  return TOS_DOC_DIR + `tos_ack_${safe}.json`;
}

async function _writeAckToFile(username: string, payload: object): Promise<boolean> {
  try {
    const f = _ackFileFor(username);
    if (!f.startsWith('file://')) return false;
    await FileSystem.writeAsStringAsync(f, JSON.stringify(payload));
    return true;
  } catch { return false; }
}

async function _readAckFromFile(username: string): Promise<boolean> {
  try {
    const f = _ackFileFor(username);
    if (!f.startsWith('file://')) return false;
    const info = await FileSystem.getInfoAsync(f);
    if (!info.exists) return false;
    const content = await FileSystem.readAsStringAsync(f);
    return !!JSON.parse(content);
  } catch { return false; }
}

async function _readUsernameFromStorage(): Promise<string> {
  try {
    const userStr = await AsyncStorage.getItem('user');
    if (userStr) {
      const u = JSON.parse(userStr);
      if (u?.username) return String(u.username);
    }
  } catch { /* ignore */ }
  return '';
}

async function _cacheAck(username: string, accepted_at: string | null): Promise<void> {
  const payload = { accepted_at: accepted_at || new Date().toISOString(), username, tos_version: TOS_VERSION };
  try { await AsyncStorage.setItem(_ackKeyFor(username), JSON.stringify(payload)); } catch {}
  await _writeAckToFile(username, payload);
}

// One-time migration of the V335 single-key cache into user-scoped storage.
// If the legacy key exists AND the current user has no scoped entry yet AND
// the legacy payload mentions THIS username, copy it forward then delete.
async function _migrateLegacyKey(username: string): Promise<void> {
  try {
    const legacy = await AsyncStorage.getItem(TOS_ACK_LEGACY_KEY);
    if (!legacy) return;
    const scoped = await AsyncStorage.getItem(_ackKeyFor(username));
    if (scoped) {
      await AsyncStorage.removeItem(TOS_ACK_LEGACY_KEY);
      return;
    }
    let payload: any = null;
    try { payload = JSON.parse(legacy); } catch {}
    if (payload && payload.username && payload.username === username) {
      await AsyncStorage.setItem(_ackKeyFor(username), legacy);
    }
    await AsyncStorage.removeItem(TOS_ACK_LEGACY_KEY);
  } catch { /* ignore */ }
}

// ============================================================================
// Component
// ============================================================================
export function ToSGate({ visible, onAccepted }: ToSGateProps) {
  const [reachedBottom, setReachedBottom] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [btnFocused, setBtnFocused] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);
  const [fallbackUsername, setFallbackUsername] = useState<string>('');

  const scrollRef = useRef<ScrollView>(null);
  const agreeBtnRef = useRef<TouchableOpacity>(null);

  const zustandUser = useAuthStore((s) => s.user);
  const username = zustandUser?.username || fallbackUsername || '';

  useEffect(() => {
    if (visible) {
      setReachedBottom(false);
      setSubmitting(false);
      setBtnFocused(false);
      setFocusedIdx(-1);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || zustandUser?.username) return;
    (async () => {
      const u = await _readUsernameFromStorage();
      if (u) setFallbackUsername(u);
    })();
  }, [visible, zustandUser]);

  const handleScroll = useCallback((e: any) => {
    if (reachedBottom) return;
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const dist = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    if (dist <= 24) setReachedBottom(true);
  }, [reachedBottom]);

  useEffect(() => {
    if (!reachedBottom) return;
    const t = setTimeout(() => {
      // @ts-ignore RN TV
      agreeBtnRef.current?.focus?.();
    }, 120);
    return () => clearTimeout(t);
  }, [reachedBottom]);

  const handleAgree = async () => {
    if (submitting || !reachedBottom || !username) return;
    setSubmitting(true);
    const appVersion =
      Constants.expoConfig?.version || (Constants as any).manifest?.version || 'unknown';
    const deviceInfo = `${Platform.OS} ${Platform.Version}`;
    try {
      const res = await fetch(`${BACKEND_URL}/api/legal/tos-accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          app_version: appVersion,
          tos_version: TOS_VERSION,
          device_info: deviceInfo,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        await _cacheAck(username, data.recorded_at || null);
        console.log('[v336 tos] cached for', username, 'email_status=', data.email_status || 'sent');
        onAccepted();
      } else {
        Alert.alert('Could not record acceptance', `${data?.error || 'Server error'}. Please try again.`);
        setSubmitting(false);
      }
    } catch (err: any) {
      Alert.alert('Network error', err?.message || 'Could not reach server');
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={() => {}}>
      <View style={styles.root}>
        <Text style={styles.heading}>Terms of Service</Text>
        <Text style={styles.subheading}>
          {reachedBottom
            ? 'Press OK on "I Agree" to continue.'
            : 'Press DOWN on your remote to scroll through every section of the agreement.'}
        </Text>

        <View style={styles.idRow}>
          <Text style={styles.idLabel}>Registered as</Text>
          <Text style={styles.idValue}>{username || '(not signed in)'}</Text>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
          onScroll={handleScroll}
          scrollEventThrottle={64}
        >
          {TOS_PARAGRAPHS.map((para, idx) => {
            const isFocused = focusedIdx === idx;
            return (
              <TouchableOpacity
                key={`p_${idx}`}
                activeOpacity={1}
                // @ts-ignore RN TV
                isTVSelectable={true}
                focusable={true}
                // @ts-ignore RN TV
                hasTVPreferredFocus={idx === 0}
                onFocus={() => setFocusedIdx(idx)}
                onBlur={() => setFocusedIdx((prev) => (prev === idx ? -1 : prev))}
                onPress={() => {}}
                style={[styles.paragraph, isFocused && styles.paragraphFocused]}
              >
                <Text style={[styles.body, isFocused && styles.bodyFocused]}>{para}</Text>
              </TouchableOpacity>
            );
          })}

          {reachedBottom ? (
            <TouchableOpacity
              key="agree-unlocked"
              ref={agreeBtnRef}
              activeOpacity={0.85}
              onPress={handleAgree}
              onFocus={() => setBtnFocused(true)}
              onBlur={() => setBtnFocused(false)}
              // @ts-ignore RN TV
              isTVSelectable={true}
              focusable={true}
              // @ts-ignore RN TV
              hasTVPreferredFocus={true}
              style={[styles.agreeBtn, btnFocused && styles.agreeBtnFocused]}
            >
              <Text style={styles.agreeBtnText}>
                {submitting ? 'Recording…' : 'I Agree'}
              </Text>
            </TouchableOpacity>
          ) : (
            <View
              key="agree-locked"
              // @ts-ignore RN TV
              isTVSelectable={false}
              focusable={false}
              importantForAccessibility="no-hide-descendants"
              style={[styles.agreeBtn, styles.agreeBtnLocked]}
            >
              <Text style={styles.agreeBtnTextLocked}>Scroll through all terms to enable</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/**
 * Returns true if the CURRENT user (read from storage) has accepted the ToS.
 * Sources (in order): username-scoped AsyncStorage -> username-scoped file ->
 * server GET /api/legal/tos-status?username=<x>. Any "yes" answer is cached
 * forward.
 *
 * If no user is logged in, returns false (so the modal won't show before login).
 */
export async function hasAcceptedToS(): Promise<boolean> {
  const username = await _readUsernameFromStorage();
  if (!username) return false;

  // One-time migration from V335 single-key cache.
  await _migrateLegacyKey(username);

  // 1) user-scoped AsyncStorage
  try {
    if (await AsyncStorage.getItem(_ackKeyFor(username))) return true;
  } catch {}

  // 2) user-scoped file backup
  if (await _readAckFromFile(username)) {
    try {
      const content = await FileSystem.readAsStringAsync(_ackFileFor(username));
      await AsyncStorage.setItem(_ackKeyFor(username), content);
    } catch {}
    return true;
  }

  // 3) server check
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/legal/tos-status?username=${encodeURIComponent(username)}`,
      { method: 'GET' }
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.accepted === true) {
      await _cacheAck(username, data.accepted_at || null);
      return true;
    }
  } catch { /* network down */ }
  return false;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, paddingTop: 56, paddingHorizontal: 32, paddingBottom: 24 },
  heading: { color: GOLD, fontSize: 32, fontWeight: '700', marginBottom: 6, letterSpacing: 1 },
  subheading: { color: '#bbb', fontSize: 14, marginBottom: 16 },
  idRow: { marginBottom: 12, paddingHorizontal: 14, paddingVertical: 10, borderColor: GOLD_DIM, borderWidth: 1, borderRadius: 8, backgroundColor: '#1a1a1a' },
  idLabel: { color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  idValue: { color: GOLD, fontSize: 16, fontWeight: '600', marginTop: 2, fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo' },
  scroll: { flex: 1, borderColor: GOLD_DIM, borderWidth: 1, borderRadius: 10, backgroundColor: BG_CARD },
  scrollContent: { padding: 16, paddingBottom: 24 },
  paragraph: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, marginBottom: 6, borderWidth: 2, borderColor: 'transparent', backgroundColor: 'transparent' },
  paragraphFocused: { backgroundColor: '#1f1a08', borderColor: GOLD },
  body: { color: GOLD, fontSize: 16, lineHeight: 24, fontWeight: '500' },
  bodyFocused: { color: GOLD_BRIGHT },
  agreeBtn: { marginTop: 16, backgroundColor: GOLD, borderRadius: 10, paddingVertical: 18, alignItems: 'center', borderWidth: 4, borderColor: 'transparent' },
  agreeBtnLocked: { backgroundColor: '#2a2a2a', borderColor: GOLD_DIM },
  agreeBtnFocused: { borderColor: '#ffffff', backgroundColor: GOLD_BRIGHT, shadowColor: GOLD, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 24, elevation: 18, transform: [{ scale: 1.04 }] },
  agreeBtnText: { color: BG, fontSize: 22, fontWeight: '800', letterSpacing: 1 },
  agreeBtnTextLocked: { color: GOLD_DIM, fontSize: 16, fontWeight: '700' },
});
