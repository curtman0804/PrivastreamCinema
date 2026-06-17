// v251_OTAUpdater.tsx
// Silent OTA update checker for Privastream Cinema (Firestick / Android TV).
// Drop this file into src/components/OTAUpdater.tsx, then add ONE LINE to
// your root layout (app/_layout.tsx):
//
//   import OTAUpdater from '../src/components/OTAUpdater';
//   ...
//   <OTAUpdater />
//   <Slot />   // or <Stack /> etc.
//
// On app cold-start this component:
//   1. Asks the Hetzner backend if a newer JS bundle exists for runtimeVersion 1.0.0
//   2. If yes -> downloads the new bundle silently in the background
//   3. As soon as download is complete -> calls Updates.reloadAsync() to apply
//
// User sees: a slightly longer splash on the launch the update was applied,
// then the fresh build runs.  No prompts, no buttons, nothing to click.
//
// Skips entirely in __DEV__ mode (Metro) and on web.

import React, { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Updates from 'expo-updates';

const LOG_TAG = '[OTA v251]';

export default function OTAUpdater(): null {
  const didRunRef = useRef(false);

  useEffect(() => {
    if (didRunRef.current) return;
    didRunRef.current = true;

    // Never check in dev (Metro) or on web preview
    if (__DEV__) {
      console.log(LOG_TAG, 'skipping: __DEV__');
      return;
    }
    if (Platform.OS === 'web') {
      console.log(LOG_TAG, 'skipping: web');
      return;
    }
    if (!Updates.isEnabled) {
      console.log(LOG_TAG, 'skipping: Updates.isEnabled=false');
      return;
    }

    (async () => {
      try {
        console.log(LOG_TAG, 'checkForUpdateAsync...');
        const t0 = Date.now();
        const check = await Updates.checkForUpdateAsync();
        console.log(LOG_TAG, 'check result', {
          isAvailable: check.isAvailable,
          manifestId: (check as any)?.manifest?.id,
          ms: Date.now() - t0,
        });

        if (!check.isAvailable) return;

        console.log(LOG_TAG, 'fetchUpdateAsync...');
        const t1 = Date.now();
        const fetched = await Updates.fetchUpdateAsync();
        console.log(LOG_TAG, 'fetch result', {
          isNew: fetched.isNew,
          ms: Date.now() - t1,
        });

        if (fetched.isNew) {
          // Tiny delay so any in-flight render flush before reload.
          setTimeout(() => {
            console.log(LOG_TAG, 'reloadAsync()');
            Updates.reloadAsync().catch(err =>
              console.warn(LOG_TAG, 'reload failed', err),
            );
          }, 250);
        }
      } catch (err: any) {
        // Network errors here are non-fatal — the embedded bundle continues to run.
        console.warn(LOG_TAG, 'update check failed:', err?.message || err);
      }
    })();
  }, []);

  return null;
}
