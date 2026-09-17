import {
  NativeModules,
  Platform,
} from 'react-native';

// V753_NATIVE_TORRENT_BRIDGE

type NativeTorrentModule = {
  prepareTorrent(
    infoHash: string,
    magnet: string,
    fileIdx: number,
    filename: string,
  ): Promise<NativeTorrentPrepareResult>;

  startEngine(): Promise<Record<string, unknown>>;

  engineStatus(): Promise<Record<string, unknown>>;

  stopEngine(): Promise<Record<string, unknown>>;

  probe(): Promise<Record<string, unknown>>;
};

export type NativeTorrentPrepareResult = {
  status: string;
  infoHash: string;
  fileIdx: number;
  filename: string;
  filePath: string;
  fileSize: number;
  pieceLength: number;
  firstPiece: number;
  lastPiece: number;
  peers: number;
  downloadRate: number;
  playbackUrl: string;
  playbackPort: number;
};

export type NativeTorrentPrepareInput = {
  infoHash: string;
  fileIdx?: number;
  filename?: string;
  sources?: string[];
};

const nativeModule: NativeTorrentModule | undefined =
  NativeModules?.PrivastreamTorrent;

function normalizeHash(
  value: string,
): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function buildMagnet(
  infoHash: string,
  sources?: string[],
): string {
  const hash =
    normalizeHash(infoHash);

  if (!/^[0-9a-f]{40}$/.test(hash)) {
    throw new Error(
      'V753_INVALID_INFOHASH',
    );
  }

  const list =
    Array.isArray(sources)
      ? sources
      : [];

  const suppliedMagnet =
    list.find(
      source =>
        typeof source === 'string' &&
        source
          .trim()
          .toLowerCase()
          .startsWith('magnet:'),
    );

  if (suppliedMagnet) {
    return suppliedMagnet.trim();
  }

  let magnet =
    `magnet:?xt=urn:btih:${hash}`;

  const seen =
    new Set<string>();

  for (const raw of list) {
    if (typeof raw !== 'string') {
      continue;
    }

    const source =
      raw.trim();

    if (
      !source
        .toLowerCase()
        .startsWith('tracker:')
    ) {
      continue;
    }

    const tracker =
      source
        .slice('tracker:'.length)
        .trim();

    if (
      !tracker ||
      seen.has(tracker)
    ) {
      continue;
    }

    seen.add(tracker);

    magnet +=
      `&tr=${encodeURIComponent(tracker)}`;

    if (seen.size >= 50) {
      break;
    }
  }

  return magnet;
}

function requireNativeModule():
  NativeTorrentModule {
  if (
    Platform.OS !== 'android' ||
    !nativeModule
  ) {
    throw new Error(
      'V753_NATIVE_TORRENT_UNAVAILABLE',
    );
  }

  return nativeModule;
}

export const privastreamTorrent = {
  isAvailable(): boolean {
    return (
      Platform.OS === 'android' &&
      !!nativeModule &&
      typeof nativeModule.prepareTorrent ===
        'function'
    );
  },

  async prepare(
    input: NativeTorrentPrepareInput,
  ): Promise<NativeTorrentPrepareResult> {
    const module =
      requireNativeModule();

    const hash =
      normalizeHash(
        input.infoHash,
      );

    if (!/^[0-9a-f]{40}$/.test(hash)) {
      throw new Error(
        'V753_INVALID_INFOHASH',
      );
    }

    const fileIdx =
      typeof input.fileIdx === 'number' &&
      Number.isInteger(input.fileIdx) &&
      input.fileIdx >= 0
        ? input.fileIdx
        : -1;

    const filename =
      typeof input.filename === 'string'
        ? input.filename.trim()
        : '';

    const magnet =
      buildMagnet(
        hash,
        input.sources,
      );

    const result =
      await module.prepareTorrent(
        hash,
        magnet,
        fileIdx,
        filename,
      );

    if (
      !result ||
      result.status !== 'prepared' ||
      typeof result.playbackUrl !==
        'string' ||
      !result.playbackUrl.startsWith(
        'http://127.0.0.1:',
      )
    ) {
      throw new Error(
        'V753_NATIVE_PREP_INVALID_RESULT',
      );
    }

    return result;
  },

  startEngine() {
    return requireNativeModule()
      .startEngine();
  },

  status() {
    return requireNativeModule()
      .engineStatus();
  },

  stopEngine() {
    return requireNativeModule()
      .stopEngine();
  },

  probe() {
    return requireNativeModule()
      .probe();
  },
};

export default privastreamTorrent;
