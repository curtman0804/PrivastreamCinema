import React, { useState } from 'react';
import { useEffect, useRef } from 'react';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Platform, View, useWindowDimensions, Pressable, BackHandler, ToastAndroid, findNodeHandle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabsLayout() {
  // PATCH_V71_BACK_ROUTE_AWARE - hardware back is route-aware now.
  //   Nested screens -> router.back()
  //   Non-Discover tabs -> go to Discover
  //   Discover (root) -> return false, OS exits the app
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const onBack = () => {
      try {
        if (router.canGoBack && router.canGoBack()) {
          router.back();
          return true;
        }
      } catch (_) {}
      const p = String(pathname || '').toLowerCase();
      // On Discover (root) -> let system exit
      if (p === '/' || p.endsWith('/discover') || p === '/(tabs)' || p === '/(tabs)/discover') {
        return false;
      }
      // Any other tab -> back to Discover
      try {
        router.replace('/(tabs)/discover');
        return true;
      } catch (_) {
        return false;
      }
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBack);
    return () => { try { sub.remove(); } catch (_) {} };
  }, [pathname]);

  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;
  
  const bottomPadding = Math.max(insets.bottom, Platform.OS === 'android' ? 20 : 10);
  const tabBarHeight = isTV ? 80 : 65 + bottomPadding;

  return (
    <Tabs
      screenOptions={{
        // PATCH_V14B_FREEZE_ON_BLUR_TABS
        // PATCH_V40_NO_FREEZE — keep Discover mounted; back returns instantly.
        freezeOnBlur: false,
        lazy: true,
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
          // PATCH_V71B_TAB_FOCUS_TRAP - hardened trap with multi-source tag detection. (PATCH_V71C_UP_ENABLED)
          const [isFocused, setIsFocused] = useState(false);
          const btnRef = useRef(null);
          const [selfTag, setSelfTag] = useState(0);

          // Detect first/last tab from any available source.
          const blob = String(
            (props.accessibilityLabel || '') + ' ' +
            (props.to || '') + ' ' +
            (props.href || '') + ' ' +
            (props.route?.name || '') + ' ' +
            (props.target || '')
          ).toLowerCase();
          const isFirst = blob.includes('discover');
          const isLast = blob.includes('profile');

          // Try to grab a valid native tag from multiple sources.
          const grabTag = () => {
            if (!btnRef.current || !(isFirst || isLast)) return;
            const r = btnRef.current;
            let tag = 0;
            try {
              const t = findNodeHandle(r);
              if (t && t > 0) tag = t;
            } catch (_) {}
            if (!tag && r._nativeTag && r._nativeTag > 0) tag = r._nativeTag;
            if (!tag && r.__nativeTag && r.__nativeTag > 0) tag = r.__nativeTag;
            if (tag && tag !== selfTag) setSelfTag(tag);
          };

          // Ladder of retries so we don't depend on a single mount-time call.
          useEffect(() => {
            if (!(isFirst || isLast)) return;
            const timers = [50, 200, 500, 1000, 2000].map((ms) => setTimeout(grabTag, ms));
            return () => { timers.forEach(clearTimeout); };
          }, [isFirst, isLast]);

          const trap = {};
          if (selfTag > 0) {
            if (isFirst) {
              trap.nextFocusLeft = selfTag;
            }
            if (isLast) {
              trap.nextFocusRight = selfTag;
            }
          }

          return (
            <Pressable
              ref={btnRef}
              {...props}
              {...trap}
              focusable={true}
              /* v238 — cold-boot focus lands on the Discover tab button.
                 Without this, no element claimed initial TV focus and the
                 selector ring was invisible until the user pressed a key. */
              hasTVPreferredFocus={isFirst}
              onLayout={grabTag}
              onFocus={() => { setIsFocused(true); grabTag(); }}
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
    borderWidth: 2,
    borderColor: '#B8A05C',
    borderRadius: 8,
    backgroundColor: 'rgba(184, 160, 92, 0.15)',
  },
  iconFocused: {
    transform: [{ scale: 1.1 }],
  },
});
