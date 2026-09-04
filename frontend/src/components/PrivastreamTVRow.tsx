import React from 'react';
import {
  NativeSyntheticEvent,
  requireNativeComponent,
  ViewStyle,
} from 'react-native';

export type PrivastreamTVRowItem = {
  id: string;
  title: string;
  poster?: string | null;
};

export type PrivastreamTVRowFocusEvent = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type Props = {
  style?: ViewStyle;
  items: PrivastreamTVRowItem[];
  cardWidth: number;
  cardHeight: number;
  gap: number;
  leftPadding: number;
  rightPadding: number;
  anchorColumn: number;
  diagnosticLabel?: string;
  preferredFocusIndex?: number;
  onItemFocus?: (
    event: NativeSyntheticEvent<PrivastreamTVRowFocusEvent>
  ) => void;
  onRowBlur?: (event: NativeSyntheticEvent<Record<string, never>>) => void;
};

export default requireNativeComponent<Props>('PrivastreamTVRow');