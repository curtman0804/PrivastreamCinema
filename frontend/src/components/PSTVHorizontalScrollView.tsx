import React, { forwardRef } from 'react';
import { ScrollView } from 'react-native';

/**
 * Real React Native/Fabric horizontal ScrollView for TV content rows.
 *
 * Do not replace this with a custom requireNativeComponent ScrollView.
 * FlashList depends on RN's native ScrollView Fabric descriptor to expose
 * the full horizontal content extent for virtualization and D-pad focus.
 */
const PSTVHorizontalScrollView = forwardRef<any, any>((props, ref) => (
  <ScrollView ref={ref} {...props} horizontal />
));

PSTVHorizontalScrollView.displayName = 'PSTVHorizontalScrollView';

export default PSTVHorizontalScrollView;
