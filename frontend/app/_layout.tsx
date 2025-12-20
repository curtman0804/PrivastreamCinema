import React from 'react';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: '#0c0c0c' }}>
        <StatusBar style="light" />
        <NavigationContainer independent={true}>
          <Slot />
        </NavigationContainer>
      </View>
    </SafeAreaProvider>
  );
}
