import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../src/store/authStore';

export default function RootLayout() {
  const { loadStoredAuth } = useAuthStore();

  useEffect(() => {
    loadStoredAuth();
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0c0c0c' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen 
          name="details/[type]/[id]" 
          options={{
            presentation: 'card',
            animation: 'slide_from_bottom',
          }} 
        />
        <Stack.Screen 
          name="player" 
          options={{
            presentation: 'fullScreenModal',
            animation: 'fade',
          }} 
        />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0c0c0c',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
