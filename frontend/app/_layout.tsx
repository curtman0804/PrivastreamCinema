import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuthStore } from '../src/store/authStore';

function RootLayoutContent() {
  const { isLoading, loadStoredAuth } = useAuthStore();

  useEffect(() => {
    loadStoredAuth();
  }, []);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#B8A05C" />
      </View>
    );
  }

  return (
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
  );
}

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <RootLayoutContent />
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
