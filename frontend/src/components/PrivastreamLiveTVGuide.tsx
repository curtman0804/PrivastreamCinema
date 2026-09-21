import React from 'react';
import {
  NativeSyntheticEvent,
  requireNativeComponent,
  ViewStyle,
} from 'react-native';

export type PrivastreamLiveTVGuideProgram = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
};

export type PrivastreamLiveTVGuideItem = {
  key: string;
  title: string;
  logo?: string | null;
  favorite?: boolean;
  programs: PrivastreamLiveTVGuideProgram[];
};

export type PrivastreamLiveTVGuideFocusEvent = {
  index: number;
  zone: 'station' | 'program';
  programIndex: number;
  anchorMs?: number;
};

export type PrivastreamLiveTVGuidePressEvent = {
  index: number;
  zone: 'station' | 'program';
  programIndex: number;
};

export type PrivastreamLiveTVGuideHorizontalEvent = {
  offset: number;
};

type Props = {
  style?: ViewStyle;
  items: PrivastreamLiveTVGuideItem[];

  rowHeight: number;
  channelWidth: number;

  slotWidth: number;
  slotCount: number;
  slotMs: number;

  timelineStartMs: number;
  nowMs: number;

  preferredFocusIndex?: number;

  // V788T8V_RETURN_FOCUS_HANDSHAKE
  focusRestoreRequest?: string;

  onHorizontalScroll?: (
    event: NativeSyntheticEvent<
      PrivastreamLiveTVGuideHorizontalEvent
    >
  ) => void;

  onItemFocus?: (
    event: NativeSyntheticEvent<
      PrivastreamLiveTVGuideFocusEvent
    >
  ) => void;

  onItemPress?: (
    event: NativeSyntheticEvent<
      PrivastreamLiveTVGuidePressEvent
    >
  ) => void;
};

export default requireNativeComponent<Props>(
  'PrivastreamLiveTVGuide'
);