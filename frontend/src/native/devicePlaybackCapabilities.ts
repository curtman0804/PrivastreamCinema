import { NativeModules } from 'react-native';

function readNativeValue(source: any, key: string): any {
  try {
    const value = source?.[key];
    return typeof value === 'undefined' ? null : value;
  } catch (_) {
    return null;
  }
}

function copyVideoCaps(source: any): any {
  if (!source) return null;

  return {
    decoderCount: readNativeValue(source, 'decoderCount'),
    decoderNames: readNativeValue(source, 'decoderNames'),
    supports1080p30: readNativeValue(source, 'supports1080p30'),
    supports4k30: readNativeValue(source, 'supports4k30'),
    supports4k60: readNativeValue(source, 'supports4k60'),
    main10: readNativeValue(source, 'main10'),
  };
}

export function getDevicePlaybackCapabilities(): any | null {
  try {
    const nativeModule =
      NativeModules?.PrivastreamDeviceCapabilities;

    if (!nativeModule) {
      return null;
    }

    /*
     * V659D_NATIVE_CONSTANT_PROJECTION
     *
     * Legacy/native-module properties may be exposed through a proxy and
     * therefore JSON.stringify(nativeModule) can produce {} even though
     * direct property access works.
     *
     * Project every expected capability into a normal JS object.
     */
    let source: any = nativeModule;
    let sourceKind = 'direct-properties';

    try {
      if (typeof nativeModule.getConstants === 'function') {
        const constants = nativeModule.getConstants();

        if (
          constants &&
          typeof constants === 'object' &&
          typeof constants.then !== 'function'
        ) {
          source = constants;
          sourceKind = 'getConstants';
        }
      }
    } catch (_) {}

    const video = readNativeValue(source, 'video');
    const audio = readNativeValue(source, 'audio');
    const display = readNativeValue(source, 'display');

    return {
      __source: sourceKind,
      __moduleKeys: (() => {
        try {
          return Object.keys(nativeModule);
        } catch (_) {
          return [];
        }
      })(),
      __hasGetConstants:
        typeof nativeModule.getConstants === 'function',

      manufacturer: readNativeValue(source, 'manufacturer'),
      model: readNativeValue(source, 'model'),
      device: readNativeValue(source, 'device'),
      product: readNativeValue(source, 'product'),
      sdkInt: readNativeValue(source, 'sdkInt'),
      isTelevision: readNativeValue(source, 'isTelevision'),

      memoryClassMb: readNativeValue(source, 'memoryClassMb'),
      largeMemoryClassMb: readNativeValue(source, 'largeMemoryClassMb'),
      lowRam: readNativeValue(source, 'lowRam'),

      display: {
        maxWidth: readNativeValue(display, 'maxWidth'),
        maxHeight: readNativeValue(display, 'maxHeight'),
        maxRefreshRate: readNativeValue(display, 'maxRefreshRate'),
        hdr10: readNativeValue(display, 'hdr10'),
        hdr10Plus: readNativeValue(display, 'hdr10Plus'),
        hlg: readNativeValue(display, 'hlg'),
        dolbyVision: readNativeValue(display, 'dolbyVision'),
      },

      video: {
        h264: copyVideoCaps(readNativeValue(video, 'h264')),
        hevc: copyVideoCaps(readNativeValue(video, 'hevc')),
        vp9: copyVideoCaps(readNativeValue(video, 'vp9')),
        av1: copyVideoCaps(readNativeValue(video, 'av1')),
      },

      audio: {
        aac: readNativeValue(audio, 'aac'),
        ac3: readNativeValue(audio, 'ac3'),
        eac3: readNativeValue(audio, 'eac3'),
        eac3Joc: readNativeValue(audio, 'eac3Joc'),
        opus: readNativeValue(audio, 'opus'),
        dts: readNativeValue(audio, 'dts'),
        dtsHd: readNativeValue(audio, 'dtsHd'),
        trueHd: readNativeValue(audio, 'trueHd'),
      },
    };
  } catch (_) {
    return null;
  }
}

// W121ZOD117C_NATIVE_PROFILE_AUTHORITY
//
// Android owns capability persistence. SharedPreferences is
// installation-local and hardware-fingerprint protected.
// getConstants() either returns the native stored profile or
// performs the one-time hardware scan and commits it.
let _w121zod117DeviceProfileMemory: any | null = null;

export function getStoredDevicePlaybackProfile(): any | null {
  if (_w121zod117DeviceProfileMemory) {
    return _w121zod117DeviceProfileMemory;
  }

  const profile =
    getDevicePlaybackCapabilities();

  if (profile) {
    _w121zod117DeviceProfileMemory = profile;
  }

  return profile;
}

export async function ensureDevicePlaybackProfile():
  Promise<any | null> {
  const profile =
    getStoredDevicePlaybackProfile();

  console.log(
    '[W121ZOD117C DEVICE PROFILE STARTUP]',
    'ready=' + String(!!profile),
    'model=' + String(profile?.model || ''),
    'device=' + String(profile?.device || ''),
    'sdk=' + String(profile?.sdkInt || '')
  );

  return profile;
}
// W121ZOD118A_NATIVE_OD_RANGE_BRIDGE
export type NativeOdRangeSample = {
  bytes: number;
  elapsedMs: number;
  mbps: number;
  status: number;
  contentRange: string;
};

export async function probeNativeOdRange(
  url: string,
  startByte: number,
  sampleBytes: number,
  timeoutMs: number
): Promise<NativeOdRangeSample> {
  const nativeModule: any =
    NativeModules?.PrivastreamDeviceCapabilities;

  if (
    !nativeModule ||
    typeof nativeModule.probeOdRange !== 'function'
  ) {
    throw new Error(
      'PrivastreamDeviceCapabilities.probeOdRange unavailable'
    );
  }

  const result =
    await nativeModule.probeOdRange(
      String(url || ''),
      Math.max(
        0,
        Number(startByte) || 0
      ),
      Math.max(
        64 * 1024,
        Math.min(
          Number(sampleBytes) || 0,
          4 * 1024 * 1024
        )
      ),
      Math.max(
        1000,
        Math.min(
          Number(timeoutMs) || 3000,
          8000
        )
      )
    );

  return {
    bytes:
      Number(result?.bytes || 0),
    elapsedMs:
      Number(result?.elapsedMs || 0),
    mbps:
      Number(result?.mbps || 0),
    status:
      Number(result?.status || 0),
    contentRange:
      String(result?.contentRange || ''),
  };
}

// V788T16J_LIVE_TV_DEVICE_PREFLIGHT
//
// Resolve only transport candidates the backend could not prove.
// Failure is intentionally fail-closed: an unverified channel must not
// enter the guide.
export async function probeLiveTvDeviceCandidates(
  candidates: any[],
  timeoutMs: number = 2500
): Promise<any> {
  const nativeModule: any =
    NativeModules?.PrivastreamDeviceCapabilities;

  if (
    !nativeModule ||
    typeof nativeModule.probeLiveTvCandidates !==
      'function'
  ) {
    throw new Error(
      'PrivastreamDeviceCapabilities.probeLiveTvCandidates unavailable'
    );
  }

  return await nativeModule.probeLiveTvCandidates(
    Array.isArray(candidates)
      ? candidates
      : [],
    Math.max(
      500,
      Math.min(
        Number(timeoutMs) || 2500,
        4000
      )
    )
  );
}
