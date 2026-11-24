import React, { useState } from 'react';
import { useEffect, useRef } from 'react';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { useBU23ISAppActiveHealth } from '../../src/liveAddonAppActiveHealth'; // BU23IS_APP_ACTIVE_HEALTH_OWNER
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Platform, View, useWindowDimensions, Pressable, BackHandler, ToastAndroid, findNodeHandle, DeviceEventEmitter } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ensurePrivastreamTunnel } from '../../src/native/privastreamTunnelGate';

// V261_TAB_FOCUS_CHAIN ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â module-level map of route.name -> native tag.
// Populated as each tab button mounts.  Used to wire every tab's
// nextFocusLeft / nextFocusRight to its adjacent sibling so D-pad LEFT/RIGHT
// stays inside the tab bar instead of jumping into the content posters.
const _v261TabOrder: string[] = ['livetv', 'sports', 'discover', 'search', 'library', 'addons', 'profile'];
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
  // V740_AUTHENTICATED_TUNNEL_GATE
  // Authenticated Android UI remains fail-closed until the
  // Privastream-only WireGuard tunnel is verified UP.
  const [_v740TunnelReady, _v740SetTunnelReady] =
    useState(Platform.OS !== 'android');
  const _v740TunnelStartedRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      _v740SetTunnelReady(true);
      return;
    }

    if (_v740TunnelStartedRef.current) {
      return;
    }

    _v740TunnelStartedRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        console.log('[V740_TUNNEL] authenticated gate starting');

        await ensurePrivastreamTunnel();

        if (!cancelled) {
          _v740SetTunnelReady(true);
        }
      } catch (error: any) {
        const message =
          String(
            error?.message ||
            error ||
            'Privastream secure connection failed'
          );

        console.error('[V740_TUNNEL] FAIL', message);

        if (!cancelled) {
          try {
            ToastAndroid.show(
              'Privastream secure connection failed',
              ToastAndroid.LONG
            );
          } catch (_) {}

          // Intentionally do NOT render authenticated tabs.
          // This is the V740 fail-closed behavior.
          _v740SetTunnelReady(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // PATCH_V71_BACK_ROUTE_AWARE - hardware back is route-aware now.
  //   Nested screens -> router.back()
  //   Non-Discover tabs -> go to Discover
  //   Discover (root) -> return false, OS exits the app
  const pathname = usePathname();
  useBU23ISAppActiveHealth(pathname); // BU23IS_APP_ACTIVE_HEALTH_OWNER
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
      if (p === '/' || p.endsWith('/livetv') || p === '/(tabs)' || p === '/(tabs)/livetv') {
        return false;
      }
      // Any other tab -> back to Discover
      try {
        router.replace('/(tabs)/livetv');
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
  const tabBarHeight = isTV ? 60 : 65 + bottomPadding;

  // V740_FAIL_CLOSED_RENDER
  if (!_v740TunnelReady) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#0c0c0c',
        }}
      />
    );
  }
  return (
    <Tabs
      screenOptions={{
        // PATCH_V14B_FREEZE_ON_BLUR_TABS
        // PATCH_V40_NO_FREEZE ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â keep Discover mounted; back returns instantly.
        freezeOnBlur: false,
        lazy: true,
        headerShown: false,
        tabBarStyle: [
          styles.tabBar,
          isTV && styles.tabBarTV,
          {
            height: tabBarHeight,
            paddingBottom: isTV ? 2 : bottomPadding,
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
          // V261_TAB_FOCUS_CHAIN ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â every tab button now explicitly wires
          // nextFocusLeft / nextFocusRight to its adjacent tab's tag so the
          // D-pad never escapes the tab bar horizontally.  The first tab
          // traps LEFT to itself; the last tab traps RIGHT to itself.
          const [isFocused, setIsFocused] = useState(false);
          const btnRef = useRef<any>(null);

          // V788T8Y_R3_TRAY_REQUEST_PENDING
          const v788t8yTrayRequestPendingRef =
            useRef(false);
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

          // V788T8Y_R3_REAL_TV_TRAY_FOCUS
          useEffect(() => {
            if (myName !== 'livetv') return;

            const sub = DeviceEventEmitter.addListener(
              'v788t8c:focusLiveTvTray',
              () => {
                const r: any = btnRef.current;

                if (!r) {
                  console.warn(
                    '[V788T8Y TRAY] Live TV ref unavailable'
                  );
                  return;
                }

                v788t8yTrayRequestPendingRef.current =
                  true;

                try {
                  if (
                    typeof r.requestTVFocus === 'function'
                  ) {
                    console.log(
                      '[V788T8Y TRAY] requestTVFocus'
                    );

                    r.requestTVFocus();
                    return;
                  }

                  if (typeof r.focus === 'function') {
                    console.log(
                      '[V788T8Y TRAY] generic focus fallback'
                    );

                    r.focus();
                    return;
                  }

                  v788t8yTrayRequestPendingRef.current =
                    false;

                  console.warn(
                    '[V788T8Y TRAY] no focus API'
                  );
                } catch (error) {
                  v788t8yTrayRequestPendingRef.current =
                    false;

                  console.warn(
                    '[V788T8Y TRAY] focus request failed',
                    error
                  );
                }
              }
            );

            return () => {
              try { sub.remove(); } catch (_) {}
            };
          }, [myName]);

          // Ladder of retries ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â mount, layout, plus delayed attempts.
          useEffect(() => {
            if (!myName) return;
            const timers = [0, 80, 250, 600, 1500].map((ms) => setTimeout(grabTag, ms));
            return () => { timers.forEach(clearTimeout); };
          }, [myName]);

          const selfTag = _v261Tags[myName] || 0;
          const leftTag = leftName ? (_v261Tags[leftName] || 0) : 0;
          const rightTag = rightName ? (_v261Tags[rightName] || 0) : 0;          
          // FOCUS_FIX_V1:
          // Let Android/Fire TV use normal spatial navigation.
          // Do not force UP/DOWN to previously focused poster tags.
          // LEFT/RIGHT remains explicitly chained within the tab bar.
          const trap: any = {};

          if (isFirst && selfTag > 0) {
            trap.nextFocusLeft = selfTag;
          } else if (leftTag > 0) {
            trap.nextFocusLeft = leftTag;
          }

          if (isLast && selfTag > 0) {
            trap.nextFocusRight = selfTag;
          } else if (rightTag > 0) {
            trap.nextFocusRight = rightTag;
          }

          return (
            <Pressable
              ref={btnRef}
              {...props}
              {...trap}
              focusable={true}
              /* v238 ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â cold-boot focus lands on the Discover tab button.
                 Without this, no element claimed initial TV focus and the
                 selector ring was invisible until the user pressed a key. */
              hasTVPreferredFocus={isFirst}
              onLayout={grabTag}
              onFocus={() => {
                setIsFocused(true);
                grabTag();

                // V788T8Y_R3_REAL_FOCUS_ACK
                if (
                  myName === 'livetv' &&
                  v788t8yTrayRequestPendingRef.current
                ) {
                  v788t8yTrayRequestPendingRef.current =
                    false;

                  console.log(
                    '[V788T8Y TRAY] REAL FOCUS ACQUIRED'
                  );

                  DeviceEventEmitter.emit(
                    'v788t8y:liveTvTrayFocused'
                  );
                }
              }}
              onBlur={() => {
                setIsFocused(false);
              }}
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
        name="livetv"
        options={{
          // V788T12H_EAGER_LIVE_TV_LOAD
          // Mount Live TV with the authenticated tab navigator so its
          // inventory load continues even when another tab is active.
          lazy: false,
          title: 'Live TV',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={focused && isTV ? styles.iconFocused : undefined}>
              <Ionicons name="tv" size={isTV ? 28 : size} color={color} />
            </View>
          ),
        }}
      />
      {/* W121ZSPORTS133C_SPORTS_TAB */}
      <Tabs.Screen
        name="sports"
        options={{
          title: 'Sports',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={focused && isTV ? styles.iconFocused : undefined}>
              <Ionicons name="trophy" size={isTV ? 28 : size} color={color} />
            </View>
          ),
        }}
      />
      {/* /W121ZSPORTS133C_SPORTS_TAB */}
      <Tabs.Screen
        name="discover"
        options={{
          // W121ZPLAY10Y19A_EAGER_ON_DEMAND_LOAD
          // Mount On Demand with Live TV so both pipelines warm at startup.
          // Existing discover InteractionManager deferral remains unchanged.
          lazy: false,
          title: 'On Demand',
          tabBarIcon: ({ color, size, focused }) => (
            <View style={focused && isTV ? styles.iconFocused : undefined}>
              <View
                style={{
                  width: isTV ? 30 : 26,
                  height: isTV ? 21 : 18,
                  borderWidth: 2,
                  borderColor: color,
                  borderRadius: 6,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons
                  name="play"
                  size={isTV ? 13 : 11}
                  color={color}
                />
              </View>
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
    paddingTop: 2,
  },
  tabBarTV: {
    // V788T8X_THIN_ALWAYS_VISIBLE_TRAY
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: '#333333',
    zIndex: 100,
    elevation: 20,
  },
  tabBarLabel: {
    fontSize: 9,
    fontWeight: '600',
  },
  tabBarLabelTV: {
    fontSize: 11,
    fontWeight: '700',
  },
  tabBarItem: {
    paddingVertical: 4,
  },
  tabBarItemTV: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginHorizontal: 2,
    borderRadius: 0,
  },
  tabItemFocused: {
    // V788T8X_GOLD_UNDERLINE_SELECTOR
    borderWidth: 0,
    borderBottomWidth: 5,
    borderBottomColor: '#B8A05C',
    borderRadius: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 4,
    paddingTop: 0,
    paddingBottom: 2,
    marginHorizontal: -4,
    marginVertical: 0,
  },
  iconFocused: {
    transform: [{ scale: 1.05 }],
  },
});



