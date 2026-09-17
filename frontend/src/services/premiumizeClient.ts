// V509_PREMIUMIZE_SERVER_SECURITY
// Premiumize credentials remain server-side. The client receives only status, cache results, and playable URLs.

import AsyncStorage from '../utils/mmkvStorage';

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

export async function premiumizeCacheCheck(items: string[]): Promise<boolean[]> {
  const cleaned = (items || []).map(x => String(x || '').trim().toLowerCase()).filter(Boolean).slice(0, 50);
  if (cleaned.length === 0) return [];
  const auth = await _getAuthHeader();
  if (!auth) throw new Error('NO_AUTH');
  const res = await _fetchWithTimeout(`${BACKEND_URL}/api/premiumize/cache-check`, {
    method: 'POST',
    headers: { 'Authorization': auth, 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: cleaned }),
  }, 12000);
  if (res.status === 409) throw new Error('NO_PM_KEY');
  if (!res.ok) throw new Error(`PM_CACHE_HTTP_${res.status}`);
  const j = await res.json();
  if (j?.status !== 'success' || !Array.isArray(j?.response)) throw new Error(`PM_CACHE_${j?.status || 'unknown'}`);
  return j.response.map((v: any) => !!v);
}

export async function premiumizeDirectDL(src: string): Promise<any[]> {
  const magnet = String(src || '').trim();
  if (!magnet.toLowerCase().startsWith('magnet:?xt=urn:btih:')) throw new Error('INVALID_MAGNET');
  const auth = await _getAuthHeader();
  if (!auth) throw new Error('NO_AUTH');
  const res = await _fetchWithTimeout(`${BACKEND_URL}/api/premiumize/directdl`, {
    method: 'POST',
    headers: { 'Authorization': auth, 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ src: magnet }),
  }, 22000);
  if (res.status === 409) throw new Error('NO_PM_KEY');
  if (!res.ok) throw new Error(`PM_DIRECT_HTTP_${res.status}`);
  const j = await res.json();
  if (j?.status !== 'success' || !Array.isArray(j?.content)) throw new Error(`PM_DIRECT_${j?.status || 'unknown'}:${j?.message || ''}`);
  return j.content;
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

  const videos = content.filter(
    c => c && c.link && videoExt.test(c.path || c.link)
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
  if (!best?.link) throw new Error('PM_NO_LINK');

  console.log(
    '[V671 PM FILE PICK]',
    infoHash.slice(0, 8),
    'file=' + _mediaBasename(best.path || best.link),
    'size=' + String(best.size || 0)
  );

  const finalUrl = String(best.link);
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
