import React, { useState } from 'react';
import { TouchableOpacity, StyleSheet, Platform, ViewStyle } from 'react-native';

interface TVButtonProps {
  onPress: () => void;
  style?: ViewStyle;
  focusedStyle?: ViewStyle;
  children: React.ReactNode;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
}

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