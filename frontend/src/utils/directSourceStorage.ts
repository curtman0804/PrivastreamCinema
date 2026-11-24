// W121ZLIVE168F — durable direct-source storage, device-local only.
// Retain the legacy storage key for migration; no backend upload.
import * as FileSystem from 'expo-file-system/legacy';
import Storage from './mmkvStorage';

const KEY = 'privastream:saved_sources';
const PATH = (FileSystem.documentDirectory || '') + 'privastream-direct-sources.json';

export async function loadDurableDirectSources(): Promise<any[]> {
  // Read independent on-device file first; fall back to old app storage.
  try {
    if (PATH && (await FileSystem.getInfoAsync(PATH)).exists) {
      const raw = await FileSystem.readAsStringAsync(PATH);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((x: any) => x && x.id && x.url && x.type);
      throw new Error('Saved source file contains invalid data');
    }
  } catch (e) {
    console.warn('[W168F] durable source read failed; trying legacy store', e);
  }
  const raw = await Storage.getItem(KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Legacy saved source data invalid');
  return parsed.filter((x: any) => x && x.id && x.url && x.type);
}

export async function persistDurableDirectSources(sources: any[]): Promise<void> {
  if (!PATH) throw new Error('Device document storage unavailable');
  const raw = JSON.stringify(sources);
  // Write to a temporary file and verify before replacing the working copy.
  const temp = PATH + '.new';
  await FileSystem.writeAsStringAsync(temp, raw);
  if ((await FileSystem.readAsStringAsync(temp)) !== raw) {
    throw new Error('Direct source temporary write verification failed');
  }
  // Keep existing durable copy until replacement is verified.
  const backup = PATH + '.bak';
  const existed = (await FileSystem.getInfoAsync(PATH)).exists;
  if (existed) {
    await FileSystem.copyAsync({ from: PATH, to: backup });
    await FileSystem.deleteAsync(PATH, { idempotent: true });
  }
  try {
    await FileSystem.moveAsync({ from: temp, to: PATH });
    if ((await FileSystem.readAsStringAsync(PATH)) !== raw) {
      throw new Error('Direct source readback mismatch');
    }
  } catch (e) {
    if (existed && (await FileSystem.getInfoAsync(backup)).exists) {
      await FileSystem.copyAsync({ from: backup, to: PATH });
    }
    throw e;
  }
  // Best-effort migration mirror only. The verified file is authoritative.
  try { await Storage.setItem(KEY, raw); } catch (e) {
    console.warn('[W168F] legacy mirror unavailable', e);
  }
}
