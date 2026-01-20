import React, { useState } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Platform, View, useWindowDimensions, Pressable, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Stremio-inspired colors
const colors = {
  primary: '#8A5AAB',
  background: '#0F0F0F',
  backgroundLight: '#161616',
  surface: '#1E1E1E',
  textPrimary: '#FFFFFF',
  textSecondary: '#B0B0B0',
  textMuted: '#707070',
};

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;
  
  const bottomPadding = Math.max(insets.bottom, Platform.OS === 'android' ? 20 : 10);
  const tabBarHeight = isTV ? 70 : 60 + bottomPadding;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: [
          styles.tabBar,
          isTV && styles.tabBarTV,
          {
            height: tabBarHeight,
            paddingBottom: isTV ? 8 : bottomPadding,
          }
        ],
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: [
          styles.tabBarLabel,
          isTV && styles.tabBarLabelTV,
        ],
        tabBarItemStyle: [
          styles.tabBarItem,
          isTV && styles.tabBarItemTV,
        ],
        tabBarButton: (props) => {
          const [isFocused, setIsFocused] = useState(false);
          return (
            <Pressable
              {...props}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              style={({ focused }) => [
                props.style,
                styles.tabButton,
                (focused || isFocused) && styles.tabItemFocused,
              ]}
            />
          );
        },
      }}
    >
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Board',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name="grid" size={isTV ? 24 : 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name="compass" size={isTV ? 24 : 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name="library" size={isTV ? 24 : 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="addons"
        options={{
          title: 'Addons',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name="extension-puzzle" size={isTV ? 24 : 22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name="settings" size={isTV ? 24 : 22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.backgroundLight,
    borderTopColor: colors.surface,
    borderTopWidth: 1,
    paddingTop: 6,
  },
  tabBarTV: {
    paddingHorizontal: 60,
    borderTopWidth: 0,
    backgroundColor: colors.background,
  },
  tabBarLabel: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  tabBarLabelTV: {
    fontSize: 12,
    fontWeight: '600',
  },
  tabBarItem: {
    paddingVertical: 2,
  },
  tabBarItemTV: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    marginHorizontal: 8,
  },
  tabButton: {
    borderRadius: 8,
  },
  tabItemFocused: {
    backgroundColor: 'rgba(138, 90, 171, 0.25)',
    // Stremio-style subtle glow
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
});
