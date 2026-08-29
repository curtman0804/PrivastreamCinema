import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import {
  Platform,
  ScrollView,
  UIManager,
  View,
  requireNativeComponent,
} from 'react-native';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import codegenNativeCommands from 'react-native/Libraries/Utilities/codegenNativeCommands';

/**
 * V540_PSTV_SCROLL — drop-in vertical ScrollView for the Discover screen that
 * suppresses Android's auto-scroll-to-focused-child (the native "just visible"
 * hop that fought the JS title-to-top anchor and produced the double move).
 *
 * Backed by the native "PSTVScrollView" component (see plugins/withPSTVScrollView.js).
 * If that native view is not registered (e.g. Expo Go, web, or a build where the
 * plugin didn't run), it transparently falls back to a normal <ScrollView>, so
 * the screen can NEVER break — worst case the double-move simply returns.
 */

const NAME = 'PSTVScrollView';

function nativeAvailable(): boolean {
  if (Platform.OS !== 'android') return false;
  try {
    const um: any = UIManager as any;
    if (typeof um.hasViewManagerConfig === 'function') {
      return !!um.hasViewManagerConfig(NAME);
    }
    if (typeof um.getViewManagerConfig === 'function') {
      return !!um.getViewManagerConfig(NAME);
    }
  } catch (_) {}
  return false;
}

let NativeScroll: any = null;
let Commands: any = null;
if (nativeAvailable()) {
  try {
    NativeScroll = requireNativeComponent(NAME);
    Commands = (codegenNativeCommands as any)({
      supportedCommands: ['scrollTo', 'scrollToEnd'],
    });
  } catch (_) {
    NativeScroll = null;
    Commands = null;
  }
}

if (__DEV__) {
  // eslint-disable-next-line no-console
  console.log('[PSTV] native focus-scroll suppression =', !!NativeScroll);
}

type Props = {
  children?: React.ReactNode;
  contentContainerStyle?: any;
  onScroll?: (e: any) => void;
  [key: string]: any;
};

const PSTVScrollView = forwardRef<any, Props>((props, ref) => {
  const { children, contentContainerStyle, onScroll, ...rest } = props;
  const inner = useRef<any>(null);

  useImperativeHandle(
    ref,
    () => ({
      scrollTo: (opts: { x?: number; y?: number; animated?: boolean } = {}) => {
        const x = opts.x ?? 0;
        const y = opts.y ?? 0;
        const animated = opts.animated ?? true;
        const node = inner.current;
        if (!node) return;
        if (NativeScroll && Commands) {
          try {
            Commands.scrollTo(node, x, y, animated);
            return;
          } catch (_) {}
        }
        // Fallback <ScrollView> exposes scrollTo directly.
        try {
          node.scrollTo?.({ x, y, animated });
        } catch (_) {}
      },
    }),
    []
  );

  if (!NativeScroll) {
    return (
      <ScrollView
        ref={inner}
        contentContainerStyle={contentContainerStyle}
        onScroll={onScroll}
        {...rest}
      >
        {children}
      </ScrollView>
    );
  }

  // Native RCTScrollView expects a single content child; wrap children in a
  // content container so contentContainerStyle behaves like ScrollView's.
  // scrollEventThrottle is a JS-only prop on RN's ScrollView, so drop it here.
  const { scrollEventThrottle: _t, ...nativeRest } = rest;
  return (
    <NativeScroll ref={inner} onScroll={onScroll} {...nativeRest}>
      <View collapsable={false} style={contentContainerStyle}>
        {children}
      </View>
    </NativeScroll>
  );
});

PSTVScrollView.displayName = 'PSTVScrollView';

export default PSTVScrollView;
