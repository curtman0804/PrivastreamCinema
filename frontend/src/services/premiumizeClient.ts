// ============================================================
// V288_PREMIUMIZE_CLIENT — adds cross-device sync
// ============================================================
// Same surface as v283 plus:
//   - pullKeyFromBackend()        - fetch key from /api/user/settings
//   - pushKeyToBackend(key)       - upload to server
//   - deleteKeyOnBackend()        - wipe on server
//   - trySyncFromBackend()        - lazy-pull on app boot
//
// Public flow:
//   • User enters key on Device A → validateKey() succeeds →
//     key is stored locally AND pushed to backend.
//   • User logs in on Device B → first call to _hasPMKey() lazy-
//     pulls from backend → key auto-populates → playback works
//     instantly with no manual entry.
//   • User taps Disconnect on any device → key wiped locally AND
//     on backend → next login on any other device starts clean.
//
// Legal posture: backend only ECHOES the key back to the same
// authenticated user.  Server never uses it for resolution.
//
// Save as:
//   src/services/premiumizeClient.ts
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';

const PM_BASE = 'https://www.premiumize.me/api';
const CACHE_KEY_PREFIX = '@pmcache:';
const KEY_STORAGE = '@pm_key_v1';
const TTL_MS = 6 * 60 * 60 * 1000;

// Backend URL + auth token — kept in sync with the rest of the app.
// We try multiple AsyncStorage keys the auth store has used over time.
const AUTH_TOKEN_KEYS = ['auth_token', '@auth_token', 'authToken', 'jwt', '@jwt'];
// Hetzner backend.  Must match v287_client BACKEND_URL.
const BACKEND_URL = 'http://5.161.49.99:8001';

type CacheEntry = { finalUrl: string; expiresAt: number };

// ------------------------------------------------------------
// LOCAL STORAGE HELPERS
// ------------------------------------------------------------
async function _getKey(): Promise<string | null> {
  try { return await AsyncStorage.getItem(KEY_STORAGE); } catch (_) { return null; }
}

async function _setKeyLocal(key: string): Promise<void> {
  try { await AsyncStorage.setItem(KEY_STORAGE, key); } catch (_) {}
}

async function _clearKeyLocal(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY_STORAGE); } catch (_) {}
}

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

async function _readCache(infoHash: string): Promise<CacheEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY_PREFIX + infoHash);
    if (!raw) return null;
    const e: CacheEntry = JSON.parse(raw);
    if (Date.now() > e.expiresAt) return null;
    return e;
  } catch (_) { return null; }
}

async function _writeCache(infoHash: string, e: CacheEntry) {
  try { await AsyncStorage.setItem(CACHE_KEY_PREFIX + infoHash, JSON.stringify(e)); }
  catch (_) {}
}

// ------------------------------------------------------------
// BACKEND SYNC
// ------------------------------------------------------------
const _SYNC_TIMEOUT_MS = 6000;
let _backendSyncedThisSession = false;

async function _fetchWithTimeout(url: string, opts: any = {}, timeoutMs = _SYNC_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function pullKeyFromBackend(): Promise<string | null> {
  const auth = await _getAuthHeader();
  if (!auth) return null;
  try {
    const res = await _fetchWithTimeout(`${BACKEND_URL}/api/user/settings`, {
      method: 'GET',
      headers: { 'Authorization': auth, 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    const j = await res.json();
    const k = (j?.premiumize_api_key || '').trim();
    return k || null;
  } catch (_) { return null; }
}

export async function pushKeyToBackend(key: string): Promise<boolean> {
  const auth = await _getAuthHeader();
  if (!auth) return false;
  try {
    const res = await _fetchWithTimeout(`${BACKEND_URL}/api/user/settings`, {
      method: 'PUT',
      headers: {
        'Authorization': auth,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ premiumize_api_key: key }),
    });
    return res.ok;
  } catch (_) { return false; }
}

export async function deleteKeyOnBackend(): Promise<boolean> {
  const auth = await _getAuthHeader();
  if (!auth) return false;
  try {
    const res = await _fetchWithTimeout(`${BACKEND_URL}/api/user/settings`, {
      method: 'DELETE',
      headers: { 'Authorization': auth },
    });
    return res.ok;
  } catch (_) { return false; }
}

// Lazy-pull from backend if local is empty.  Idempotent within a
// single app session — we don't keep hammering the server.
export async function trySyncFromBackend(): Promise<{ pulled: boolean; key: string | null }> {
  if (_backendSyncedThisSession) return { pulled: false, key: await _getKey() };
  _backendSyncedThisSession = true;
  const localKey = await _getKey();
  if (localKey) return { pulled: false, key: localKey };
  const remote = await pullKeyFromBackend();
  if (remote) {
    await _setKeyLocal(remote);
    return { pulled: true, key: remote };
  }
  return { pulled: false, key: null };
}

// Force a re-sync (call this on login / disconnect / explicit refresh).
export function resetSyncFlag(): void {
  _backendSyncedThisSession = false;
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

// ------------------------------------------------------------
// PUBLIC: validateKey  (now also pushes to backend on success)
// ------------------------------------------------------------
export async function validateKey(
  key: string
): Promise<{ valid: boolean; username?: string; premium_until?: number }> {
  try {
    const url = `${PM_BASE}/account/info?apikey=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) return { valid: false };
    const j = await res.json();
    if (j?.status !== 'success') return { valid: false };
    // Validation passed.  Also push to backend so other devices auto-load.
    // Failure is non-fatal — local copy is still authoritative.
    pushKeyToBackend(key).catch(() => {});
    return {
      valid: true,
      username: j.customer_id || j.email,
      premium_until: j.premium_until,
    };
  } catch (_) { return { valid: false }; }
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

  const cached = await _readCache(infoHash);
  if (cached?.finalUrl) { onProgress?.('cache_hit'); return cached.finalUrl; }

  // Lazy-sync from backend if the local key was wiped (eg. fresh
  // install + auto-login on another device).
  let key = await _getKey();
  if (!key) {
    const synced = await trySyncFromBackend();
    key = synced.key;
  }
  if (!key) throw new Error('NO_PM_KEY');

  const magnet = opts.magnet || `magnet:?xt=urn:btih:${infoHash}`;

  onProgress?.('resolving');
  const form = new URLSearchParams();
  form.append('apikey', key);
  form.append('src', magnet);

  const res = await fetch(`${PM_BASE}/transfer/directdl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`PM_HTTP_${res.status}:${txt.slice(0, 120)}`);
  }
  const j = await res.json();
  if (j?.status !== 'success') {
    throw new Error(`PM_${j?.status || 'unknown'}:${j?.message || ''}`);
  }
  const content: any[] = j?.content || [];
  const best = _pickBestFile(content, opts);
  if (!best?.link) throw new Error('PM_NO_LINK');

  const finalUrl = String(best.link);
  await _writeCache(infoHash, { finalUrl, expiresAt: Date.now() + TTL_MS });
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
