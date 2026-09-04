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
  if (!auth) return false;
  try {
    const res = await _fetchWithTimeout(`${BACKEND_URL}/api/premiumize/status`, {
      method: 'GET',
      headers: { 'Authorization': auth, 'Accept': 'application/json' },
    });
    if (!res.ok) return false;
    const j = await res.json();
    return !!j?.configured;
  } catch (_) { return false; }
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

// ------------------------------------------------------------
// FILE PICKER  (unchanged from v283)
// ------------------------------------------------------------
function _pickBestFile(content: any[], opts: { season?: number; episode?: number }): any | null {
  if (!content || content.length === 0) return null;
  const videoExt = /\.(mkv|mp4|avi|mov|m4v|ts|m2ts|webm)$/i;
  const videos = content.filter(c => c && c.link && videoExt.test(c.path || c.link));
  if (videos.length === 0) return content[0];
  if (videos.length === 1) return videos[0];
  if (opts.season != null && opts.episode != null) {
    const s = String(opts.season).padStart(2, '0');
    const e = String(opts.episode).padStart(2, '0');
    const seCode = `S${s}E${e}`;
    const seAlt = `${opts.season}x${e}`;
    const m = videos.find(v =>
      (v.path || '').toUpperCase().includes(seCode) ||
      (v.path || '').toLowerCase().includes(seAlt.toLowerCase())
    );
    if (m) return m;
  }
  videos.sort((a, b) => (b.size || 0) - (a.size || 0));
  return videos[0];
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
  onProgress?: (state: string) => void;
}): Promise<string | null> {
  const { infoHash, onProgress } = opts;
  if (!infoHash) return null;

  const cached = await _readCache(infoHash, opts.season, opts.episode);
  if (cached?.finalUrl) { onProgress?.('cache_hit'); return cached.finalUrl; }

  const magnet = opts.magnet || `magnet:?xt=urn:btih:${infoHash}`;

  onProgress?.('resolving');
  const content: any[] = await premiumizeDirectDL(magnet);
  const best = _pickBestFile(content, opts);
  if (!best?.link) throw new Error('PM_NO_LINK');

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
