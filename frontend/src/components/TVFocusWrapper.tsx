import React, { useState, useRef, useCallback, ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  ViewStyle,
  Platform,
  findNodeHandle,
} from 'react-native';

interface TVFocusWrapperProps {
  children: ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
  focusStyle?: ViewStyle;
  hasTVPreferredFocus?: boolean;
  nextFocusDown?: number;
  nextFocusUp?: number;
  nextFocusLeft?: number;
  nextFocusRight?: number;
  disabled?: boolean;
}

export const TVFocusWrapper: React.FC<TVFocusWrapperProps> = ({
  children,
  onPress,
  style,
  focusStyle,
  hasTVPreferredFocus = false,
  nextFocusDown,
  nextFocusUp,
  nextFocusLeft,
  nextFocusRight,
  disabled = false,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const ref = useRef<View>(null);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
  }, []);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
  }, []);

  const defaultFocusStyle: ViewStyle = {
    borderWidth: 3,
    borderColor: '#FFD700',
    transform: [{ scale: 1.05 }],
  };

  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      onFocus={handleFocus}
      onBlur={handleBlur}
      disabled={disabled}
      style={[
        styles.base,
        style,
        isFocused && (focusStyle || defaultFocusStyle),
      ]}
      // TV-specific props
      {...(Platform.isTV && {
        hasTVPreferredFocus,
        nextFocusDown,
        nextFocusUp,
        nextFocusLeft,
        nextFocusRight,
      })}
    >
      {children}
      {isFocused && <View style={styles.focusIndicator} />}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    position: 'relative',
  },
  focusIndicator: {
    position: 'absolute',
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderWidth: 3,
    borderColor: '#FFD700',
    borderRadius: 10,
    pointerEvents: 'none',
  },
});

export default TVFocusWrapper;
