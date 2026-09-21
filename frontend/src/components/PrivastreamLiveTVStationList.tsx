import React from 'react';
import {
  NativeSyntheticEvent,
  requireNativeComponent,
  ViewStyle,
} from 'react-native';

export type PrivastreamLiveTVStationItem = {
  key: string;
  title: string;
  logo?: string | null;
  favorite?: boolean;
};

export type PrivastreamLiveTVStationFocusEvent = {
  index: number;
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PrivastreamLiveTVStationPressEvent = {
  index: number;
  key: string;
};

export type PrivastreamLiveTVStationScrollEvent = {
  offset: number;
};

type Props = {
  style?: ViewStyle;
  items: PrivastreamLiveTVStationItem[];
  rowHeight?: number;
  preferredFocusIndex?: number;

  onItemFocus?: (
    event: NativeSyntheticEvent<
      PrivastreamLiveTVStationFocusEvent
    >
  ) => void;

  onItemPress?: (
    event: NativeSyntheticEvent<
      PrivastreamLiveTVStationPressEvent
    >
  ) => void;

  onScrollPosition?: (
    event: NativeSyntheticEvent<
      PrivastreamLiveTVStationScrollEvent
    >
  ) => void;

  onRowBlur?: (
    event: NativeSyntheticEvent<
      Record<string, never>
    >
  ) => void;
};

export default requireNativeComponent<Props>(
  'PrivastreamLiveTVStationList'
);