/* ToSGate.tsx — V333
 * Android-TV scroll-gated Terms of Service modal.
 *
 * V333 fixes the "can't select I Agree at the bottom" bug:
 *   1. Trigger reachedBottom from ScrollView.onScroll instead of relying on
 *      the last paragraph's onFocus event (which is unreliable on Android TV
 *      for TouchableOpacity children of a ScrollView).
 *   2. When reachedBottom flips true, programmatically focus the freshly
 *      remounted I Agree button so the user doesn't have to fight Android's
 *      focus search to land on it.
 *   3. Button still lives INSIDE the ScrollView so DPAD-DOWN can also reach
 *      it via normal navigation if the user prefers.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useAuthStore } from '../store/authStore';

export const TOS_ACK_KEY = 'v326:tos_acked_v1';
export const TOS_VERSION = 'v1';

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
      try {
        const userStr = await AsyncStorage.getItem('user');
        if (userStr) {
          const u = JSON.parse(userStr);
          if (u?.username) setFallbackUsername(u.username);
        }
      } catch { /* ignore */ }
    })();
  }, [visible, zustandUser]);

  // PRIMARY trigger for unlock: scroll position. Works regardless of which
  // paragraph (if any) currently has DPAD focus.
  const handleScroll = useCallback((e: any) => {
    if (reachedBottom) return;
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const dist = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    if (dist <= 24) setReachedBottom(true);
  }, [reachedBottom]);

  // When the button transitions from locked View -> focusable TouchableOpacity,
  // force-focus it so the user can press OK immediately to accept.
  useEffect(() => {
    if (!reachedBottom) return;
    const t = setTimeout(() => {
      // @ts-ignore RN TV: TouchableOpacity exposes .focus on Android TV builds
      agreeBtnRef.current?.focus?.();
    }, 120);
    return () => clearTimeout(t);
  }, [reachedBottom]);

  const handleAgree = async () => {
    if (submitting || !reachedBottom) return;
    setSubmitting(true);
    const appVersion =
      Constants.expoConfig?.version || (Constants as any).manifest?.version || 'unknown';
    const deviceInfo = `${Platform.OS} ${Platform.Version}`;
    try {
      const res = await fetch(`${BACKEND_URL}/api/legal/tos-accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username || 'unknown',
          app_version: appVersion,
          tos_version: TOS_VERSION,
          device_info: deviceInfo,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        await AsyncStorage.setItem(
          TOS_ACK_KEY,
          JSON.stringify({
            accepted_at: data.recorded_at,
            username: username || 'unknown',
            tos_version: TOS_VERSION,
          })
        );
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
                // @ts-ignore RN TV prop
                isTVSelectable={true}
                focusable={true}
                // @ts-ignore RN TV prop
                hasTVPreferredFocus={idx === 0}
                onFocus={() => setFocusedIdx(idx)}
                onBlur={() => setFocusedIdx((prev) => (prev === idx ? -1 : prev))}
                onPress={() => { /* not pressable */ }}
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
              // @ts-ignore RN TV prop
              isTVSelectable={true}
              focusable={true}
              // @ts-ignore RN TV prop
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
              // @ts-ignore RN TV prop
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

export async function hasAcceptedToS(): Promise<boolean> {
  try { return !!(await AsyncStorage.getItem(TOS_ACK_KEY)); } catch { return false; }
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

  paragraph: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  paragraphFocused: {
    backgroundColor: '#1f1a08',
    borderColor: GOLD,
  },

  body: { color: GOLD, fontSize: 16, lineHeight: 24, fontWeight: '500' },
  bodyFocused: { color: GOLD_BRIGHT },

  agreeBtn: {
    marginTop: 16,
    backgroundColor: GOLD,
    borderRadius: 10,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'transparent',
  },
  agreeBtnLocked: {
    backgroundColor: '#2a2a2a',
    borderColor: GOLD_DIM,
  },
  agreeBtnFocused: {
    borderColor: '#ffffff',
    backgroundColor: GOLD_BRIGHT,
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 18,
    transform: [{ scale: 1.04 }],
  },
  agreeBtnText: { color: BG, fontSize: 22, fontWeight: '800', letterSpacing: 1 },
  agreeBtnTextLocked: { color: GOLD_DIM, fontSize: 16, fontWeight: '700' },
});
