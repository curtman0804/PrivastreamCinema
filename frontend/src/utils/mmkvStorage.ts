/* V379_MMKV_V4_COMPAT - react-native-mmkv v4 removed `new MMKV()` (now
 * `createMMKV()`) and renamed `.delete()` to `.remove()`. This factory works
 * on both v3 and v4 and returns an instance where BOTH .delete and .remove
 * exist, so downstream shim code never needs to care about the version. */
const _v379mod: any = require('react-native-mmkv');
const _v379make = (cfg?: any): any => {
  const m: any = _v379mod && _v379mod.createMMKV
    ? _v379mod.createMMKV(cfg)
    : new _v379mod.MMKV(cfg);
  if (typeof m.delete === 'function') return m; // v3 - use as-is
  // v4 HybridObject: wrap in plain JS object (can't add props to native obj)
  return {
    set: (k: any, v: any) => m.set(k, v),
    getString: (k: any) => m.getString(k),
    getNumber: (k: any) => m.getNumber(k),
    getBoolean: (k: any) => m.getBoolean(k),
    getBuffer: (k: any) => m.getBuffer && m.getBuffer(k),
    contains: (k: any) => m.contains(k),
    delete: (k: any) => m.remove(k),
    remove: (k: any) => m.remove(k),
    getAllKeys: () => m.getAllKeys(),
    clearAll: () => m.clearAll(),
    recrypt: (k: any) => m.encrypt && m.encrypt(k),
    trim: () => m.trim && m.trim(),
    addOnValueChangedListener: (cb: any) =>
      m.addOnValueChangedListener && m.addOnValueChangedListener(cb),
  };
};
/* mmkvStorage.ts - V377_MMKV_TRI_TIER  (MMKV migration phase 2)
 *
 * AsyncStorage-compatible persistent KV store with three engines:
 *   1. react-native-mmkv (native JSI)  - active when the APK includes it
 *   2. FS KV store (V376)              - fallback on APKs without MMKV
 *   3. legacy SQLite AsyncStorage      - read-only migration source
 * Reads fall through the tiers and migrate values UP, so auth sessions,
 * PM keys and watch progress carry forward automatically.
 */
import * as FileSystem from 'expo-file-system/legacy';
import RealAsyncStorage from '@react-native-async-storage/async-storage';

/* ---- Tier 1: native MMKV (throws + falls back on APKs without it) ---- */
let _mmkv: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { MMKV } = require('react-native-mmkv');
  const inst = _v379make({ id: 'privastream-kv-v1' });
  inst.set('__v377_probe__', '1');
  inst.delete('__v377_probe__');
  _mmkv = inst;
  console.log('[kvStore] MMKV native engine ACTIVE');
} catch (_e) {
  _mmkv = null;
  console.log('[kvStore] MMKV native unavailable - FS engine active');
}

/* ---- Tier 2: FS KV store (V376) ---- */
const DIR = (FileSystem.documentDirectory || '') + 'kv-store/';
const MEM_CACHE_MAX_VALUE = 262144; // 256 KB

let _dirReady: Promise<void> | null = null;
function ensureDir(): Promise<void> {
  if (_dirReady) return _dirReady;
  _dirReady = (async () => {
    try {
      const info = await FileSystem.getInfoAsync(DIR);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
      }
    } catch (e) {
      _dirReady = null;
      throw e;
    }
  })();
  return _dirReady;
}

function enc(key: string): string {
  return encodeURIComponent(key).replace(/~/g, '%7E').replace(/%/g, '~');
}
function dec(name: string): string {
  try { return decodeURIComponent(name.replace(/~/g, '%')); } catch { return name; }
}

const _mem = new Map<string, string | null>();
const _writeChains = new Map<string, Promise<void>>();

function _chain(key: string, op: () => Promise<void>): Promise<void> {
  const prev = _writeChains.get(key) || Promise.resolve();
  const next = prev.then(op, op);
  _writeChains.set(key, next);
  return next;
}

// V766S1_STORAGE_DIAGNOSTICS
function _v766s1TraceKey(key: string): boolean {
  return key === 'v766m_eac3_bad_hashes_v1' ||
    key === 'v766_eac3_decoder_broken';
}

async function _fsRead(key: string): Promise<string | null> {
  const path = DIR + enc(key) + '.kv';

  try {
    await ensureDir();
    const info: any = await FileSystem.getInfoAsync(path);

    if (_v766s1TraceKey(key)) {
      console.log(
        '[V766S1 FS READ] key=' + key +
        ' dir=' + DIR +
        ' path=' + path +
        ' exists=' + String(!!info?.exists) +
        ' size=' + String(info?.size ?? -1)
      );
    }

    if (!info.exists) return null;

    const value = await FileSystem.readAsStringAsync(path);

    if (_v766s1TraceKey(key)) {
      console.log(
        '[V766S1 FS READBACK] key=' + key +
        ' bytes=' + String(value.length)
      );
    }

    return value;
  } catch (e: any) {
    if (_v766s1TraceKey(key)) {
      console.log(
        '[V766S1 FS READ ERROR] key=' + key +
        ' path=' + path +
        ' err=' + (e && e.message ? e.message : String(e))
      );
    }
    return null;
  }
}

async function _fsWrite(key: string, value: string): Promise<void> {
  const path = DIR + enc(key) + '.kv';

  try {
    await ensureDir();
    await FileSystem.writeAsStringAsync(path, value);

    if (_v766s1TraceKey(key)) {
      const info: any = await FileSystem.getInfoAsync(path);
      const readBack = info?.exists
        ? await FileSystem.readAsStringAsync(path)
        : null;

      console.log(
        '[V766S1 FS WRITE VERIFY] key=' + key +
        ' dir=' + DIR +
        ' path=' + path +
        ' exists=' + String(!!info?.exists) +
        ' size=' + String(info?.size ?? -1) +
        ' bytes=' + String(readBack?.length ?? -1) +
        ' match=' + String(readBack === value)
      );
    }
  } catch (e: any) {
    console.log(
      '[kvStore] write failed key=' + key +
      ' path=' + path +
      ' err=' + (e && e.message ? e.message : String(e))
    );
  }
}

async function _fsDelete(key: string): Promise<void> {
  try {
    await ensureDir();
    await FileSystem.deleteAsync(DIR + enc(key) + '.kv', { idempotent: true });
  } catch { /* ignore */ }
}

function _memSet(key: string, value: string | null): void {
  if (value !== null && value.length > MEM_CACHE_MAX_VALUE) {
    _mem.delete(key);
  } else {
    _mem.set(key, value);
  }
}

/* ---- AsyncStorage-compatible API over the tiers ---- */
async function getItem(key: string): Promise<string | null> {
  // V766T2_V766_NULL_MEMORY_BYPASS
  // A cached null must not mask the durable MMKV/FS copy for the
  // two runtime capability keys. All other storage keys retain
  // the original in-memory null-sentinel behavior.
  if (_mem.has(key)) {
    const memValue = _mem.get(key) ?? null;

    if (memValue !== null || !_v766s1TraceKey(key)) {
      return memValue;
    }

    console.log('[V766T2 MEM NULL BYPASS] key=' + key);
    _mem.delete(key);
  }

  let v: string | null = null;
  if (_mmkv) {
    try {
      const s = _mmkv.getString(key);
      v = s === undefined ? null : s;

      if (_v766s1TraceKey(key)) {
        console.log(
          '[V766S1 MMKV READ] key=' + key +
          ' hit=' + String(v !== null) +
          ' bytes=' + String(v?.length ?? -1)
        );
      }
    } catch (e: any) {
      v = null;

      if (_v766s1TraceKey(key)) {
        console.log(
          '[V766S1 MMKV READ ERROR] key=' + key +
          ' err=' + (e && e.message ? e.message : String(e))
        );
      }
    }
  }
  if (v === null) {
    v = await _fsRead(key);
    const fromFs = v !== null;
    if (v === null) {
      try { v = await RealAsyncStorage.getItem(key); } catch { v = null; }
    }
    if (v !== null) {
      /* migrate the value UP to the best available tier */
      if (_mmkv) {
        try { _mmkv.set(key, v); } catch { /* ignore */ }
      } else if (!fromFs) {
        const vv = v;
        _chain(key, () => _fsWrite(key, vv));
      }
    }
  }
  _memSet(key, v);
  return v;
}

async function setItem(key: string, value: string): Promise<void> {
  _memSet(key, value);
  if (_mmkv) {
    try { _mmkv.set(key, value); return; } catch { /* fall through to FS */ }
  }
  await _chain(key, () => _fsWrite(key, value));
}

// V766P_DURABLE_V766_STORAGE
// Explicit MMKV + filesystem write-through for the small set of
// runtime capability keys that must survive a process restart.
// Normal callers keep the existing MMKV-first setItem behavior.
export async function setItemDurable(
  key: string,
  value: string
): Promise<void> {
  _memSet(key, value);

  if (_mmkv) {
    try {
      _mmkv.set(key, value);

      if (_v766s1TraceKey(key)) {
        const mmkvReadBack = _mmkv.getString(key);

        console.log(
          '[V766S1 MMKV WRITE VERIFY] key=' + key +
          ' bytes=' + String(mmkvReadBack?.length ?? -1) +
          ' match=' + String(mmkvReadBack === value)
        );
      }
    } catch (e: any) {
      if (_v766s1TraceKey(key)) {
        console.log(
          '[V766S1 MMKV WRITE ERROR] key=' + key +
          ' err=' + (e && e.message ? e.message : String(e))
        );
      }
    }
  }

  await _chain(key, () => _fsWrite(key, value));
}

async function removeItem(key: string): Promise<void> {
  _mem.set(key, null);
  if (_mmkv) {
    try { _mmkv.delete(key); } catch { /* ignore */ }
  }
  await _chain(key, () => _fsDelete(key));
  try { await RealAsyncStorage.removeItem(key); } catch { /* ignore */ }
}

async function getAllKeys(): Promise<string[]> {
  const out = new Set<string>();
  if (_mmkv) {
    try { for (const k of _mmkv.getAllKeys()) out.add(k); } catch { /* ignore */ }
  }
  try {
    await ensureDir();
    const files = await FileSystem.readDirectoryAsync(DIR);
    for (const f of files) {
      if (f.endsWith('.kv')) out.add(dec(f.slice(0, -3)));
    }
  } catch { /* ignore */ }
  try {
    const legacy = await RealAsyncStorage.getAllKeys();
    for (const k of legacy) out.add(k);
  } catch { /* ignore */ }
  return Array.from(out);
}

async function multiGet(keys: readonly string[]): Promise<Array<[string, string | null]>> {
  const out: Array<[string, string | null]> = [];
  for (const k of keys) out.push([k, await getItem(k)]);
  return out;
}

async function multiSet(pairs: readonly (readonly [string, string])[]): Promise<void> {
  for (const [k, v] of pairs) await setItem(k, v);
}

async function multiRemove(keys: readonly string[]): Promise<void> {
  for (const k of keys) await removeItem(k);
}

async function mergeItem(key: string, value: string): Promise<void> {
  try {
    const cur = await getItem(key);
    if (!cur) { await setItem(key, value); return; }
    const a = JSON.parse(cur);
    const b = JSON.parse(value);
    await setItem(key, JSON.stringify({ ...a, ...b }));
  } catch { /* ignore */ }
}

async function clear(): Promise<void> {
  try {
    _mem.clear();
    _writeChains.clear();
    if (_mmkv) { try { _mmkv.clearAll(); } catch { /* ignore */ } }
    await FileSystem.deleteAsync(DIR, { idempotent: true });
    _dirReady = null;
  } catch { /* ignore */ }
  try { await RealAsyncStorage.clear(); } catch { /* ignore */ }
}

const AsyncStorage = {
  getItem,
  setItem,
  removeItem,
  getAllKeys,
  multiGet,
  multiSet,
  multiRemove,
  mergeItem,
  clear,
};

export default AsyncStorage;
// ============================================================================
// V378_PROBE â€” independent MMKV init probe. Logs the EXACT failure reason.
// Remove after debugging.
// ============================================================================
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const _v378mod: any = require('react-native-mmkv');
  console.log('[kvStore][V378] mmkv module keys=' + Object.keys(_v378mod || {}).join(','));
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const _v378nitro: any = require('react-native-nitro-modules');
    console.log('[kvStore][V378] nitro module keys=' + Object.keys(_v378nitro || {}).join(','));
    try {
      const _v378box = _v378nitro.NitroModules
        ? _v378nitro.NitroModules.createHybridObject('MmkvPlatformContext')
        : null;
      console.log('[kvStore][V378] MmkvPlatformContext=' + (_v378box ? 'OK' : 'NitroModules missing'));
    } catch (e3: any) {
      console.log('[kvStore][V378] MmkvPlatformContext ERR=' + (e3 && e3.message ? e3.message : String(e3)));
    }
  } catch (e2: any) {
    console.log('[kvStore][V378] nitro require ERR=' + (e2 && e2.message ? e2.message : String(e2)));
  }
  const _v378i = _v379make({ id: 'v378probe' });
  _v378i.set('t', '1');
  console.log('[kvStore][V378] MMKV constructor OK, roundtrip=' + _v378i.getString('t'));
} catch (e: any) {
  console.log('[kvStore][V378] MMKV init ERR=' + (e && e.message ? e.message : String(e)));
  console.log('[kvStore][V378] MMKV init STACK=' + (e && e.stack ? String(e.stack).slice(0, 600) : 'none'));
}