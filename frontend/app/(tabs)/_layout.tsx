import React, { useState } from 'react';
import { useEffect, useRef } from 'react';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Platform, View, useWindowDimensions, Pressable, BackHandler, ToastAndroid, findNodeHandle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// V261_TAB_FOCUS_CHAIN — module-level map of route.name -> native tag.
// Populated as each tab button mounts.  Used to wire every tab's
// nextFocusLeft / nextFocusRight to its adjacent sibling so D-pad LEFT/RIGHT
// stays inside the tab bar instead of jumping into the content posters.
const _v261TabOrder: string[] = ['discover', 'search', 'library', 'addons', 'profile'];
const _v261Tags: Record<string, number> = {};
const _v261Listeners: Array<() => void> = [];
function _v261Register(name: string, tag: number) {
  if (!name || !tag || tag <= 0) return;
  if (_v261Tags[name] === tag) return;
  _v261Tags[name] = tag;
  // Notify so siblings can re-read their nextFocus* props.
  _v261Listeners.slice().forEach((fn) => { try { fn(); } catch (_) {} });
}
function _v261Subscribe(fn: () => void) {
  _v261Listeners.push(fn);
  return () => {
    const i = _v261Listeners.indexOf(fn);
    if (i >= 0) _v261Listeners.splice(i, 1);
  };
}

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
        tabBarButton: (props: any) => {
          // V261_TAB_FOCUS_CHAIN — every tab button now explicitly wires
          // nextFocusLeft / nextFocusRight to its adjacent tab's tag so the
          // D-pad never escapes the tab bar horizontally.  The first tab
          // traps LEFT to itself; the last tab traps RIGHT to itself.
          const [isFocused, setIsFocused] = useState(false);
          const btnRef = useRef<any>(null);
          const [, _force] = useState(0);

          // Figure out which tab this button represents.
          const blob = String(
            (props.accessibilityLabel || '') + ' ' +
            (props.to || '') + ' ' +
            (props.href || '') + ' ' +
            (props.route?.name || '') + ' ' +
            (props.target || '')
          ).toLowerCase();
          let myName: string = '';
          for (const n of _v261TabOrder) {
            if (blob.indexOf(n) !== -1) { myName = n; break; }
          }
          const myIdx = _v261TabOrder.indexOf(myName);
          const isFirst = myIdx === 0;
          const isLast = myIdx === _v261TabOrder.length - 1;
          const leftName = myIdx > 0 ? _v261TabOrder[myIdx - 1] : '';
          const rightName = myIdx >= 0 && myIdx < _v261TabOrder.length - 1
            ? _v261TabOrder[myIdx + 1] : '';

          // Grab this button's native tag and register it.
          const grabTag = () => {
            if (!btnRef.current || !myName) return;
            const r = btnRef.current;
            let tag = 0;
            try {
              const t = findNodeHandle(r);
              if (t && t > 0) tag = t;
            } catch (_) {}
            if (!tag && r._nativeTag && r._nativeTag > 0) tag = r._nativeTag;
            if (!tag && r.__nativeTag && r.__nativeTag > 0) tag = r.__nativeTag;
            if (tag) _v261Register(myName, tag);
          };

          // Subscribe to sibling registrations so this button re-renders
          // once neighbor tags become available.
          useEffect(() => {
            if (!myName) return;
            const unsub = _v261Subscribe(() => _force((n) => n + 1));
            return unsub;
          }, [myName]);

          // Ladder of retries — mount, layout, plus delayed attempts.
          useEffect(() => {
            if (!myName) return;
            const timers = [0, 80, 250, 600, 1500].map((ms) => setTimeout(grabTag, ms));
            return () => { timers.forEach(clearTimeout); };
          }, [myName]);

          const selfTag = _v261Tags[myName] || 0;
          const leftTag = leftName ? (_v261Tags[leftName] || 0) : 0;
          const rightTag = rightName ? (_v261Tags[rightName] || 0) : 0;

          const trap: any = {};
          if (isFirst && selfTag > 0) {
            // Trap LEFT on first tab so it doesn't leave the bar.
            trap.nextFocusLeft = selfTag;
          } else if (leftTag > 0) {
            trap.nextFocusLeft = leftTag;
          }
          if (isLast && selfTag > 0) {
            // Trap RIGHT on last tab so it doesn't leave the bar.
            trap.nextFocusRight = selfTag;
          } else if (rightTag > 0) {
            trap.nextFocusRight = rightTag;
          }
          // Trap DOWN so user can't fall off the bottom into nothing.
          if (selfTag > 0) {
            trap.nextFocusDown = selfTag;
          }
          // UP is intentionally NOT set — Android TV's positional search
          // will find the closest poster directly above the focused tab,
          // which is exactly what the user wants ("up from a tab button
          // goes to the first poster above it").

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
              style={({ focused }: any) => [
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
