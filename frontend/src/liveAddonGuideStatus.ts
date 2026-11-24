// BU23HZ — ISOLATED CANDIDATE ONLY. This file is NOT installed.
// A successful, complete Add-ons inventory check may publish validated health.
// A 429, a synthetic ratelimit_error entry, an empty catalog or a failed scan
// is NOT evidence that all streams from an add-on are dead.
import Storage from './utils/mmkvStorage';
import { DeviceEventEmitter } from 'react-native';
export const BU23HZ_ADDON_EVENT = 'BU23HZ_ADDON_HEALTH_CHANGED';
const KEY = 'bu23ic:addon-health:v2'; // New evidence schema: do not import old unproven DOWN records.
const TWO_SCAN_MIN_GAP_MS = 30 * 1000;
const FAILURE_WINDOW_MS = 60 * 60 * 1000;
type ProviderRecord = {
  state: 'live' | 'degraded' | 'down';
  failedChecks: number;
  lastCheckedMs: number;
  lastFailedMs: number;
  lastPlayableMs: number;
  evidence: 'playable_stream' | 'terminal_stream_probe' | 'unverified';
};
export type BU23HZAddonRegistry = Record<string, ProviderRecord>;
type ScanRow = { addonId?: unknown; id?: unknown; imdb_id?: unknown };
type ScanStatus = { state?: string; available?: number };
// Explicit evidence must refer to EVERY probed channel in a completed addon scan.
// Inconclusive, timeout, 429, unavailable native probe, and empty catalogs never count.
export type BU23ICNegativeProof = Record<string, {
  complete: boolean;
  candidateKeys: string[];
  terminalFailedKeys: string[];
  inconclusiveKeys: string[];
}>;
export function hasBU23ICTerminalProof(proof: BU23ICNegativeProof[string] | undefined): boolean {
  if (!proof || proof.complete !== true) return false;
  if (!Array.isArray(proof.candidateKeys) || proof.candidateKeys.length === 0 ||
      !Array.isArray(proof.terminalFailedKeys) || !Array.isArray(proof.inconclusiveKeys) ||
      proof.inconclusiveKeys.length !== 0) return false;
  const candidates = new Set(proof.candidateKeys.filter((k) => typeof k === 'string' && !!k.trim()));
  const failed = new Set(proof.terminalFailedKeys.filter((k) => typeof k === 'string' && !!k.trim()));
  return candidates.size === proof.candidateKeys.length &&
    candidates.size > 0 && Array.from(candidates).every((k) => failed.has(k));
}
let cache: BU23HZAddonRegistry = {};
let initialized = false;
let serial: Promise<void> = Promise.resolve();
function safeKey(id: unknown): string { return String(id || '').trim(); }
function isSynthetic(row: ScanRow): boolean {
  return String(row?.imdb_id || row?.id || '').trim().toLowerCase() === 'ratelimit_error';
}
export function reconcileAddonScan(
  previous: BU23HZAddonRegistry,
  scan: Record<string, ScanStatus>,
  backendRows: ScanRow[],
  deviceRows: ScanRow[],
  now: number,
  terminalProof: BU23ICNegativeProof = {},
): BU23HZAddonRegistry {
  if (!Number.isFinite(now)) return previous;
  const next = { ...previous };
  const allRows = [...(Array.isArray(backendRows) ? backendRows : []),
                   ...(Array.isArray(deviceRows) ? deviceRows : [])];
  for (const [rawId, raw] of Object.entries(scan || {})) {
    const id = safeKey(rawId);
    if (!id || !raw || raw.state === 'checking') continue;
    const old = next[id];
    const owned = allRows.filter((row) => safeKey(row.addonId) === id);
    // Page errors presented as catalog items cannot count as failed playback.
    const suspicious = owned.some(isSynthetic);
    if (raw.state === 'live' && Number(raw.available || 0) > 0) {
      next[id] = { state: 'live', failedChecks: 0, lastCheckedMs: now,
        lastFailedMs: 0, lastPlayableMs: now, evidence: 'playable_stream' };
      continue;
    }
    // A list of candidate rows is NOT proof that native playback failed.
    // Native presently exposes playableKeys but no terminalFailedKeys contract.
    // This proof intentionally remains absent until the device API is extended.
    const proof = terminalProof[id];
    const hasDefinitiveFailure = hasBU23ICTerminalProof(proof);
    if (raw.state !== 'down' || suspicious || !hasDefinitiveFailure) {
      // Empty inventories, timeouts, 429s and ambiguous results preserve known-good.
      if (!old) next[id] = { state: 'degraded', failedChecks: 0,
        lastCheckedMs: now, lastFailedMs: 0, lastPlayableMs: 0,
        evidence: 'unverified' };
      continue;
    }
    // The native device probe had candidate streams and the completed scan
    // reported none playable. Require TWO separate negative scans, not retries
    // within one scan. Never hide merely because a clock expires.
    if (old && now <= old.lastCheckedMs) continue;
    if (old && now - old.lastCheckedMs < TWO_SCAN_MIN_GAP_MS) continue;
    const inWindow = !!old?.lastFailedMs && now - old.lastFailedMs <= FAILURE_WINDOW_MS;
    const failedChecks = inWindow ? Math.min(2, old!.failedChecks + 1) : 1;
    next[id] = { state: failedChecks >= 2 ? 'down' : 'degraded',
      failedChecks, lastCheckedMs: now, lastFailedMs: now,
      lastPlayableMs: old?.lastPlayableMs || 0, evidence: 'terminal_stream_probe' };
  }
  return next;
}
export function isAddonConfirmedDown(snapshot: BU23HZAddonRegistry, addonId: unknown): boolean {
  const record = snapshot[safeKey(addonId)];
  return !!record && record.state === 'down' &&
    record.failedChecks >= 2 && record.evidence === 'terminal_stream_probe' &&
    record.lastFailedMs > record.lastPlayableMs;
}
export async function loadBU23HZAddonHealth(): Promise<BU23HZAddonRegistry> {
  if (!initialized) {
    initialized = true;
    try {
      const raw = await Storage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cache = parsed;
    } catch (_) { cache = {}; }
  }
  return { ...cache };
}
export function publishBU23HZAddonScan(
  scan: Record<string, ScanStatus>, backendRows: ScanRow[], deviceRows: ScanRow[],
  terminalProof: BU23ICNegativeProof = {},
): Promise<void> {
  serial = serial.catch(() => {}).then(async () => {
    const prior = await loadBU23HZAddonHealth();
    cache = reconcileAddonScan(prior, scan, backendRows, deviceRows, Date.now(), terminalProof);
    try { await Storage.setItem(KEY, JSON.stringify(cache)); }
    catch (err) { console.warn('[BU23HZ] health persist failed', err); }
    DeviceEventEmitter.emit(BU23HZ_ADDON_EVENT);
  });
  return serial;
}

// BU23IB: add-on badge and guide hide decision derive from the SAME completed scan.
export type BU23IBDisplayHealth = {
  state: 'live' | 'degraded' | 'down';
  available: number;
};
export function deriveBU23IBAddonDisplay(
  scan: Record<string, { state?: string; available?: number }>,
  saved: BU23HZAddonRegistry,
): Record<string, BU23IBDisplayHealth> {
  const next: Record<string, BU23IBDisplayHealth> = {};
  for (const [addonId, row] of Object.entries(scan || {})) {
    const rawCount = Number(row?.available || 0);
    const count = Number.isFinite(rawCount) ? Math.max(0, rawCount) : 0;
    const state = isAddonConfirmedDown(saved, addonId)
      ? 'down'
      : (row?.state === 'live' && count > 0 && saved[addonId]?.state === 'live')
        ? 'live' : 'degraded';
    next[addonId] = { state, available: count };
  }
  return next;
}
