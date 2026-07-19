import React from 'react';
// PATCH_V48_NO_FREEZE — enableFreeze removed. Was causing 3s back-nav lag.
// import { enableFreeze } from 'react-native-screens';
// enableFreeze(true);
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View } from 'react-native';
import OTAUpdater from '../src/components/OTAUpdater'; // PATCH_V252_OTA

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: '#0c0c0c' }}>
        <StatusBar style="light" />
        {/* PATCH_V252_OTA — silent expo-updates check on cold start.
            Component renders nothing; it just kicks off an async check
            against https://api.privastreamsolutions.com/api/expo-updates/manifest
            and reloads the JS bundle if a newer one is available. */}
        <OTAUpdater />
        <Stack screenOptions={{ headerShown: false, animation: 'none', freezeOnBlur: false /* PATCH_V48_NO_FREEZE — back-nav is instant */ }} />
      </View>
    </SafeAreaProvider>
  );
}
