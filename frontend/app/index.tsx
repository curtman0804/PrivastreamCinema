import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter, useRootNavigationState } from 'expo-router';
import { useAuthStore } from '../src/store/authStore';
import { Image } from 'expo-image';

export default function Index() {
  const router = useRouter();
  const { isAuthenticated, isLoading, loadStoredAuth } = useAuthStore();
  const [authLoaded, setAuthLoaded] = useState(false);
  
  // Check if navigation is ready
  const rootNavigationState = useRootNavigationState();
  const navigationReady = rootNavigationState?.key != null;

  useEffect(() => {
    // Load stored auth on mount
    const loadAuth = async () => {
      await loadStoredAuth();
      setAuthLoaded(true);
    };
    loadAuth();
  }, []);

  useEffect(() => {
    // Only navigate when both auth is loaded AND navigation is ready
    if (authLoaded && !isLoading && navigationReady) {
      if (isAuthenticated) {
        router.replace('/(tabs)/discover');
      } else {
        router.replace('/(auth)/login');
      }
    }
  }, [isAuthenticated, isLoading, authLoaded, navigationReady]);

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <Image
          source={require('../assets/images/logo_splash.png')}
          style={styles.logo}
          contentFit="contain"
        />
      </View>
      <ActivityIndicator size="large" color="#B8A05C" style={styles.loader} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0c0c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
  },
  logo: {
    width: 300,
    height: 200,
  },
  loader: {
    marginTop: 40,
  },
});
