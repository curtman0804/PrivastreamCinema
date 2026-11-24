// BU23IO — SOURCE-ONLY, NOT DEPLOYED.
// Owned by the Live TV guide while focused. Does NOT run during playback or while the app
// is backgrounded. Add-ons need not be open. An incomplete catalog/probe NEVER marks DOWN.
import { api } from './api/client';
import { useContentStore } from './store/contentStore';
import { probeLiveTvDeviceCandidates } from './native/devicePlaybackCapabilities';
import { buildBU23IFTerminalProof } from './liveAddonTerminalProof';
import { publishBU23HZAddonScan } from './liveAddonGuideStatus';

const RECHECK_MS = 15 * 60 * 1000;
// BU23IZ: upper bound to avoid a multi-minute scan in the active app.
// Partial inventory never counts as proof of addon-wide failure.
const MAX_PAGES = 4;
const MAX_ROWS = 12000;
const MAX_NATIVE_URLS = 128;
let pending: Promise<string> | null = null;
const lastStartedByScope = new Map<string, number>();
const nativeOffsetByScope = new Map<string, number>();

function str(value: unknown): string { return String(value || '').trim(); }
function synthetic(row: any): boolean {
  return str(row?.imdb_id || row?.id).toLowerCase() === 'ratelimit_error';
}
function tvAddonIds(): { scope: string; ids: string[] } | null {
  const state = useContentStore.getState();
  const uid = str(state.currentUserId);
  if (!uid || state.isLoadingAddons || !Array.isArray(state.addons) || !state.addons.length) return null;
  const ids = Array.from(new Set(state.addons
    .filter((addon: any) => Array.isArray(addon?.manifest?.types) &&
      addon.manifest.types.some((value: unknown) => str(value).toLowerCase() === 'tv'))
    .map((addon: any) => str(addon?.manifest?.id)).filter(Boolean))).sort();
  if (!ids.length) return null;
  return { scope: JSON.stringify([uid, ids]), ids };
}

async function scan(isActive: () => boolean): Promise<string> {
  const target = tvAddonIds();
  if (!target || !isActive()) return 'SKIPPED_NOT_READY';
  const backend: any[] = [];
  const device: any[] = [];
  let sourceIndex = 0, skip = 0, done = false;
  const visited = new Set<string>();
  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum += 1) {
    if (!isActive() || tvAddonIds()?.scope !== target.scope) return 'CANCELLED_GUIDE_UNFOCUSED_OR_SCOPE_CHANGED';
    const cursor = sourceIndex + ':' + skip;
    if (visited.has(cursor)) return 'INCONCLUSIVE_CURSOR_REPEAT';
    visited.add(cursor);
    let page: any;
    try { page = await api.content.getLiveTvInventoryPage(sourceIndex, skip, 400); }
    catch (_) { return 'INCONCLUSIVE_CATALOG_REQUEST'; }
    if (!page || (page.items != null && !Array.isArray(page.items)) ||
        (page.deviceCheckItems != null && !Array.isArray(page.deviceCheckItems)))
      return 'INCONCLUSIVE_PAGE_SHAPE';
    const pageItems: any[] = page.items || [];
    const checkItems: any[] = page.deviceCheckItems || [];
    if (pageItems.some(synthetic) || checkItems.some(synthetic)) return 'INCONCLUSIVE_RATE_LIMIT';
    backend.push(...pageItems);
    device.push(...checkItems);
    if (backend.length + device.length > MAX_ROWS) return 'INCONCLUSIVE_TOO_MANY_ROWS';
    if (page.done === true) { done = true; break; }
    const nsi = Number(page.nextSourceIndex), nskip = Number(page.nextSkip);
    if (!Number.isInteger(nsi) || nsi < 0 || !Number.isInteger(nskip) || nskip < 0 ||
        `${nsi}:${nskip}` === cursor) return 'INCONCLUSIVE_INVALID_CURSOR';
    sourceIndex = nsi; skip = nskip;
  }
  // A bounded incomplete inventory can yield positive
  // evidence, but can never establish provider-wide failure.
  const catalogComplete = done;
  if (!catalogComplete) {
    console.log('[BU23KW HEALTH] partial inventory');
  }
  if (!isActive() || tvAddonIds()?.scope !== target.scope) return 'CANCELLED_BEFORE_PROBE';
  const playableByAddon = new Map<string, Set<string>>();
  const eligible = new Set(target.ids);
  const addPlayable = (row: any) => {
    const id = str(row?.addonId), channel = str(row?.imdb_id || row?.id);
    if (!eligible.has(id) || !channel || synthetic(row)) return;
    let set = playableByAddon.get(id);
    if (!set) { set = new Set<string>(); playableByAddon.set(id, set); }
    set.add(channel);
  };
  backend.forEach(addPlayable);
  const nativeRows: { key: string; url: string; headers: Record<string, unknown> }[] = [];
  let nativePartial = false;
  for (const row of device) {
    const id = str(row?.addonId), channel = str(row?.id);
    if (!eligible.has(id) || !channel) continue;
    const streams = Array.isArray(row?.deviceCheckStreams) ? row.deviceCheckStreams : [];
    // Sampled alternates can yield positive evidence, never terminal proof.
    if (streams.length > 4) nativePartial = true;
    for (const item of streams.slice(0, 4)) {
      const url = str(item?.url);
      if (!url) return 'INCONCLUSIVE_EMPTY_SOURCE_URL';
      nativeRows.push({ key: id + ':' + channel, url,
        headers: item?.headers && typeof item.headers === 'object' ? item.headers : {} });
    }
  }
  let probe: any = null;
  let probeRows = nativeRows;
  if (nativeRows.length > MAX_NATIVE_URLS) {
    // Round-robin POSITIVE checks only. A sampled batch can NEVER confirm an outage.
    nativePartial = true;
    const start = (nativeOffsetByScope.get(target.scope) || 0) % nativeRows.length;
    probeRows = nativeRows.slice(start, start + MAX_NATIVE_URLS);
    if (probeRows.length < MAX_NATIVE_URLS) probeRows.push(
      ...nativeRows.slice(0, MAX_NATIVE_URLS - probeRows.length));
    nativeOffsetByScope.set(target.scope, (start + MAX_NATIVE_URLS) % nativeRows.length);
  }
  if (probeRows.length) {
    try { probe = await probeLiveTvDeviceCandidates(probeRows as any, 2500) as any; }
    catch (_) { return 'INCONCLUSIVE_NATIVE_PROBE_ERROR'; }
    if (!probe || probe.complete !== true || !Array.isArray(probe.playableKeys))
      return 'INCONCLUSIVE_NATIVE_PROBE_INCOMPLETE';
    const matches = new Set(probe.playableKeys.map((v: any) => str(v)));
    for (const row of device) {
      if (matches.has(str(row?.addonId) + ':' + str(row?.id))) addPlayable(row);
    }
  }
  if (!isActive() || tvAddonIds()?.scope !== target.scope) return 'CANCELLED_BEFORE_PUBLISH';
  const snapshot: Record<string, { state: 'live' | 'down'; available: number }> = {};
  for (const id of target.ids) {
    const available = playableByAddon.get(id)?.size || 0;
    snapshot[id] = { state: available ? 'live' : 'down', available };
  }
  // Down requires complete native terminal evidence for all candidates, TWO scans
  // separated in time, and cannot be inferred from zero playable rows alone.
  const negativeProof = buildBU23IFTerminalProof(catalogComplete && !nativePartial, target.ids, backend, device, catalogComplete && !nativePartial ? probe : null);
  await publishBU23HZAddonScan(snapshot, backend, device, negativeProof);
  return catalogComplete
    ? 'PUBLISHED_COMPLETE_SCAN'
    : 'PUBLISHED_PARTIAL_POSITIVE_SCAN';
}

export async function runBU23IOGuideHealthRecheck(isActive: () => boolean): Promise<string> {
  if (!isActive()) return 'SKIPPED_UNFOCUSED';
  const target = tvAddonIds();
  if (!target) return 'SKIPPED_ADDONS_NOT_LOADED';
  if (pending) return pending;
  const now = Date.now();
  const previous = lastStartedByScope.get(target.scope) || 0;
  if (now - previous < RECHECK_MS) return 'SKIPPED_THROTTLED';
  lastStartedByScope.set(target.scope, now);
  pending = scan(isActive).catch((_) => 'INCONCLUSIVE_EXCEPTION').finally(() => { pending = null; });
  return pending;
}
