// BU23JL — Nexo-only sample; NEVER an add-on-wide availability count.
// One bounded authenticated backend request per 30 minutes. The backend route
// MUST first be deployed separately. Any 404/rate-limit/timeout is inconclusive;
// this file NEVER writes a DOWN state or erases positive guide evidence.
import Storage from './utils/mmkvStorage';
import { DeviceEventEmitter } from 'react-native';
import { useContentStore } from './store/contentStore';
import { api } from './api/client';
import { probeLiveTvDeviceCandidates } from './native/devicePlaybackCapabilities';
import { bu23jbScope } from './liveAddonGuideCounts';

export const BU23JL_NEXO_EVENT = 'BU23JL_NEXO_SAMPLE_UPDATED';
const KEY = 'bu23jl:nexo-positive-sample:v1';
const PROOF_TTL_MS = 6 * 60 * 60 * 1000;
const RECHECK_MS = 30 * 60 * 1000;
const MAX_CANDIDATES = 12;
const MAX_URLS = 24;
let running: Promise<string> | null = null;
const attempted = new Map<string, number>();
// Rotate to the next Nexo-only page on the next check; no full-catalog storm.
const nextCursor = new Map<string, {sourceIndex:number;skip:number}>();

export type BU23JLNexoSample = {
  positive: number;
  sampledRows: number;
  observedAt: number;
  partial: true;
};
function str(x: unknown): string { return String(x || '').trim(); }
function validId(row: any): string {
  const id = str(row?.id || row?.imdb_id || row?.item?.id);
  return id.toLowerCase() === 'ratelimit_error' ? '' : id;
}
function nexoInstalled(): boolean {
  const state = useContentStore.getState();
  return Array.isArray(state.addons) && state.addons.some((addon: any) =>
    str(addon?.manifest?.id) === 'community.nexotv' &&
    Array.isArray(addon?.manifest?.types) &&
    addon.manifest.types.some((type: unknown) => str(type).toLowerCase() === 'tv'));
}
export async function loadBU23JLNexoSample(): Promise<BU23JLNexoSample | null> {
  const scope = bu23jbScope();
  if (!scope || !nexoInstalled()) return null;
  try {
    const raw = await Storage.getItem(KEY);
    if (!raw || raw.length > 5000) return null;
    const parsed = JSON.parse(raw);
    const record = parsed?.sample;
    const now = Date.now();
    if (parsed?.schema !== 1 || parsed?.scope !== scope || !record ||
        record.partial !== true || !Number.isInteger(record.positive) ||
        record.positive < 1 || record.positive > MAX_CANDIDATES ||
        !Number.isInteger(record.sampledRows) ||
        record.sampledRows < record.positive || record.sampledRows > MAX_CANDIDATES ||
        !Number.isFinite(record.observedAt) || record.observedAt > now ||
        now - record.observedAt > PROOF_TTL_MS) return null;
    return record as BU23JLNexoSample;
  } catch (_) { return null; }
}

async function run(): Promise<string> {
  const scope = bu23jbScope();
  if (!scope || !nexoInstalled()) return 'NOT_READY';
  // Only 12 catalog candidates, even if the backend declares more pages.
  let page: any;
  const cursor = nextCursor.get(scope) || {sourceIndex:0, skip:0};
  try { page = await api.content.getBU23JLNexoInventoryPage(
    cursor.sourceIndex, cursor.skip, MAX_CANDIDATES); }
  catch (_) { return 'INCONCLUSIVE_BACKEND_ROUTE_OR_NETWORK'; }
  if (scope !== bu23jbScope() || !nexoInstalled()) return 'SCOPE_CHANGED';
  if (!page || page?.source?.addonId !== 'community.nexotv' ||
      !Array.isArray(page.items) || !Array.isArray(page.deviceCheckItems))
    return 'INCONCLUSIVE_PROVIDER_OR_PAGE_SHAPE';
  // An explicit synthetic/error row invalidates the sample rather than DOWN.
  if ([...page.items, ...page.deviceCheckItems].some((row: any) =>
      str(row?.id || row?.imdb_id).toLowerCase() === 'ratelimit_error'))
    return 'INCONCLUSIVE_SYNTHETIC_ROW';
  if (page.items.length + page.deviceCheckItems.length > MAX_CANDIDATES)
    return 'INCONCLUSIVE_TOO_MANY_ROWS';
  const observed = new Set<string>();
  const positive = new Set<string>();
  for (const row of page.items) {
    if (str(row?.addonId) !== 'community.nexotv') return 'INCONCLUSIVE_MIXED_PROVIDER';
    const id = validId(row);
    if (id) { observed.add(id); positive.add(id); }
  }
  const probeRows: {key:string;url:string;headers:Record<string, unknown>}[] = [];
  for (const row of page.deviceCheckItems) {
    if (str(row?.addonId) !== 'community.nexotv') return 'INCONCLUSIVE_MIXED_PROVIDER';
    const id = validId(row);
    if (!id) continue;
    observed.add(id);
    const streams: any[] = Array.isArray(row?.deviceCheckStreams) ? row.deviceCheckStreams : [];
    for (const item of streams.slice(0, 2)) {
      const url = str(item?.url);
      if (!/^https?:\/\//i.test(url)) continue;
      probeRows.push({key:'community.nexotv:'+id,url,
        headers: item?.headers && typeof item.headers === 'object' ? item.headers : {}});
    }
  }
  if (observed.size > MAX_CANDIDATES) return 'INCONCLUSIVE_TOO_MANY_CHANNELS';
  if (probeRows.length > MAX_URLS) return 'INCONCLUSIVE_TOO_MANY_PROBES';
  // Advance only after validating a real, correctly scoped catalog page.
  // A rate-limit or malformed response leaves the cursor unchanged.
  if (page.done === true) nextCursor.delete(scope);
  else if (Number.isInteger(page.nextSourceIndex) && page.nextSourceIndex >= 0 &&
      Number.isInteger(page.nextSkip) && page.nextSkip >= 0 &&
      (page.nextSourceIndex !== cursor.sourceIndex || page.nextSkip !== cursor.skip)) {
    nextCursor.set(scope, {sourceIndex:page.nextSourceIndex,skip:page.nextSkip});
  }
  if (probeRows.length) {
    try {
      const result: any = await probeLiveTvDeviceCandidates(probeRows as any, 2500);
      if (result && result.complete === true && Array.isArray(result.playableKeys)) {
        for (const candidate of result.playableKeys) {
          const key = str(candidate);
          if (key.startsWith('community.nexotv:')) {
            const id = key.slice('community.nexotv:'.length);
            if (observed.has(id)) positive.add(id);
          }
        }
      }
    } catch (_) { /* fail neutral: keep backend-positive evidence */ }
  }
  if (!positive.size || scope !== bu23jbScope() || !nexoInstalled())
    return 'INCONCLUSIVE_NO_POSITIVE_EVIDENCE';
  const sample: BU23JLNexoSample = {
    positive: positive.size, sampledRows: observed.size,
    observedAt: Date.now(), partial: true,
  };
  try {
    await Storage.setItem(KEY, JSON.stringify({schema:1,scope,sample}));
    if (scope !== bu23jbScope()) return 'SCOPE_CHANGED_AFTER_WRITE';
    DeviceEventEmitter.emit(BU23JL_NEXO_EVENT);
    return 'POSITIVE_SAMPLE_PUBLISHED';
  } catch (_) { return 'INCONCLUSIVE_CACHE_WRITE'; }
}
export function runBU23JLNexoSample(): Promise<string> {
  const scope = bu23jbScope();
  if (!scope || !nexoInstalled()) return Promise.resolve('NOT_READY');
  if (running) return running;
  const now = Date.now(), last = attempted.get(scope) || 0;
  if (now - last < RECHECK_MS) return Promise.resolve('THROTTLED');
  attempted.set(scope, now);
  running = run().catch(() => 'INCONCLUSIVE_EXCEPTION').finally(() => { running = null; });
  return running;
}
