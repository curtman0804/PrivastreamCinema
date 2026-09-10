// V704_PARENTAL_CONTROLS_SCREEN
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../src/styles/colors';
import { useContentStore } from '../src/store/contentStore';
import {
  getParentalModeEnabled,
  isParentalPinConfigured,
  removeParentalPin,
  setParentalModeEnabled,
  setParentalPin,
  verifyParentalPin,
} from '../src/utils/parentalControls';

type PinMode =
  | 'unlock'
  | 'create'
  | 'confirm'
  | 'change'
  | 'changeConfirm';

const DIGITS = ['1','2','3','4','5','6','7','8','9','back','0','clear'];

type ParentalControlsScreenProps = {
  embedded?: boolean;
  onClose?: () => void;
};

export default function ParentalControlsScreen(
  { embedded = false, onClose }: ParentalControlsScreenProps = {}
) {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;

  const closeScreen = () => {
    if (embedded) {
      onClose?.();
      return;
    }

    router.back();
  };

  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [parentalModeEnabled, setParentalModeEnabledState] = useState(true);

  const [mode, setMode] = useState<PinMode>('unlock');
  const [pin, setPin] = useState('');
  const [pendingPin, setPendingPin] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const hasPin = await isParentalPinConfigured();
        let parentalMode = await getParentalModeEnabled();

        // V706C2D_PARENTAL_MODE_MODAL
        // Unrestricted mode may never remain enabled without a PIN.
        if (!hasPin && !parentalMode) {
          await setParentalModeEnabled(true);
          parentalMode = true;
        }

        if (cancelled) return;

        setConfigured(hasPin);
        setParentalModeEnabledState(parentalMode);

        if (hasPin) {
          setMode('unlock');
          setUnlocked(false);
        } else {
          setMode('create');
          setUnlocked(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const resetEntry = () => {
    setPin('');
    setError('');
  };

  const finishPin = async (value: string) => {
    if (saving || value.length !== 4) return;

    setSaving(true);
    setError('');

    try {
      if (mode === 'unlock') {
        const ok = await verifyParentalPin(value);

        if (!ok) {
          setError('Incorrect PIN');
          setPin('');
          return;
        }

        setUnlocked(true);
        setPin('');
        return;
      }

      if (mode === 'create') {
        setPendingPin(value);
        setPin('');
        setMode('confirm');
        return;
      }

      if (mode === 'confirm') {
        if (value !== pendingPin) {
          setError('PINs did not match. Create a new PIN.');
          setPendingPin('');
          setPin('');
          setMode('create');
          return;
        }

        await setParentalPin(value);

        // New PINs always begin with the safe policy enabled.
        await setParentalModeEnabled(true);
        setParentalModeEnabledState(true);

        setConfigured(true);
        setUnlocked(true);
        setPendingPin('');
        setPin('');
        return;
      }

      if (mode === 'change') {
        setPendingPin(value);
        setPin('');
        setMode('changeConfirm');
        return;
      }

      if (mode === 'changeConfirm') {
        if (value !== pendingPin) {
          setError('PINs did not match. Try again.');
          setPendingPin('');
          setPin('');
          setMode('change');
          return;
        }

        await setParentalPin(value);
        setPendingPin('');
        setPin('');
        setMode('unlock');
        setUnlocked(true);
        return;
      }
    } finally {
      setSaving(false);
    }
  };

  const pushDigit = (value: string) => {
    if (saving) return;

    if (value === 'back') {
      setPin((p) => p.slice(0, -1));
      setError('');
      return;
    }

    if (value === 'clear') {
      resetEntry();
      return;
    }

    if (!/^\d$/.test(value)) return;

    setPin((current) => {
      if (current.length >= 4) return current;

      const next = current + value;

      if (next.length === 4) {
        setTimeout(() => {
          void finishPin(next);
        }, 0);
      }

      return next;
    });

    setError('');
  };

  const refreshDiscoverPolicy = async () => {
    const state = useContentStore.getState();

    await state.nukeDiscoverCache(false);
    await state.fetchDiscover(true);
  };

  const changeParentalMode = async (enabled: boolean) => {
    if (saving) return;

    setSaving(true);

    try {
      // V706C2L_CANCEL_STREAMS_BEFORE_POLICY_CHANGE
      useContentStore.getState().cancelInFlightStreams();

      await setParentalModeEnabled(enabled);
      setParentalModeEnabledState(enabled);

      // Remove every stale Discover representation, then force a new
      // server request using the new Parental Mode policy.
      await refreshDiscoverPolicy();
    } catch (e) {
      console.warn('[V706C2D_PARENTAL] Failed to change Parental Mode', e);

      // V704E: the preference write happens before the forced
      // Discover refresh. If that refresh fails, restore BOTH
      // persistent state and UI state to the previous value.
      try {
        await setParentalModeEnabled(!enabled);
      } catch (_) {}

      setParentalModeEnabledState(!enabled);

      Alert.alert(
        'Unable to Update',
        'Parental Mode could not be changed.'
      );
    } finally {
      setSaving(false);
    }
  };

  const requestRemovePin = () => {
    const execute = async () => {
      setSaving(true);

      try {
        // Removing the PIN returns the app to the safe policy.
        useContentStore.getState().cancelInFlightStreams();

        await setParentalModeEnabled(true);
        await removeParentalPin();

        setParentalModeEnabledState(true);
        setConfigured(false);
        setUnlocked(false);
        setPendingPin('');
        setPin('');
        setMode('create');

        await refreshDiscoverPolicy();
      } finally {
        setSaving(false);
      }
    };

    if (Platform.OS === 'web') {
      if (
        typeof window !== 'undefined' &&
        window.confirm(
          'Remove the parental PIN? Parental Mode will be turned ON.'
        )
      ) {
        void execute();
      }
      return;
    }

    Alert.alert(
      'Remove Parental PIN',
      'Parental Mode will be turned ON and a new PIN will be required to turn it off again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove PIN',
          style: 'destructive',
          onPress: () => {
            void execute();
          },
        },
      ]
    );
  };

  const beginChangePin = () => {
    setPendingPin('');
    setPin('');
    setError('');
    setMode('change');
  };

  const pinTitle = (() => {
    if (mode === 'unlock') return 'Enter PIN';
    if (mode === 'create') return 'Create 4-Digit PIN';
    if (mode === 'confirm') return 'Confirm PIN';
    if (mode === 'change') return 'New 4-Digit PIN';
    return 'Confirm New PIN';
  })();

  const pinSubtitle = (() => {
    if (mode === 'unlock') {
      return 'Enter your parental-control PIN to continue.';
    }

    if (mode === 'confirm' || mode === 'changeConfirm') {
      return 'Enter the same four digits again.';
    }

    return 'Choose four digits that will be required to change parental settings.';
  })();

  const showKeypad = !unlocked || mode === 'change' || mode === 'changeConfirm';

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, embedded && styles.embeddedContainer]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading Parental Controls...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, embedded && styles.embeddedContainer]}>
      <View style={[styles.header, isTV && styles.headerTV, embedded && styles.headerEmbedded]}>
        <Pressable
          onPress={closeScreen}
          style={({ focused }: any) => [
            styles.backButton,
            focused && styles.focused,
          ]}
        >
          <Ionicons
            name={embedded ? 'close' : 'arrow-back'}
            size={24}
            color={colors.primary}
          />
        </Pressable>

        <View style={styles.headerText}>
          <Text style={[styles.title, isTV && styles.titleTV, embedded && styles.titleEmbedded]}>
            Parental Controls
          </Text>
          <Text style={styles.headerSubtitle}>
            PIN-protected content settings
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          isTV && styles.contentTV,
          embedded && styles.contentEmbedded,
        ]}
      >
        {showKeypad ? (
          <View style={[styles.pinCard, embedded && styles.pinCardEmbedded]}>
            <Ionicons
              name="lock-closed-outline"
              size={40}
              color={colors.primary}
            />

            <Text style={[styles.pinTitle, embedded && styles.pinTitleEmbedded]}>{pinTitle}</Text>
            <Text style={[styles.pinSubtitle, embedded && styles.pinSubtitleEmbedded]}>{pinSubtitle}</Text>

            <View style={[styles.pinDots, embedded && styles.pinDotsEmbedded]}>
              {[0, 1, 2, 3].map((index) => (
                <View
                  key={index}
                  style={[
                    styles.pinDot,
                    index < pin.length && styles.pinDotFilled,
                  ]}
                />
              ))}
            </View>

            {!!error && (
              <Text style={styles.errorText}>{error}</Text>
            )}

            <View style={[styles.keypad, embedded && styles.keypadEmbedded]}>
              {DIGITS.map((digit) => {
                const isBack = digit === 'back';
                const isClear = digit === 'clear';

                return (
                  <Pressable
                    key={digit}
                    disabled={saving}
                    onPress={() => pushDigit(digit)}
                    style={({ focused, pressed }: any) => [
                      styles.key,
                      embedded && styles.keyEmbedded,
                      focused && styles.keyFocused,
                      pressed && styles.keyPressed,
                    ]}
                  >
                    {isBack ? (
                      <Ionicons
                        name="backspace-outline"
                        size={24}
                        color={colors.primary}
                      />
                    ) : isClear ? (
                      <Text style={styles.keySmall}>CLR</Text>
                    ) : (
                      <Text style={styles.keyText}>{digit}</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {(mode === 'change' || mode === 'changeConfirm') && (
              <Pressable
                onPress={() => {
                  setMode('unlock');
                  setPendingPin('');
                  setPin('');
                  setError('');
                  setUnlocked(true);
                }}
                style={({ focused }: any) => [
                  styles.secondaryButton,
                  embedded && styles.secondaryButtonEmbedded,
                  focused && styles.focused,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            <View style={[styles.section, embedded && styles.sectionEmbedded]}>
              <Text style={styles.sectionTitle}>CONTENT ACCESS</Text>

              <View style={[styles.settingCard, embedded && styles.settingCardEmbedded]}>
                <View style={styles.settingText}>
                  <Text style={styles.settingTitle}>Parental Mode</Text>
                  <Text style={styles.settingSubtitle}>
                    {parentalModeEnabled
                      ? 'PG-13 / TV-14 ceiling and adult-addon filter are ON.'
                      : 'Rating ceiling and adult-addon filter are OFF.'}
                  </Text>
                </View>

                <Pressable
                  disabled={saving}
                  onPress={() => {
                    void changeParentalMode(!parentalModeEnabled);
                  }}
                  style={({ focused, pressed }: any) => [
                    styles.toggle,
                    parentalModeEnabled && styles.toggleOn,
                    focused && styles.toggleFocused,
                    pressed && styles.togglePressed,
                  ]}
                >
                  <View
                    style={[
                      styles.toggleKnob,
                      parentalModeEnabled && styles.toggleKnobOn,
                    ]}
                  />
                </Pressable>
              </View>

              <Text style={styles.note}>
                {parentalModeEnabled
                  ? 'Blocks R, NC-17, TV-MA, NR/Unrated, unknown ratings, and explicit adult-addon content.'
                  : 'Unrestricted mode allows mainstream ratings and installed adult-addon content.'}
              </Text>
            </View>

            <View style={[styles.section, embedded && styles.sectionEmbedded]}>
              <Text style={styles.sectionTitle}>PIN</Text>

              <View style={styles.actionCard}>
                <Pressable
                  disabled={saving}
                  onPress={beginChangePin}
                  style={({ focused }: any) => [
                    styles.actionButton,
                    embedded && styles.actionButtonEmbedded,
                    focused && styles.focused,
                  ]}
                >
                  <Ionicons
                    name="key-outline"
                    size={22}
                    color={colors.primary}
                  />
                  <Text style={styles.actionText}>Change PIN</Text>
                  <Ionicons
                    name="chevron-forward"
                    size={20}
                    color={colors.textMuted}
                  />
                </Pressable>

                <View style={styles.divider} />

                <Pressable
                  disabled={saving}
                  onPress={requestRemovePin}
                  style={({ focused }: any) => [
                    styles.actionButton,
                    embedded && styles.actionButtonEmbedded,
                    focused && styles.focused,
                  ]}
                >
                  <Ionicons
                    name="trash-outline"
                    size={22}
                    color={colors.error}
                  />
                  <Text style={[styles.actionText, styles.dangerText]}>
                    Remove PIN
                  </Text>
                </Pressable>
              </View>
            </View>
          </>
        )}

        {saving && (
          <View style={styles.savingRow}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: colors.primary,
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTV: {
    paddingHorizontal: 32,
    paddingVertical: 18,
  },
  backButton: {
    width: 52,
    height: 52,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: colors.primary,
    fontSize: 24,
    fontWeight: '600',
  },
  titleTV: {
    fontSize: 28,
  },
  headerSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  content: {
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
    padding: 20,
    paddingBottom: 60,
  },
  contentTV: {
    maxWidth: 720,
    paddingTop: 28,
  },
  pinCard: {
    backgroundColor: colors.backgroundLight,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  pinTitle: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: '600',
    marginTop: 12,
  },
  pinSubtitle: {
    color: colors.primaryDark,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 460,
  },
  pinDots: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 24,
    marginBottom: 20,
  },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.primaryDark,
  },
  pinDotFilled: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
    marginBottom: 12,
  },
  keypad: {
    width: 300,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  key: {
    width: 88,
    height: 64,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyFocused: {
    borderColor: colors.primary,
    transform: [{ scale: 1.05 }],
  },
  keyPressed: {
    opacity: 0.75,
  },
  keyText: {
    color: colors.primary,
    fontSize: 24,
    fontWeight: '600',
  },
  keySmall: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    marginTop: 20,
    minWidth: 180,
    minHeight: 52,
    borderWidth: 3,
    borderColor: 'transparent',
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 4,
  },
  settingCard: {
    minHeight: 88,
    borderRadius: 14,
    backgroundColor: colors.backgroundLight,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingText: {
    flex: 1,
    paddingRight: 20,
  },
  settingTitle: {
    color: colors.primary,
    fontSize: 17,
    fontWeight: '600',
  },
  settingSubtitle: {
    color: colors.primaryDark,
    fontSize: 13,
    marginTop: 4,
  },
  note: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
    marginHorizontal: 4,
  },
  toggle: {
    width: 62,
    height: 36,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 3,
    justifyContent: 'center',
  },
  toggleOn: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(184,160,92,0.25)',
  },
  toggleFocused: {
    borderColor: colors.primary,
    transform: [{ scale: 1.08 }],
  },
  togglePressed: {
    opacity: 0.8,
  },
  toggleKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primaryDark,
  },
  toggleKnobOn: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
  },
  actionCard: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.backgroundLight,
  },
  actionButton: {
    minHeight: 70,
    borderWidth: 3,
    borderColor: 'transparent',
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionText: {
    flex: 1,
    marginLeft: 12,
    color: colors.primary,
    fontSize: 16,
    fontWeight: '500',
  },
  dangerText: {
    color: colors.error,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 16,
  },
  focused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(184,160,92,0.15)',
  },
  // V705G2_PARENTAL_PROFILE_MODAL
  embeddedContainer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  headerEmbedded: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  titleEmbedded: {
    fontSize: 20,
  },
  contentEmbedded: {
    maxWidth: 640,
    padding: 10,
    paddingBottom: 10,
  },
  pinCardEmbedded: {
    padding: 10,
  },
  pinTitleEmbedded: {
    fontSize: 18,
    marginTop: 4,
  },
  pinSubtitleEmbedded: {
    fontSize: 12,
    marginTop: 2,
  },
  pinDotsEmbedded: {
    gap: 12,
    marginTop: 10,
    marginBottom: 8,
  },
  keypadEmbedded: {
    width: 252,
    gap: 6,
  },
  keyEmbedded: {
    width: 78,
    height: 44,
    borderRadius: 10,
    borderWidth: 2,
  },
  secondaryButtonEmbedded: {
    marginTop: 8,
    minHeight: 42,
  },
  sectionEmbedded: {
    marginBottom: 10,
  },
  settingCardEmbedded: {
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  actionButtonEmbedded: {
    minHeight: 50,
    borderWidth: 2,
  },
  savingRow: {
    marginTop: 10,
    alignItems: 'center',
  },
});