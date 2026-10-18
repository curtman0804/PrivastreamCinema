// V509_PREMIUMIZE_SERVER_SECURITY
// Premiumize credentials remain server-side. The client receives only status, cache results, and playable URLs.

import AsyncStorage from '../utils/mmkvStorage';
import { probeNativeOdRange } from '../native/devicePlaybackCapabilities';

const CACHE_KEY_PREFIX = '@pmcache:';
const TTL_MS = 6 * 60 * 60 * 1000;

// Backend URL + auth token — kept in sync with the rest of the app.
// We try multiple AsyncStorage keys the auth store has used over time.
const AUTH_TOKEN_KEYS = ['auth_token', '@auth_token', 'authToken', 'jwt', '@jwt'];
// Hetzner backend.  Must match v287_client BACKEND_URL.
const BACKEND_URL = 'https://api.privastreamsolutions.com';

type CacheEntry = { finalUrl: string; expiresAt: number };

// ------------------------------------------------------------
// LOCAL STORAGE HELPERS
// ------------------------------------------------------------
async function _getAuthHeader(): Promise<string | null> {
  for (const k of AUTH_TOKEN_KEYS) {
    try {
      const t = await AsyncStorage.getItem(k);
      if (t) {
        const v = t.replace(/^"|"$/g, '');                       // strip JSON quotes if persisted
        return v.startsWith('Bearer ') ? v : `Bearer ${v}`;
      }
    } catch (_) {}
  }
  return null;
}

function _cacheKey(infoHash: string, season?: number, episode?: number): string {
  const h = String(infoHash || '').toLowerCase().trim();
  if (season != null && episode != null && Number.isFinite(season) && Number.isFinite(episode)) {
    return `${CACHE_KEY_PREFIX}${h}:s${season}:e${episode}`;
  }
  return `${CACHE_KEY_PREFIX}${h}`;
}

async function _readCache(infoHash: string, season?: number, episode?: number): Promise<CacheEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(_cacheKey(infoHash, season, episode));
    if (!raw) return null;
    const e: CacheEntry = JSON.parse(raw);
    if (Date.now() > e.expiresAt) return null;
    return e;
  } catch (_) { return null; }
}

async function _writeCache(infoHash: string, e: CacheEntry, season?: number, episode?: number) {
  try { await AsyncStorage.setItem(_cacheKey(infoHash, season, episode), JSON.stringify(e)); }
  catch (_) {}
}

// ------------------------------------------------------------
// BACKEND SYNC
// ------------------------------------------------------------
const _SYNC_TIMEOUT_MS = 6000;

async function _fetchWithTimeout(url: string, opts: any = {}, timeoutMs = _SYNC_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

// V509_PREMIUMIZE_SERVER_SECURITY - the client receives status/results only, never the API key.
export async function configurePremiumize(apiKey: string): Promise<{ configured: boolean; username?: string; premium_until?: number }> {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('PM_KEY_REQUIRED');
  const auth = await _getAuthHeader();
  if (!auth) throw new Error('NO_AUTH');
  const res = await _fetchWithTimeout(`${BACKEND_URL}/api/premiumize/configure`, {
    method: 'PUT',
    headers: { 'Authorization': auth, 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key }),
  }, 12000);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.detail || PM_CONFIG_HTTP_);
  return { configured: !!j?.configured, username: j?.username, premium_until: j?.premium_until };
}

export async function disconnectPremiumize(): Promise<boolean> {
  const auth = await _getAuthHeader();
  if (!auth) throw new Error('NO_AUTH');
  const res = await _fetchWithTimeout(`${BACKEND_URL}/api/premiumize/configure`, {
    method: 'DELETE',
    headers: { 'Authorization': auth, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(PM_DISCONNECT_HTTP_);
  return true;
}

export async function isPremiumizeConfigured(): Promise<boolean> {
  const auth = await _getAuthHeader();
  if (!auth) {
    console.warn('[V738R1_PM_STATUS] auth=missing');
    return false;
  }
  try {
    const res = await _fetchWithTimeout(`${BACKEND_URL}/api/premiumize/status`, {
      method: 'GET',
      headers: { 'Authorization': auth, 'Accept': 'application/json' },
    });
    if (!res.ok) {
      console.warn('[V738R1_PM_STATUS] http=' + String(res.status));
      return false;
    }
    const j = await res.json();
    const configured = !!j?.configured;
    console.log(
      '[V738R1_PM_STATUS] http=' +
      String(res.status) +
      ' configured=' +
      String(configured)
    );
    return configured;
  } catch (e: any) {
    console.warn(
      '[V738R1_PM_STATUS] error=' +
      String(e?.message || e)
    );
    return false;
  }
}

export async function premiumizeCacheCheck(items: string[], timeoutMs: number = 12000): Promise<boolean[]> {
  const cleaned = (items || []).map(x => String(x || '').trim().toLowerCase()).filter(Boolean).slice(0, 50);
  if (cleaned.length === 0) return [];
  const auth = await _getAuthHeader();
  if (!auth) throw new Error('NO_AUTH');
  const res = await _fetchWithTimeout(`${BACKEND_URL}/api/premiumize/cache-check`, {
    method: 'POST',
    headers: { 'Authorization': auth, 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: cleaned }),
  }, timeoutMs);
  if (res.status === 409) throw new Error('NO_PM_KEY');
  if (!res.ok) throw new Error(`PM_CACHE_HTTP_${res.status}`);
  const j = await res.json();
  if (j?.status !== 'success' || !Array.isArray(j?.response)) throw new Error(`PM_CACHE_${j?.status || 'unknown'}`);
  return j.response.map((v: any) => !!v);
}

export async function premiumizeDirectDL(src: string, timeoutMs: number = 22000): Promise<any[]> {
  const magnet = String(src || '').trim();
  if (!magnet.toLowerCase().startsWith('magnet:?xt=urn:btih:')) throw new Error('INVALID_MAGNET');
  const auth = await _getAuthHeader();
  if (!auth) throw new Error('NO_AUTH');
  const res = await _fetchWithTimeout(`${BACKEND_URL}/api/premiumize/directdl`, {
    method: 'POST',
    headers: { 'Authorization': auth, 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ src: magnet }),
  }, timeoutMs);
  if (res.status === 409) throw new Error('NO_PM_KEY');
  if (!res.ok) throw new Error(`PM_DIRECT_HTTP_${res.status}`);
  const j = await res.json();
  if (j?.status !== 'success' || !Array.isArray(j?.content)) throw new Error(`PM_DIRECT_${j?.status || 'unknown'}:${j?.message || ''}`);
  return j.content;
}

export type PremiumizeMediaProbeResult = {
  status: 'success';
  path: string;
  link: string;
  size?: string | number | null;
  format?: {
    format_name?: string | null;
    duration?: string | null;
    bit_rate?: string | null;
  };
  video: any[];
  audio: any[];
};

// W121ZOD108E1_AUTHENTICATED_MEDIA_PROBE_CLIENT
// The backend re-resolves the magnet with the logged-in user's Premiumize
// credential and probes only the exact returned content path. No arbitrary
// media URL is accepted from the client.
export async function premiumizeMediaProbe(
  src: string,
  path: string,
  timeoutMs: number = 45000
): Promise<PremiumizeMediaProbeResult> {
  const magnet = String(src || '').trim();
  const mediaPath = String(path || '').trim();

  if (!magnet.toLowerCase().startsWith('magnet:?xt=urn:btih:')) {
    throw new Error('INVALID_MAGNET');
  }

  if (!mediaPath) {
    throw new Error('PM_PROBE_PATH_REQUIRED');
  }

  const auth = await _getAuthHeader();
  if (!auth) throw new Error('NO_AUTH');

  const res = await _fetchWithTimeout(
    `${BACKEND_URL}/api/premiumize/media-probe`,
    {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        src: magnet,
        path: mediaPath,
      }),
    },
    timeoutMs
  );

  if (res.status === 409) throw new Error('NO_PM_KEY');

  const j = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      `PM_MEDIA_PROBE_HTTP_${res.status}:${String(j?.detail || '')}`
    );
  }

  if (
    j?.status !== 'success' ||
    typeof j?.link !== 'string' ||
    !Array.isArray(j?.video) ||
    !Array.isArray(j?.audio)
  ) {
    throw new Error('PM_MEDIA_PROBE_INVALID');
  }

  return j as PremiumizeMediaProbeResult;
}

export type PremiumizeDeliveryProbeResult = {
  ok: boolean;
  reason: string;
  mediaMbps: number;
  sampleMbps: number[];
  minMbps: number;
  medianMbps: number;
  minRatio: number;
  medianRatio: number;
  sampleBytes: number;
  fileSizeBytes: number;
};

type _W121ZOD108GRangeSample = {
  bytes: number;
  elapsedMs: number;
  mbps: number;
};

async function _w121zod108gRangeSample(
  url: string,
  startByte: number,
  sampleBytes: number,
  timeoutMs: number
): Promise<_W121ZOD108GRangeSample> {
  // W121ZOD118A_NATIVE_RANGE_SAMPLE
  //
  // Range behavior and throughput are measured by Android's
  // HttpURLConnection on the actual playback device. Do not use
  // React Native XMLHttpRequest for OD readiness authority.
  try {
    const sample =
      await probeNativeOdRange(
        url,
        startByte,
        sampleBytes,
        timeoutMs
      );

    const bytes =
      Number(sample?.bytes || 0);

    const elapsedMs =
      Number(sample?.elapsedMs || 0);

    const mbps =
      Number(sample?.mbps || 0);

    if (
      bytes < sampleBytes ||
      elapsedMs <= 0 ||
      !Number.isFinite(mbps) ||
      mbps <= 0
    ) {
      throw new Error('SHORT_READ');
    }

    return {
      bytes,
      elapsedMs,
      mbps,
    };
  } catch (error) {
    const raw =
      String(
        (error as any)?.code ||
        (error as any)?.message ||
        error ||
        ''
      );

    try {
      console.warn(
        '[W121ZOD118A NATIVE RANGE ERROR]',
        'start=' + String(startByte),
        'bytes=' + String(sampleBytes),
        'error=' + raw
      );
    } catch (_) {}

    if (
      raw.includes('OD_RANGE_RANGE_UNSUPPORTED')
    ) {
      throw new Error('RANGE_UNSUPPORTED');
    }

    if (
      raw.includes('OD_RANGE_TIMEOUT')
    ) {
      throw new Error('TIMEOUT');
    }

    if (
      raw.includes('OD_RANGE_SHORT_READ') ||
      raw.includes('SHORT_READ')
    ) {
      throw new Error('SHORT_READ');
    }

    throw new Error(
      'NATIVE_RANGE_ERROR:' + raw
    );
  }
}

// W121ZOD134M_FAST_STARTUP_DELIVERY_SAMPLE
// One small native HTTP Range read on the actual playback device. This runs
// concurrently with the exact media probe so it does not add serial wait to
// Preparing Media. It is intentionally a viability sample, not a full seek
// benchmark; Player runtime failover remains the final delivery authority.
export type PremiumizeStartupDeliverySampleResult = {
  ok: boolean;
  reason: string;
  sampleMbps: number;
  sampleBytes: number;
  fileSizeBytes: number;
  elapsedMs: number;
};

export async function premiumizeStartupDeliverySample(
  link: string,
  fileSize: string | number | null | undefined
): Promise<PremiumizeStartupDeliverySampleResult> {
  const url = String(link || '').trim();
  const fileSizeBytes = Number(fileSize || 0);
  const sampleBytes = 256 * 1024;

  const empty = (
    reason: string
  ): PremiumizeStartupDeliverySampleResult => ({
    ok: false,
    reason,
    sampleMbps: 0,
    sampleBytes,
    fileSizeBytes:
      Number.isFinite(fileSizeBytes)
        ? fileSizeBytes
        : 0,
    elapsedMs: 0,
  });

  if (
    !url.toLowerCase().startsWith('https://')
  ) {
    return empty(
      'startup-delivery-url-invalid'
    );
  }

  if (
    !Number.isFinite(fileSizeBytes) ||
    fileSizeBytes <= sampleBytes
  ) {
    return empty(
      'startup-delivery-size-invalid'
    );
  }

  const maxStart =
    Math.max(
      0,
      Math.floor(
        fileSizeBytes -
        sampleBytes -
        1
      )
    );

  const startByte =
    Math.floor(
      maxStart * 0.35
    );

  try {
    const sample =
      await _w121zod108gRangeSample(
        url,
        startByte,
        sampleBytes,
        2500
      );

    return {
      ok: true,
      reason:
        'startup-delivery-sampled',
      sampleMbps: sample.mbps,
      sampleBytes,
      fileSizeBytes,
      elapsedMs: sample.elapsedMs,
    };
  } catch (error) {
    const message =
      String(
        (error as any)?.message ||
        error ||
        ''
      );

    return {
      ...empty(
        message === 'TIMEOUT'
          ? 'startup-delivery-timeout'
          : message ===
              'RANGE_UNSUPPORTED'
            ? 'startup-delivery-range-unsupported'
            : message === 'SHORT_READ'
              ? 'startup-delivery-short-read'
              : 'startup-delivery-sample-error'
      ),
    };
  }
}
// W121ZOD108G_DEVICE_DELIVERY_PROBE
// Measure the exact Premiumize HTTPS media URL on the playback
// device after codec compatibility passes and before player mount.
// Three separated byte ranges must maintain substantial headroom
// above the media's own actual bitrate.
export async function premiumizeDeliveryProbe(
  link: string,
  bitRate: string | number | null | undefined,
  duration: string | number | null | undefined,
  fileSize: string | number | null | undefined
): Promise<PremiumizeDeliveryProbeResult> {
  const empty = (
    reason: string
  ): PremiumizeDeliveryProbeResult => ({
    ok: false,
    reason,
    mediaMbps: 0,
    sampleMbps: [],
    minMbps: 0,
    medianMbps: 0,
    minRatio: 0,
    medianRatio: 0,
    sampleBytes: 0,
    fileSizeBytes: 0,
  });

  const url =
    String(link || '').trim();

  if (
    !url.toLowerCase().startsWith('https://')
  ) {
    return empty('delivery-url-invalid');
  }

  const fileSizeBytes =
    Number(fileSize || 0);

  const durationSeconds =
    Number(duration || 0);

  let mediaBitRateBps =
    Number(bitRate || 0);

  if (
    (
      !Number.isFinite(mediaBitRateBps) ||
      mediaBitRateBps <= 0
    ) &&
    Number.isFinite(fileSizeBytes) &&
    fileSizeBytes > 0 &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0
  ) {
    mediaBitRateBps =
      (fileSizeBytes * 8) /
      durationSeconds;
  }

  if (
    !Number.isFinite(mediaBitRateBps) ||
    mediaBitRateBps <= 0
  ) {
    return empty(
      'delivery-bitrate-missing'
    );
  }

  if (
    !Number.isFinite(fileSizeBytes) ||
    fileSizeBytes <= 0
  ) {
    return empty(
      'delivery-size-missing'
    );
  }

  const mediaMbps =
    mediaBitRateBps / 1000000;

  const oneMiB =
    1024 * 1024;

  const fourMiB =
    4 * oneMiB;

  const quarterMiB =
    256 * 1024;

  // Roughly two seconds of media, bounded to 1-4 MiB.
  // This keeps the test short while preventing a tiny burst test.
  let sampleBytes =
    Math.round(mediaBitRateBps / 4);

  sampleBytes =
    Math.max(
      oneMiB,
      Math.min(
        fourMiB,
        sampleBytes
      )
    );

  sampleBytes =
    Math.min(
      sampleBytes,
      Math.max(
        quarterMiB,
        Math.floor(
          fileSizeBytes / 16
        )
      )
    );

  if (
    sampleBytes <= 0 ||
    fileSizeBytes <= sampleBytes
  ) {
    return empty(
      'delivery-file-too-small'
    );
  }

  const maxStart =
    Math.max(
      0,
      Math.floor(
        fileSizeBytes -
        sampleBytes -
        1
      )
    );

  const starts =
    [0.10, 0.50, 0.90].map(
      fraction =>
        Math.max(
          0,
          Math.min(
            maxStart,
            Math.floor(
              maxStart * fraction
            )
          )
        )
    );

  const sampleMbps: number[] = [];

  try {
    for (const start of starts) {
      const sample =
        await _w121zod108gRangeSample(
          url,
          start,
          sampleBytes,
          6000
        );

      sampleMbps.push(
        sample.mbps
      );
    }
  } catch (error) {
    const message =
      String(
        (error as any)?.message ||
        error ||
        ''
      );

    const reason =
      message === 'RANGE_UNSUPPORTED'
        ? 'delivery-range-unsupported'
        : message === 'TIMEOUT'
          ? 'delivery-timeout'
          : 'delivery-sample-error';

    return {
      ...empty(reason),
      mediaMbps,
      sampleMbps,
      sampleBytes,
      fileSizeBytes,
    };
  }

  if (sampleMbps.length !== 3) {
    return {
      ...empty(
        'delivery-sample-incomplete'
      ),
      mediaMbps,
      sampleMbps,
      sampleBytes,
      fileSizeBytes,
    };
  }

  const sorted =
    [...sampleMbps].sort(
      (a, b) => a - b
    );

  const minMbps =
    sorted[0];

  const medianMbps =
    sorted[1];

  const minRatio =
    minMbps / mediaMbps;

  const medianRatio =
    medianMbps / mediaMbps;

  // Candidate safety policy:
  // - no sampled region below 1.5x media bitrate
  // - median sampled delivery at least 2.0x media bitrate
  // This is intentionally conservative and will be runtime-proven
  // before promotion/commit.
  const minPass =
    minRatio >= 1.5;

  const medianPass =
    medianRatio >= 2.0;

  return {
    ok:
      minPass &&
      medianPass,

    reason:
      !minPass
        ? 'delivery-min-headroom'
        : !medianPass
          ? 'delivery-median-headroom'
          : 'delivery-ok',

    mediaMbps,
    sampleMbps,
    minMbps,
    medianMbps,
    minRatio,
    medianRatio,
    sampleBytes,
    fileSizeBytes,
  };
}

// W121ZOD108H4D_DEVICE_SEEK_READINESS_PROBE
// This is intentionally different from the old G delivery benchmark.
// It performs two bounded random-access reads on the exact Premiumize media
// URL from the playback device. The goal is to reject a source whose CDN path
// cannot sustain arbitrary FF/RW reads before the player is opened.
export type PremiumizeSeekReadinessResult = {
  ok: boolean;
  reason: string;
  mediaMbps: number;
  sampleMbps: number[];
  minMbps: number;
  minRatio: number;
  sampleBytes: number;
  fileSizeBytes: number;
};

export async function premiumizeSeekReadinessProbe(
  link: string,
  bitRate: string | number | null | undefined,
  duration: string | number | null | undefined,
  fileSize: string | number | null | undefined
): Promise<PremiumizeSeekReadinessResult> {
  const empty = (
    reason: string
  ): PremiumizeSeekReadinessResult => ({
    ok: false,
    reason,
    mediaMbps: 0,
    sampleMbps: [],
    minMbps: 0,
    minRatio: 0,
    sampleBytes: 0,
    fileSizeBytes: 0,
  });

  const url = String(link || '').trim();

  if (!url.toLowerCase().startsWith('https://')) {
    return empty('seek-readiness-url-invalid');
  }

  const fileSizeBytes = Number(fileSize || 0);
  const durationSeconds = Number(duration || 0);
  let mediaBitRateBps = Number(bitRate || 0);

  if (
    (!Number.isFinite(mediaBitRateBps) || mediaBitRateBps <= 0) &&
    Number.isFinite(fileSizeBytes) &&
    fileSizeBytes > 0 &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0
  ) {
    mediaBitRateBps =
      (fileSizeBytes * 8) /
      durationSeconds;
  }

  if (
    !Number.isFinite(mediaBitRateBps) ||
    mediaBitRateBps <= 0
  ) {
    return empty('seek-readiness-bitrate-missing');
  }

  if (
    !Number.isFinite(fileSizeBytes) ||
    fileSizeBytes <= 0
  ) {
    return empty('seek-readiness-size-missing');
  }

  const mediaMbps =
    mediaBitRateBps / 1000000;

  const halfMiB =
    512 * 1024;

  const oneMiB =
    1024 * 1024;

  // W121ZOD134F_FAST_SUSTAINABLE_READINESS
  //
  // Preparing Media must discriminate quickly, not benchmark megabytes per
  // candidate. Test two separated 512 KiB-1 MiB regions and require useful
  // delivery headroom over the actual media bitrate.
  let sampleBytes =
    Math.round(mediaBitRateBps / 8);

  sampleBytes =
    Math.max(
      halfMiB,
      Math.min(
        oneMiB,
        sampleBytes
      )
    );

  sampleBytes =
    Math.min(
      sampleBytes,
      Math.max(
        halfMiB,
        Math.floor(fileSizeBytes / 16)
      )
    );

  if (
    sampleBytes <= 0 ||
    fileSizeBytes <= sampleBytes
  ) {
    return {
      ...empty('seek-readiness-file-too-small'),
      mediaMbps,
      sampleBytes,
      fileSizeBytes,
    };
  }

  const maxStart =
    Math.max(
      0,
      Math.floor(
        fileSizeBytes -
        sampleBytes -
        1
      )
    );

  // Two separated arbitrary regions exercise the same HTTP Range behavior
  // FF/RW needs while keeping the probe bounded.
  const starts =
    [0.35, 0.70].map(
      fraction =>
        Math.max(
          0,
          Math.min(
            maxStart,
            Math.floor(
              maxStart * fraction
            )
          )
        )
    );

  // W121ZOD125_SUSTAINABLE_WINNER_GATE
  // W121ZOD134F_FAST_SUSTAINABLE_READINESS
  //
  // Both separated Range reads must sustain at least 1.25x the actual media
  // bitrate. That gives real playback headroom without R4's unrealistic 2.0x
  // requirement. Player buffering plus R4 runtime fallback remain active.
  const _w121zod125ProbeBytes =
    sampleBytes;

  const _w121zod134fProbeTimeoutMs =
    Math.max(
      2500,
      Math.min(
        4500,
        Math.ceil(
          (_w121zod125ProbeBytes * 8 * 1000) /
            (mediaBitRateBps * 1.05)
        )
      )
    );

  type _W121ZOD125Round = {
    sampleMbps: number[];
    errorReason: string;
  };

  const _w121zod125ErrorReason = (
    error: any
  ): string => {
    const message =
      String(
        error?.message ||
        error ||
        ''
      );

    return message === 'SHORT_READ'
      ? 'seek-readiness-short-read'
      : message === 'RANGE_UNSUPPORTED'
        ? 'seek-readiness-range-unsupported'
        : message === 'TIMEOUT'
          ? 'seek-readiness-timeout'
          : 'seek-readiness-sample-error';
  };

  const _w121zod125RunRound = async (): Promise<_W121ZOD125Round> => {
    const roundMbps: number[] = [];

    try {
      for (const start of starts) {
        const sample =
          await _w121zod108gRangeSample(
            url,
            start,
            _w121zod125ProbeBytes,
            _w121zod134fProbeTimeoutMs
          );

        if (sample.bytes < _w121zod125ProbeBytes) {
          throw new Error('SHORT_READ');
        }

        roundMbps.push(sample.mbps);

        if (
          mediaMbps <= 0 ||
          (sample.mbps / mediaMbps) < 1.25
        ) {
          break;
        }
      }

      return {
        sampleMbps: roundMbps,
        errorReason: '',
      };
    } catch (error) {
      return {
        sampleMbps: roundMbps,
        errorReason:
          _w121zod125ErrorReason(error),
      };
    }
  };

  const round =
    await _w121zod125RunRound();

  if (round.errorReason) {
    return {
      ...empty(round.errorReason),
      mediaMbps,
      sampleMbps: round.sampleMbps,
      sampleBytes: _w121zod125ProbeBytes,
      fileSizeBytes,
    };
  }

  const complete =
    round.sampleMbps.length === starts.length;

  const minMbps =
    round.sampleMbps.length > 0
      ? Math.min(...round.sampleMbps)
      : 0;

  const minRatio =
    mediaMbps > 0
      ? minMbps / mediaMbps
      : 0;

  const ok =
    complete &&
    minRatio >= 1.25;

  try {
    console.log(
      '[W121ZOD125 SUSTAINABLE WINNER GATE]',
      'mediaMbps=' + mediaMbps.toFixed(2),
      'samples=' +
        round.sampleMbps
          .map(v => v.toFixed(2))
          .join(','),
      'minRatio=' + minRatio.toFixed(2),
      'complete=' + String(complete),
      'ok=' + String(ok)
    );
  } catch (_) {}

  return {
    ok,
    reason:
      !complete
        ? 'seek-readiness-incomplete'
        : ok
          ? 'seek-readiness-ok'
          : 'seek-readiness-low-headroom',
    mediaMbps,
    sampleMbps: round.sampleMbps,
    minMbps,
    minRatio,
    sampleBytes: _w121zod125ProbeBytes,
    fileSizeBytes,
  };
}
// ============================================================
// V751_PREMIUMIZE_QUEUE_FALLBACK
//
// Keep directdl as the fast path. Only Premiumize's exact
// unsupported-direct-download failure enters the cloud queue.
// ============================================================

type V751QueuedTransferStatus = {
  status: string;
  transfer_status?: string;
  progress?: number;
  message?: string;
  name?: string;
  folder_id?: string | null;
  file_id?: string | null;
  content?: any[];
};

const _v751QueueInFlight =
  new Map<string, Promise<any[]>>();

function _v751TransferStorageKey(
  infoHash: string
): string {
  return (
    '@pm_v751_transfer:' +
    String(infoHash || '').trim().toLowerCase()
  );
}

function _v751Sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function _v751CreateTransfer(
  magnet: string
): Promise<string> {
  const auth = await _getAuthHeader();

  if (!auth) {
    throw new Error('NO_AUTH');
  }

  const res = await _fetchWithTimeout(
    BACKEND_URL + '/api/premiumize/transfer/create',
    {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        src: magnet,
      }),
    },
    25000
  );

  if (res.status === 409) {
    throw new Error('NO_PM_KEY');
  }

  const j =
    await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      'PM_QUEUE_CREATE_HTTP_' +
      String(res.status) +
      ':' +
      String(j?.detail || '')
    );
  }

  if (j?.status !== 'success' || !j?.id) {
    throw new Error(
      'PM_QUEUE_CREATE_' +
      String(j?.code || j?.status || 'unknown') +
      ':' +
      String(j?.message || '')
    );
  }

  return String(j.id);
}

async function _v751TransferStatus(
  transferId: string
): Promise<V751QueuedTransferStatus> {
  const auth = await _getAuthHeader();

  if (!auth) {
    throw new Error('NO_AUTH');
  }

  const res = await _fetchWithTimeout(
    BACKEND_URL +
      '/api/premiumize/transfer/status/' +
      encodeURIComponent(transferId),
    {
      method: 'GET',
      headers: {
        'Authorization': auth,
        'Accept': 'application/json',
      },
    },
    25000
  );

  const j =
    await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      'PM_QUEUE_STATUS_HTTP_' +
      String(res.status) +
      ':' +
      String(j?.detail || '')
    );
  }

  if (j?.status !== 'success') {
    throw new Error(
      'PM_QUEUE_STATUS_' +
      String(j?.code || j?.status || 'unknown') +
      ':' +
      String(j?.message || '')
    );
  }

  return j as V751QueuedTransferStatus;
}

async function _v751ResolveQueuedContent(
  infoHash: string,
  magnet: string,
  onProgress?: (state: string) => void
): Promise<any[]> {
  const hash =
    String(infoHash || '').trim().toLowerCase();

  if (!hash) {
    throw new Error('PM_QUEUE_NO_HASH');
  }

  const existing =
    _v751QueueInFlight.get(hash);

  if (existing) {
    console.log(
      '[V751 PM QUEUE] join',
      hash.slice(0, 8)
    );

    return await existing;
  }

  const work = (async (): Promise<any[]> => {
    const storageKey =
      _v751TransferStorageKey(hash);

    let transferId = '';

    try {
      transferId =
        String(
          (await AsyncStorage.getItem(storageKey)) || ''
        ).trim();
    } catch (_) {}

    const createAndStore =
      async (): Promise<string> => {
        onProgress?.('queue_create');

        const id =
          await _v751CreateTransfer(magnet);

        try {
          await AsyncStorage.setItem(
            storageKey,
            id
          );
        } catch (_) {}

        console.log(
          '[V751 PM QUEUE] created',
          hash.slice(0, 8),
          'transfer=' + id
        );

        return id;
      };

    if (!transferId) {
      transferId =
        await createAndStore();
    } else {
      console.log(
        '[V751 PM QUEUE] resume',
        hash.slice(0, 8),
        'transfer=' + transferId
      );
    }

    const deadline =
      Date.now() + (60 * 60 * 1000);

    let lastState = '';
    let recreatedMissingTransfer = false;

    while (Date.now() < deadline) {
      let result: V751QueuedTransferStatus;

      try {
        result =
          await _v751TransferStatus(
            transferId
          );
      } catch (error: any) {
        const message =
          String(error?.message || error || '');

        // A persisted transfer ID can become stale if the cloud
        // transfer was removed. Recreate it at most once per resolver.
        const _v751MissingTransfer =
          message.startsWith(
            'PM_QUEUE_STATUS_HTTP_404'
          );

        if (_v751MissingTransfer) {
          try {
            await AsyncStorage.removeItem(
              storageKey
            );
          } catch (_) {}

          if (!recreatedMissingTransfer) {
            recreatedMissingTransfer = true;

            transferId =
              await createAndStore();

            continue;
          }
        }

        throw error;
      }

      const transferStatus =
        String(result.transfer_status || '');

      const rawProgress =
        Number(result.progress);

      const progress =
        Number.isFinite(rawProgress)
          ? Math.max(
              0,
              Math.min(1, rawProgress)
            )
          : 0;

      const pct =
        Math.floor(progress * 100);

      const state =
        transferStatus + ':' + pct;

      if (state !== lastState) {
        lastState = state;

        console.log(
          '[V751 PM QUEUE]',
          hash.slice(0, 8),
          transferStatus,
          pct + '%',
          String(
            result.message || ''
          ).slice(0, 100)
        );
      }

      onProgress?.(
        'queue_' +
        transferStatus +
        ':' +
        pct
      );

      if (transferStatus === 'error') {
        try {
          await AsyncStorage.removeItem(
            storageKey
          );
        } catch (_) {}

        throw new Error(
          'PM_QUEUE_TRANSFER_ERROR:' +
          String(result.message || '')
        );
      }

      if (
        transferStatus === 'finished' ||
        transferStatus === 'seeding'
      ) {
        const content =
          Array.isArray(result.content)
            ? result.content
            : [];

        if (content.length > 0) {
          console.log(
            '[V751 PM QUEUE] files ready',
            hash.slice(0, 8),
            'files=' + content.length
          );

          return content;
        }
      }

      await _v751Sleep(2500);
    }

    throw new Error('PM_QUEUE_TIMEOUT');
  })();

  _v751QueueInFlight.set(
    hash,
    work
  );

  try {
    return await work;
  } finally {
    _v751QueueInFlight.delete(hash);
  }
}

// ------------------------------------------------------------
// FILE PICKER  (unchanged from v283)
// ------------------------------------------------------------
function _mediaBasename(value: any): string {
  const raw = String(value || '').split(/[?#]/)[0].replace(/\\/g, '/');
  const base = raw.split('/').pop() || raw;
  try {
    return decodeURIComponent(base);
  } catch (_) {
    return base;
  }
}

function _isSampleLikeMedia(value: any): boolean {
  const base = _mediaBasename(value);
  return /(?:^|[._\-\s])(sample|trailer|preview|teaser|featurette)(?:[._\-\s]|$)/i.test(base);
}

/*
 * V671_PM_REJECT_SAMPLE_MEDIA
 *
 * Premiumize directdl may return a sample.mp4 beside the real episode.
 * Never choose sample/trailer media, and never match an episode number
 * from a parent directory name. Episode matching must use the actual
 * media filename only.
 */
// V744_PM_MOVIE_TITLE_FAIL_CLOSED
function _v744PmTitleWords(value: any): string[] {
  try {
    let raw = String(value || '');
    try { raw = decodeURIComponent(raw); } catch (_) {}

    const stop = new Set([
      'THE', 'A', 'AN', 'AND', 'OR', 'OF', 'IN', 'ON',
      'TO', 'FOR', 'VS', 'PART', 'VOL', 'VOLUME'
    ]);

    return raw
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(w => !!w && !stop.has(w));
  } catch (_) {
    return [];
  }
}

function _v744PmFileMatchesTitle(
  requestedTitle: string,
  value: any
): boolean {
  const req = _v744PmTitleWords(requestedTitle);
  const cand = _v744PmTitleWords(_mediaBasename(value));

  if (req.length === 0 || cand.length === 0) return false;

  const reqCompact = req.join('');
  const candCompact = cand.join('');

  if (
    reqCompact.length >= 2 &&
    candCompact.includes(reqCompact)
  ) {
    return true;
  }

  const candidateWords = new Set(cand);
  let hits = 0;

  for (const word of req) {
    if (candidateWords.has(word)) hits++;
  }

  if (req.length === 1) return hits === 1;
  if (req.length === 2) return hits === 2;

  return hits >= Math.ceil(req.length * 0.8);
}
// V745_PM_STRICT_CONTENT_IDENTITY
function _v745PmYear(value: any): string {
  try {
    const m = String(value || '').match(/\b(?:18|19|20|21)\d{2}\b/);
    return m ? m[0] : '';
  } catch (_) {
    return '';
  }
}

function _v745PmTitleMatches(
  requestedTitle: string,
  value: any
): boolean {
  let raw = String(value || '');

  try {
    raw = decodeURIComponent(raw);
  } catch (_) {}

  const req = _v744PmTitleWords(requestedTitle);
  const cand = _v744PmTitleWords(raw);

  if (req.length === 0 || cand.length === 0) {
    return false;
  }

  const reqCompact = req.join('');
  const candCompact = cand.join('');

  if (
    reqCompact.length >= 2 &&
    candCompact.includes(reqCompact)
  ) {
    return true;
  }

  const candidateWords = new Set(cand);
  let hits = 0;

  for (const word of req) {
    if (candidateWords.has(word)) {
      hits++;
    }
  }

  if (req.length === 1) return hits === 1;
  if (req.length === 2) return hits === 2;

  return hits >= Math.ceil(req.length * 0.8);
}

function _v745PmMovieIdentityMatches(
  requestedTitle: string,
  requestedYear: any,
  value: any
): boolean {
  if (!_v745PmTitleMatches(requestedTitle, value)) {
    return false;
  }

  const year = _v745PmYear(requestedYear);

  if (!year) return true;

  let raw = String(value || '');

  try {
    raw = decodeURIComponent(raw);
  } catch (_) {}

  return new RegExp(
    '(?:^|[^0-9])' + year + '(?:[^0-9]|$)'
  ).test(raw);
}

function _v745PmEpisodeIdentityMatches(
  requestedSeriesTitle: string,
  season: number,
  episode: number,
  value: any
): boolean {
  if (
    !requestedSeriesTitle ||
    !Number.isFinite(season) ||
    !Number.isFinite(episode)
  ) {
    return false;
  }

  let raw = String(value || '');

  try {
    raw = decodeURIComponent(raw);
  } catch (_) {}

  if (!_v745PmTitleMatches(requestedSeriesTitle, raw)) {
    return false;
  }

  const s = String(season).padStart(2, '0');
  const e = String(episode).padStart(2, '0');

  const seCode = `S${s}E${e}`;
  const xCode1 = `${season}x${e}`;
  const xCode2 = `${s}x${e}`;

  const upper = raw.toUpperCase();
  const lower = raw.toLowerCase();

  return (
    upper.includes(seCode) ||
    lower.includes(xCode1.toLowerCase()) ||
    lower.includes(xCode2.toLowerCase())
  );
}
function _pickBestFile(content: any[], opts: { season?: number; episode?: number; title?: string; year?: string }): any | null {
  if (!content || content.length === 0) return null;

  const videoExt = /\.(mkv|mp4|avi|mov|m4v|ts|m2ts|webm)$/i;

  // W121ZOD124_PATH_FIRST_PM_PACK_SELECTION
  // Keep exact path-only media entries. If link is absent,
  // resolveMagnet will re-resolve this exact path through
  // premiumizeMediaProbe instead of throwing the candidate away.
  const videos = content.filter(
    c =>
      c &&
      videoExt.test(
        c.path || c.name || c.link || ''
      )
  );

  const cleanVideos = videos.filter(
    v => !_isSampleLikeMedia(v.path || v.link)
  );

  // Fail closed rather than deliberately playing a sample/trailer.
  if (cleanVideos.length === 0) return null;

  /*
   * V744: Movie resolution is fail-closed on the actual PM filename.
   * Do this BEFORE the old "single video = accept it" shortcut.
   */
  if (
    opts.title &&
    opts.season == null &&
    opts.episode == null
  ) {
    const movieMatches = cleanVideos.filter(v =>
      _v745PmMovieIdentityMatches(
        String(opts.title),
        opts.year,
        String(v.path || '') + ' ' + String(v.link || '')
      )
    );

    if (movieMatches.length === 0) {
      console.warn(
        '[V744 PM TITLE GUARD] no PM movie file matched requested title',
        String(opts.title).slice(0, 100)
      );
      return null;
    }

    movieMatches.sort(
      (a, b) => (b.size || 0) - (a.size || 0)
    );

    return movieMatches[0];
  }

  if (cleanVideos.length === 1) return cleanVideos[0];

  if (opts.season != null && opts.episode != null) {
    const s = String(opts.season).padStart(2, '0');
    const e = String(opts.episode).padStart(2, '0');

    const seCode = `S${s}E${e}`;
    const seAlt = `${opts.season}x${e}`;
    const seAltPadded = `${s}x${e}`;

    const episodeMatches = cleanVideos.filter(v => {
      const filename = _mediaBasename(v.path || v.link);
      const upper = filename.toUpperCase();
      const lower = filename.toLowerCase();

      return _v745PmEpisodeIdentityMatches(
        String(opts.title || ''),
        Number(opts.season),
        Number(opts.episode),
        String(v.path || '') + ' ' + String(v.link || '')
      );
    });

    if (episodeMatches.length > 0) {
      episodeMatches.sort((a, b) => (b.size || 0) - (a.size || 0));
      return episodeMatches[0];
    }

    console.warn(
      '[V745 PM IDENTITY] no exact requested episode file found',
      String(opts.title || ''),
      'S' + String(opts.season).padStart(2, '0') +
      'E' + String(opts.episode).padStart(2, '0')
    );

    return null;
  }

  cleanVideos.sort((a, b) => (b.size || 0) - (a.size || 0));
  return cleanVideos[0];
}

export async function clearCache(): Promise<number> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const targets = keys.filter(k => k.startsWith(CACHE_KEY_PREFIX));
    if (targets.length > 0) await AsyncStorage.multiRemove(targets);
    return targets.length;
  } catch (_) { return 0; }
}

// ------------------------------------------------------------
// PUBLIC: resolveMagnet  (unchanged)
// ------------------------------------------------------------
export async function resolveMagnet(opts: {
  infoHash: string;
  magnet?: string;
  season?: number;
  episode?: number;
  title?: string;
  year?: string;
  onProgress?: (state: string) => void;
}): Promise<string | null> {
  const { infoHash, onProgress } = opts;
  if (!infoHash) return null;

  const cached = await _readCache(infoHash, opts.season, opts.episode);

  /*
   * V671_PM_REJECT_CACHED_SAMPLE
   *
   * Older builds may already have persisted sample.mp4 as the resolved
   * URL for this hash/episode. Discard that one cache entry and resolve
   * the torrent again through the corrected file picker.
   */
  if (cached?.finalUrl) {
    const _v744CachedMovieMismatch =
      !!opts.title &&
      opts.season == null &&
      opts.episode == null &&
      !_v745PmMovieIdentityMatches(
        String(opts.title),
        opts.year,
        cached.finalUrl
      );
    const _v745CachedEpisodeMismatch =
      opts.season != null &&
      opts.episode != null &&
      !_v745PmEpisodeIdentityMatches(
        String(opts.title || ''),
        Number(opts.season),
        Number(opts.episode),
        cached.finalUrl
      );

    if (
      _isSampleLikeMedia(cached.finalUrl) ||
      _v744CachedMovieMismatch ||
      _v745CachedEpisodeMismatch
    ) {
      try {
        await AsyncStorage.removeItem(
          _cacheKey(infoHash, opts.season, opts.episode)
        );
      } catch (_) {}

      console.warn(
        _v744CachedMovieMismatch ? '[V744 PM TITLE GUARD] rejected cached wrong-title PM URL' : '[V671] rejected cached sample-like PM URL',
        infoHash.slice(0, 8),
        _mediaBasename(cached.finalUrl)
      );
    } else {
      onProgress?.('cache_hit');
      return cached.finalUrl;
    }
  }

  const magnet = opts.magnet || `magnet:?xt=urn:btih:${infoHash}`;

  onProgress?.('resolving');
  let content: any[];

  try {
    content =
      await premiumizeDirectDL(magnet);
  } catch (error: any) {
    const message =
      String(error?.message || error || '');

    if (
      !message
        .toLowerCase()
        .includes(
          'unsupported link for direct download'
        )
    ) {
      throw error;
    }

    console.log(
      '[V751 PM QUEUE] directdl unsupported; queueing',
      infoHash.slice(0, 8)
    );

    onProgress?.('queueing');

    content =
      await _v751ResolveQueuedContent(
        infoHash,
        magnet,
        onProgress
      );
  }
  const best = _pickBestFile(content, opts);
  if (!best) throw new Error('PM_NO_MEDIA_FILE');

  const bestPath =
    String(best.path || best.name || '').trim();

  let finalUrl =
    String(best.link || '').trim();

  if (!finalUrl && bestPath) {
    const probe =
      await premiumizeMediaProbe(magnet, bestPath);

    finalUrl = String(probe?.link || '').trim();

    console.log(
      '[W121ZOD124 PM PATH RESOLVE]',
      infoHash.slice(0, 8),
      'file=' + _mediaBasename(bestPath),
      'link=' + String(!!finalUrl)
    );
  }

  if (!finalUrl) throw new Error('PM_NO_LINK');

  console.log(
    '[V671 PM FILE PICK]',
    infoHash.slice(0, 8),
    'file=' + _mediaBasename(bestPath || finalUrl),
    'size=' + String(best.size || 0)
  );

  await _writeCache(infoHash, { finalUrl, expiresAt: Date.now() + TTL_MS }, opts.season, opts.episode);
  onProgress?.('ready');
  return finalUrl;
}

// ------------------------------------------------------------
// PUBLIC: feature flag helpers  (kept for compat with v286 block)
// ------------------------------------------------------------
export async function isClientSideStreamsEnabled(): Promise<boolean> {
  try { return (await AsyncStorage.getItem('@feature_clientSideStreams')) === '1'; }
  catch (_) { return false; }
}

export async function setClientSideStreamsEnabled(on: boolean): Promise<void> {
  try { await AsyncStorage.setItem('@feature_clientSideStreams', on ? '1' : '0'); }
  catch (_) {}
}
