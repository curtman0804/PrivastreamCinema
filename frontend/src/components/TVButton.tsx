import React, { useState } from 'react';
import { TouchableOpacity, StyleSheet, Platform, ViewStyle, TextStyle } from 'react-native';

interface TVButtonProps {
  onPress: () => void;
  style?: ViewStyle;
  focusedStyle?: ViewStyle;
  children: React.ReactNode;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
}

/**
 * A button component optimized for TV/Fire Stick remote navigation.
 * Shows a visible focus indicator when selected with D-pad.
 */
export const TVButton: React.FC<TVButtonProps> = ({
  onPress,
  style,
  focusedStyle,
  children,
  disabled = false,
  hasTVPreferredFocus = false,
}) => {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <TouchableOpacity
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      disabled={disabled}
      style={[
        style,
        isFocused && styles.focused,
        isFocused && focusedStyle,
        disabled && styles.disabled,
      ]}
      activeOpacity={0.7}
      // TV-specific props
      {...(Platform.isTV ? { hasTVPreferredFocus } : {})}
    >
      {children}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  focused: {
    borderWidth: 3,
    borderColor: '#B8A05C',
    transform: [{ scale: 1.05 }],
  },
  disabled: {
    opacity: 0.5,
  },
});

export default TVButton;
