// W121ZLIVE178P: conservative persistent terminal-failure quarantine.
// No background playback probe. Confirmed malformed feeds remain hidden until independently verified healthy.
import Storage from './utils/mmkvStorage';
import { DeviceEventEmitter } from 'react-native';
import { HEALTH_HIDE_AFTER, needsRecheck, recordTerminalFailure, recordVerifiedSuccess, type FeedHealthRegistry } from './liveChannelHealth';
const STORAGE_KEY = 'w121zlive178p:health:v1';
let store: FeedHealthRegistry = {};
let loading: Promise<void> | null = null;
let serial: Promise<void> = Promise.resolve();
export const healthIdentity = (addon: unknown, id: unknown) => JSON.stringify([String(addon || '').trim(), String(id || '').trim()]);
export async function loadLiveHealth(): Promise<FeedHealthRegistry> {
  if (!loading) loading = (async () => {
    try { const raw = await Storage.getItem(STORAGE_KEY); const data = raw ? JSON.parse(raw) : {};
      if (data && typeof data === 'object' && !Array.isArray(data)) store = data;
    } catch (error) { console.warn('[178P HEALTH] load failed', error); }
  })();
  await loading; return { ...store };
}
async function write(next: FeedHealthRegistry): Promise<void> {
  store = next;
  try { await Storage.setItem(STORAGE_KEY, JSON.stringify(store)); }
  catch (error) { console.warn('[178P HEALTH] persist failed', error); }
  DeviceEventEmitter.emit('W121ZLIVE178P_HEALTH_CHANGED');
}
export function reportLiveTerminalFailure(addon: unknown, id: unknown): Promise<void> {
  if (!addon || !id) return Promise.resolve();
  serial = serial.catch(() => {}).then(async () => {
    await loadLiveHealth();
    const key = healthIdentity(addon, id);
    await write(recordTerminalFailure(store, key, Date.now()));
  }); return serial;
}
export function reportLiveVerifiedPlayback(addon: unknown, id: unknown): Promise<void> {
  if (!addon || !id) return Promise.resolve();
  serial = serial.then(async () => {
    await loadLiveHealth(); const key = healthIdentity(addon,id);
    await write(recordVerifiedSuccess(store,key,Date.now()));
  }); return serial;
}
// A timer permits recheck, not automatic redisplay of an unverified station.
export function temporarilyHidden(snapshot: FeedHealthRegistry, addon: unknown, id: unknown, at: number): boolean {
  const record = snapshot[healthIdentity(addon,id)];
  return !!record && record.failures >= HEALTH_HIDE_AFTER && record.lastFailureMs > (record.lastSuccessMs || 0);
}
export function channelRecheckEligible(snapshot: FeedHealthRegistry, addon: unknown, id: unknown, at: number): boolean {
  const key = healthIdentity(addon, id);
  const record = snapshot[key];
  return !!record && record.lastFailureMs > (record.lastSuccessMs || 0) && needsRecheck(snapshot, key, at);
}
