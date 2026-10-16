import React from 'react';
import {
  NativeSyntheticEvent,
  requireNativeComponent,
  ViewStyle,
} from 'react-native';

export type PrivastreamCategoryRowItem = {
  id: string;
  label: string;
  selected?: boolean;
};

export type PrivastreamCategoryRowFocusEvent = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PrivastreamCategoryRowPressEvent = {
  index: number;
};

type Props = {
  style?: ViewStyle;
  items: PrivastreamCategoryRowItem[];
  itemWidth: number;
  itemHeight: number;
  gap: number;
  leftPadding: number;
  rightPadding: number;
  anchorColumn: number;
  preferredFocusIndex: number;
  focusRequest?: string;
  active: boolean;
  onItemFocus?: (
    event: NativeSyntheticEvent<PrivastreamCategoryRowFocusEvent>
  ) => void;
  onItemPress?: (
    event: NativeSyntheticEvent<PrivastreamCategoryRowPressEvent>
  ) => void;
  onRowBlur?: (
    event: NativeSyntheticEvent<Record<string, never>>
  ) => void;
};

export default requireNativeComponent<Props>(
  'PrivastreamCategoryRow'
);