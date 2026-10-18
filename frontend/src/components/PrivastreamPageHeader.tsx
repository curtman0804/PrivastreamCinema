import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';

type Props = {
  title?: string;
};

// W121ZUI135A_LIVETV_MATCHED_PAGE_HEADER
// Live TV is the visual authority: 64x48 icon at left 0/top 2 inside a
// 24px-left / 18px-top page header shell.
export function PrivastreamPageHeader({ title = '' }: Props) {
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;

  return (
    <View pointerEvents="none" style={styles.shell}>
      <Image
        source={require('../../assets/images/livetv-header-icon.png')}
        style={styles.logo}
        contentFit="contain"
      />

      {!!title && (
        <Text style={[styles.title, isTV && styles.titleTV]}>
          {title}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    height: 52,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    marginTop: 18,
    marginBottom: 10,
    position: 'relative',
  },
  logo: {
    width: 64,
    height: 48,
    position: 'absolute',
    left: 0,
    top: 2,
    zIndex: 2,
  },
  title: {
    marginLeft: 80,
    color: '#B8A05C',
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  titleTV: {
    fontSize: 28,
  },
});
