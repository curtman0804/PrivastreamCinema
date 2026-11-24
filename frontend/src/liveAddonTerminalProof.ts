// BU23IF — isolated terminal proof adapter. Never infer DOWN from an empty catalog.
// A native batch is usable only if complete and EVERY listed candidate for this
// provider was checked, has an explicit terminalMissing result, and has no
// playable stream or inconclusive result. Add-on scan must have completed.
import type { BU23ICNegativeProof } from './liveAddonGuideStatus';

type SourceRow = {
  addonId?: unknown; id?: unknown; imdb_id?: unknown;
  deviceCheckStreams?: unknown;
};
type NativeResult = {
  playable?: unknown; terminalMissing?: unknown; reason?: unknown;
};
type NativeProbe = {
  complete?: unknown; terminalFailedKeys?: unknown;
  inconclusiveKeys?: unknown; playableKeys?: unknown;
  results?: Record<string, NativeResult>;
};
function stringKey(value: unknown): string {
  return String(value || '').trim();
}
function keys(value: unknown): Set<string> {
  return new Set((Array.isArray(value) ? value : [])
    .filter((v): v is string => typeof v === 'string' && !!v.trim()));
}
function synthetic(row: SourceRow): boolean {
  return stringKey(row?.imdb_id || row?.id).toLowerCase() === 'ratelimit_error';
}
function addonId(row: SourceRow): string { return stringKey(row?.addonId); }
export function buildBU23IFTerminalProof(
  catalogCompleted: boolean,
  providerIds: string[],
  backendPlayable: SourceRow[],
  deviceCandidates: SourceRow[],
  rawProbe: unknown,
): BU23ICNegativeProof {
  const empty: BU23ICNegativeProof = {};
  const probe = (rawProbe && typeof rawProbe === 'object')
    ? rawProbe as NativeProbe : null;
  if (catalogCompleted !== true || probe?.complete !== true ||
      !Array.isArray(probe.terminalFailedKeys) ||
      !Array.isArray(probe.inconclusiveKeys) ||
      !Array.isArray(probe.playableKeys) ||
      !probe.results || typeof probe.results !== 'object') return empty;
  const backend = Array.isArray(backendPlayable) ? backendPlayable : [];
  const device = Array.isArray(deviceCandidates) ? deviceCandidates : [];
  // A synthetic rate-limit channel anywhere indicates an uncertain inventory.
  if ([...backend, ...device].some(synthetic)) return empty;
  const terminal = keys(probe.terminalFailedKeys);
  const inconclusive = keys(probe.inconclusiveKeys);
  const playable = keys(probe.playableKeys);
  const proof: BU23ICNegativeProof = {};
  for (const rawId of providerIds || []) {
    const id = stringKey(rawId);
    if (!id || backend.some(row => addonId(row) === id)) continue;
    const rows = device.filter(row => addonId(row) === id);
    if (!rows.length) continue; // No channels != dead channels.
    const expected: string[] = [];
    let valid = true;
    for (const row of rows) {
      const channelId = stringKey(row?.id);
      const streams = row?.deviceCheckStreams;
      if (!channelId || !Array.isArray(streams) || !streams.length) {
        valid = false; break;
      }
      const urls = streams.map((s: any) => stringKey(s?.url)).filter(Boolean);
      // The caller only supplies four URLs to native. More means incomplete.
      if (urls.length !== streams.length ||
          new Set(urls).size > 4 || new Set(urls).size === 0) {
        valid = false; break;
      }
      const key = id + ':' + channelId;
      if (expected.includes(key) || !terminal.has(key) ||
          inconclusive.has(key) || playable.has(key) ||
          probe.results[key]?.terminalMissing !== true ||
          probe.results[key]?.playable !== false) {
        valid = false; break;
      }
      expected.push(key);
    }
    if (valid && expected.length === rows.length) {
      proof[id] = { complete: true, candidateKeys: expected,
        terminalFailedKeys: [...expected], inconclusiveKeys: [] };
    }
  }
  return proof;
}
