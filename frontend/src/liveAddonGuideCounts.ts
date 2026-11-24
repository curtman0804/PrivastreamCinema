// BU23JB: no network requests. Persist only small provider counts from the EXISTING
// completed Live TV guide load. A successful catalog row is NOT proof of audio/playback.
// LIVE requires at least one stream that passed the existing backend/native preflight.
import Storage from './utils/mmkvStorage';
import { DeviceEventEmitter } from 'react-native';
import { useContentStore } from './store/contentStore';

export const BU23JB_COUNT_EVENT = 'BU23JB_ADDON_GUIDE_COUNTS_UPDATED';
const KEY = 'bu23jb:guide-counts:v1';
const GUIDE_CACHE_KEY = 'w121zepg161b:guide:v1';
const NEXO_GOOD_KEY = 'w121zlive175a:nexo:good:v1';
const SIX_HOURS = 6 * 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;
const MAX_ROWS = 12000;
export type BU23JBProviderCount = {
  listed: number;
  reachable: number;
  observedAt: number;
  origin: 'guide' | 'cached-guide';
};
export type BU23JBCounts = Record<string, BU23JBProviderCount>;
function str(v: unknown): string { return String(v || '').trim(); }
export function bu23jbScope(): string | null {
  const state = useContentStore.getState();
  const uid = str(state.currentUserId);
  const addons = Array.isArray(state.addons) ? state.addons : [];
  if (!uid || state.isLoadingAddons || !addons.length) return null;
  const ids = addons.map((a: any) => str(a?.id || a?.manifestUrl || a?.url));
  if (ids.some(id => !id)) return null;
  return JSON.stringify([uid, ids.sort()]); // identical to Live TV's W161B scope
}
function validRow(row: any): {addonId: string; key: string} | null {
  const id = str(row?.item?.imdb_id || row?.item?.id || row?.imdb_id || row?.id);
  const addonId = str(row?.addonId || row?._addon_id);
  if (!addonId || !id || id.toLowerCase() === 'ratelimit_error') return null;
  return {addonId, key: addonId + ':' + id};
}
export function bu23jbSummarize(rows: any[], confirmedRows: any[], observedAt: number): BU23JBCounts {
  if (!Number.isFinite(observedAt) || observedAt <= 0 ||
      !Array.isArray(rows) || rows.length > MAX_ROWS ||
      !Array.isArray(confirmedRows) || confirmedRows.length > MAX_ROWS) return {};
  const sets = new Map<string, Set<string>>();
  const proofs = new Map<string, Set<string>>();
  for (const row of rows) {
    const parsed = validRow(row);
    if (!parsed) continue;
    if (!sets.has(parsed.addonId)) sets.set(parsed.addonId, new Set());
    sets.get(parsed.addonId)!.add(parsed.key);
  }
  for (const row of confirmedRows) {
    const parsed = validRow(row);
    if (!parsed || !sets.get(parsed.addonId)?.has(parsed.key)) continue;
    if (!proofs.has(parsed.addonId)) proofs.set(parsed.addonId, new Set());
    proofs.get(parsed.addonId)!.add(parsed.key);
  }
  const out: BU23JBCounts = {};
  for (const [addonId, keys] of sets) {
    out[addonId] = {listed: keys.size, reachable: proofs.get(addonId)?.size || 0,
      observedAt, origin: 'guide'};
  }
  return out;
}
function validCounts(row: any): row is BU23JBProviderCount {
  return !!row && Number.isInteger(row.listed) && row.listed >= 0 && row.listed <= MAX_ROWS &&
    Number.isInteger(row.reachable) && row.reachable >= 0 && row.reachable <= row.listed &&
    Number.isFinite(row.observedAt) && row.observedAt > 0 &&
    (row.origin === 'guide' || row.origin === 'cached-guide');
}
export function bu23jbRecentLive(row: BU23JBProviderCount | undefined, now: number): boolean {
  return !!row && validCounts(row) && row.reachable > 0 &&
    now >= row.observedAt && now - row.observedAt <= SIX_HOURS;
}
async function scopedCache(key: string, scope: string, now: number): Promise<any | null> {
  try {
    const raw = await Storage.getItem(key);
    if (!raw || raw.length > 2500000) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.schema !== 1 || parsed?.scope !== scope ||
        !Number.isFinite(parsed?.savedAt) || parsed.savedAt > now ||
        now - parsed.savedAt > ONE_DAY ||
        !Array.isArray(parsed?.channels) || parsed.channels.length > MAX_ROWS) return null;
    return parsed;
  } catch (_) { return null; }
}
export async function loadBU23JBGuideCounts(): Promise<BU23JBCounts> {
  const scope = bu23jbScope();
  if (!scope) return {};
  const now = Date.now();
  let out: BU23JBCounts = {};
  try {
    const raw = await Storage.getItem(KEY);
    if (raw && raw.length <= 100000) {
      const parsed = JSON.parse(raw);
      if (parsed?.schema === 1 && parsed?.scope === scope &&
          parsed?.byAddon && typeof parsed.byAddon === 'object' &&
          !Array.isArray(parsed.byAddon)) {
        for (const [addonId, entry] of Object.entries(parsed.byAddon)) {
          if (validCounts(entry) && now >= entry.observedAt &&
              now - entry.observedAt <= ONE_DAY) out[addonId] = entry;
        }
      }
    }
  } catch (_) { /* fail neutral */ }
  // Reuse existing guide snapshots when migrating from BU23IZ; zero network calls.
  // The main snapshot was saved only after a healthy completed preflight.
  const guide = await scopedCache(GUIDE_CACHE_KEY, scope, now);
  if (guide && now - guide.savedAt <= SIX_HOURS) {
    const cached = bu23jbSummarize(guide.channels, guide.channels, guide.savedAt);
    for (const [id, row] of Object.entries(cached)) {
      if (!out[id] || out[id].observedAt < row.observedAt)
        out[id] = {...row, origin: 'cached-guide'};
    }
  }
  // NexoTV stores a separate known-good snapshot; a rate-limit error is never a channel.
  const nexo = await scopedCache(NEXO_GOOD_KEY, scope, now);
  if (nexo) {
    const good = nexo.channels.filter((row: any) => str(row?.addonId) === 'community.nexotv');
    const cached = bu23jbSummarize(good, good, nexo.savedAt)['community.nexotv'];
    if (cached && (!out['community.nexotv'] ||
        out['community.nexotv'].observedAt < cached.observedAt)) {
      out['community.nexotv'] = {...cached, origin: 'cached-guide'};
    }
  }
  return out;
}
export async function publishBU23JBGuideCounts(rows: any[], confirmedRows: any[],
  nexoRateLimited: boolean): Promise<void> {
  const scope = bu23jbScope();
  if (!scope || !Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) return;
  const now = Date.now();
  const fresh = bu23jbSummarize(rows, confirmedRows, now);
  const previous = await loadBU23JBGuideCounts();
  const latest = {...previous, ...fresh};

  // Preserve recent provider-positive evidence during an
  // inconclusive observation without renewing its timestamp.
  for (const [id, entry] of Object.entries(fresh)) {
    const prior = previous[id];
    if (entry.reachable === 0 && bu23jbRecentLive(prior, now)) {
      latest[id] = prior;
    }
  }
  // During an upstream Nexo rate limit, do not turn recovered/stale rows into
  // a fresh LIVE proof or erase a prior provider-positive observation.
  if (nexoRateLimited) {
    const prior = (await loadBU23JBGuideCounts())['community.nexotv'];
    if (prior) latest['community.nexotv'] = prior;
    else if (latest['community.nexotv']) latest['community.nexotv'] = {
      ...latest['community.nexotv'], reachable: 0,
    };
  }
  if (scope !== bu23jbScope()) return; // account/add-on changes during I/O
  try {
    await Storage.setItem(KEY, JSON.stringify({schema: 1, scope, savedAt: now, byAddon: latest}));
    DeviceEventEmitter.emit(BU23JB_COUNT_EVENT);
  } catch (error) { console.warn('[BU23JB] count cache write failed', error); }
}
