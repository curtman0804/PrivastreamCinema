import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
        tabBarActiveTintColor: '#B8A05C',
        tabBarInactiveTintColor: '#888888',
        tabBarLabelStyle: [
          styles.tabBarLabel,
          isTV && styles.tabBarLabelTV,
        ],
        tabBarItemStyle: [
          styles.tabBarItem,
          isTV && styles.tabBarItemTV,
        ],
      }}
    >
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass" size={isTV ? 26 : size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search" size={isTV ? 26 : size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bookmark" size={isTV ? 26 : size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="addons"
        options={{
          title: 'Addons',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="extension-puzzle" size={isTV ? 26 : size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={isTV ? 26 : size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#1a1a1a',
    borderTopColor: '#2a2a2a',
    borderTopWidth: 1,
    paddingTop: 6,
  },
  tabBarTV: {
    paddingHorizontal: 40,
  },
  tabBarLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  tabBarLabelTV: {
    fontSize: 12,
  },
  tabBarItem: {
    paddingVertical: 4,
  },
  tabBarItemTV: {
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
});
