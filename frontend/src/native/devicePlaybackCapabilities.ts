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