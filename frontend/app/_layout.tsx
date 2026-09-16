import { ensureMMKVMigrated } from '../src/utils/mmkvMigrate';
import React, { useEffect, useRef, useState } from 'react';
// PATCH_V48_NO_FREEZE — enableFreeze removed. Was causing 3s back-nav lag.
// import { enableFreeze } from 'react-native-screens';
// enableFreeze(true);
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Platform, View } from 'react-native';
import OTAUpdater from '../src/components/OTAUpdater'; // PATCH_V252_OTA
import { useAuthStore } from '../src/store/authStore';
import { ensurePrivastreamTunnel } from '../src/native/privastreamTunnelGate';

export default function RootLayout() {
  // V742_ROOT_TUNNEL_GATE
  // No user-facing VPN messaging. Authenticated Android UI stays
  // fail-closed until the Privastream-only tunnel is verified UP.
  const { isAuthenticated } = useAuthStore();

  const [_v742TunnelReady, _v742SetTunnelReady] =
    useState(Platform.OS !== 'android');

  const _v742StartedRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      _v742SetTunnelReady(true);
      return;
    }

    if (!isAuthenticated) {
      _v742StartedRef.current = false;
      _v742SetTunnelReady(false);
      return;
    }

    if (_v742StartedRef.current) {
      return;
    }

    _v742StartedRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        console.log('[V742_TUNNEL] authenticated root gate starting');

        await ensurePrivastreamTunnel();

        if (!cancelled) {
          console.log('[V742_TUNNEL] READY');
          _v742SetTunnelReady(true);
        }
      } catch (error: any) {
        console.error(
          '[V742_TUNNEL] FAIL',
          String(error?.message || error || 'secure connection failed')
        );

        if (!cancelled) {
          // Fail closed. No authenticated UI is exposed.
          _v742SetTunnelReady(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const _v742BlockAuthenticatedUi =
    Platform.OS === 'android' &&
    isAuthenticated &&
    !_v742TunnelReady;
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: '#0c0c0c' }}>
        <StatusBar style="light" />
        {/* PATCH_V252_OTA — silent expo-updates check on cold start.
            Component renders nothing; it just kicks off an async check
            against https://api.privastreamsolutions.com/api/expo-updates/manifest
            and reloads the JS bundle if a newer one is available. */}
        <OTAUpdater />
        {_v742BlockAuthenticatedUi ? (
          <View style={{ flex: 1, backgroundColor: '#0c0c0c' }} />
        ) : (
          <Stack screenOptions={{ headerShown: false, animation: 'none', freezeOnBlur: false /* PATCH_V48_NO_FREEZE — back-nav is instant */ }} />
        )}
      </View>
    </SafeAreaProvider>
  );
}

// V344 - migrate AsyncStorage -> MMKV on first boot (idempotent)
ensureMMKVMigrated().catch(function () {});