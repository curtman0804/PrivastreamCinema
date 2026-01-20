import React, { useState } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Platform, View, useWindowDimensions, Pressable, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;
  
  const bottomPadding = Math.max(insets.bottom, Platform.OS === 'android' ? 20 : 10);
  const tabBarHeight = isTV ? 80 : 65 + bottomPadding;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: [
          styles.tabBar,
          isTV && styles.tabBarTV,
          {
            height: tabBarHeight,
            paddingBottom: isTV ? 10 : bottomPadding,
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
        tabBarButton: (props) => {
          const [isFocused, setIsFocused] = useState(false);
          return (
            <Pressable
              {...props}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              style={({ focused }) => [
                props.style,
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
          title: 'Discover',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={focused && isTV ? styles.iconFocused : undefined}>
              <Ionicons name="compass" size={isTV ? 28 : size} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={focused && isTV ? styles.iconFocused : undefined}>
              <Ionicons name="search" size={isTV ? 28 : size} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={focused && isTV ? styles.iconFocused : undefined}>
              <Ionicons name="bookmark" size={isTV ? 28 : size} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="addons"
        options={{
          title: 'Addons',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={focused && isTV ? styles.iconFocused : undefined}>
              <Ionicons name="extension-puzzle" size={isTV ? 28 : size} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={focused && isTV ? styles.iconFocused : undefined}>
              <Ionicons name="person" size={isTV ? 28 : size} color={color} />
            </View>
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
    paddingTop: 8,
  },
  tabBarTV: {
    paddingHorizontal: 40,
    borderTopWidth: 2,
    borderTopColor: '#333333',
  },
  tabBarLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  tabBarLabelTV: {
    fontSize: 14,
    fontWeight: '700',
  },
  tabBarItem: {
    paddingVertical: 4,
  },
  tabBarItemTV: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    marginHorizontal: 10,
    borderRadius: 8,
  },
  tabItemFocused: {
    borderWidth: 4,
    borderColor: '#B8A05C',
    borderRadius: 12,
    backgroundColor: 'rgba(184, 160, 92, 0.2)',
  },
  iconFocused: {
    transform: [{ scale: 1.2 }],
  },
});
