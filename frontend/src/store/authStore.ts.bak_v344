import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, User, AuthResponse } from '../api/client';

// ============================================================
// V268_AUTH_PERSIST_HARDENED
// ============================================================
// Symptoms this fixes:
//   1) "Login failed: database or disk is full" on the Firestick because
//      AsyncStorage.setItem('auth_token', ...) throws SQLITE_FULL.
//   2) User has to log in on every cold start — the persisted token was
//      never actually written (the throw above also bypassed the in-memory
//      zustand `set` call, so even THIS session wasn't logged in).
//
// Strategy:
//   A) Install the V265 SQLITE_FULL swallow EARLIER in the import graph.
//      contentStore installed it, but the login screen never imports
//      contentStore, so the throw still bubbled.  Now we install it at
//      authStore module load time (which is reachable from login.tsx).
//   B) safeAuthSet(key, value): write → read back to verify → on miss,
//      purge `@metaCache:*` / `@streamsCache:*` bloat and retry.  Never
//      throws.
//   C) Set in-memory zustand state BEFORE attempting persistence so the
//      user is logged in this session even if the disk can never be
//      written.
//   D) Opportunistic purge on app boot (loadStoredAuth) — keeps the
//      SQLite file healthy without waiting for a failed write.
// ============================================================

(() => {
  if ((AsyncStorage as any).__v265_patched) return;
  (AsyncStorage as any).__v265_patched = true;
  const _isFull = (e: any) => {
    const m = String(e?.message || e || '');
    return (
      m.indexOf('SQLITE_FULL') !== -1 ||
      m.indexOf('disk is full') !== -1 ||
      m.indexOf('database or disk is full') !== -1
    );
  };
  const _origSet = AsyncStorage.setItem.bind(AsyncStorage);
  const _origMultiSet = AsyncStorage.multiSet
    ? AsyncStorage.multiSet.bind(AsyncStorage)
    : null;
  const _origMerge = (AsyncStorage as any).mergeItem
    ? (AsyncStorage as any).mergeItem.bind(AsyncStorage)
    : null;
  (AsyncStorage as any).setItem = async (k: string, v: string) => {
    try {
      return await _origSet(k, v);
    } catch (e: any) {
      if (_isFull(e)) {
        console.warn('[V268_SWALLOW] setItem SQLITE_FULL key=', k);
        return;
      }
      throw e;
    }
  };
  if (_origMultiSet) {
    (AsyncStorage as any).multiSet = async (pairs: any) => {
      try {
        return await _origMultiSet(pairs);
      } catch (e: any) {
        if (_isFull(e)) {
          console.warn(
            '[V268_SWALLOW] multiSet SQLITE_FULL n=',
            (pairs || []).length
          );
          return;
        }
        throw e;
      }
    };
  }
  if (_origMerge) {
    (AsyncStorage as any).mergeItem = async (k: string, v: string) => {
      try {
        return await _origMerge(k, v);
      } catch (e: any) {
        if (_isFull(e)) {
          console.warn('[V268_SWALLOW] mergeItem SQLITE_FULL key=', k);
          return;
        }
        throw e;
      }
    };
  }
  console.log(
    '[V268_AUTH_SQLITE_SWALLOW] AsyncStorage writes are now SQLITE_FULL-safe (early-installed)'
  );
})();

// One-shot bloat purge.  Removes the meta/streams cache keys that flood
// the SQLite file from contentStore.  Safe to call repeatedly — guarded.
let _purgeRanThisBoot = false;
async function _purgeCacheBloat(force = false): Promise<number> {
  if (_purgeRanThisBoot && !force) return 0;
  _purgeRanThisBoot = true;
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const targets = allKeys.filter(
      (k) =>
        k.startsWith('@metaCache:') ||
        k.startsWith('@streamsCache:') ||
        k.startsWith('@discoverCache:') ||
        k.startsWith('discover_data')
    );
    if (targets.length === 0) {
      console.log('[V268_PURGE] no bloat keys');
      return 0;
    }
    // Batch multiRemove (SQLite-friendly).
    for (let i = 0; i < targets.length; i += 200) {
      try {
        await AsyncStorage.multiRemove(targets.slice(i, i + 200));
      } catch (_) {}
    }
    console.log('[V268_PURGE] removed', targets.length, 'bloat keys');
    return targets.length;
  } catch (e) {
    console.warn('[V268_PURGE] error:', e);
    return 0;
  }
}

// Best-effort persist with read-back verification + purge-and-retry.
// Never throws.
async function safeAuthSet(key: string, value: string): Promise<boolean> {
  // Attempt 1 — direct (swallowed setItem returns undefined on disk full).
  try {
    await AsyncStorage.setItem(key, value);
  } catch (_) {}
  try {
    const v = await AsyncStorage.getItem(key);
    if (v === value) return true;
  } catch (_) {}

  // Attempt 2 — force-purge bloat, then retry.
  console.warn(
    '[V268_AUTH] first persist failed for',
    key,
    '— purging bloat and retrying'
  );
  await _purgeCacheBloat(true);
  try {
    await AsyncStorage.setItem(key, value);
  } catch (_) {}
  try {
    const v = await AsyncStorage.getItem(key);
    if (v === value) {
      console.log('[V268_AUTH] persist OK after purge for', key);
      return true;
    }
  } catch (_) {}

  console.warn(
    '[V268_AUTH] persist FAILED permanently for',
    key,
    '— session-only login.'
  );
  return false;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string
  ) => Promise<void>;
  logout: () => Promise<void>;
  loadStoredAuth: () => Promise<void>;
  clearAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isLoading: true,
  isAuthenticated: false,

  login: async (username: string, password: string) => {
    // Network call first — credential errors throw BEFORE we touch disk.
    const response: AuthResponse = await api.auth.login(username, password);

    // V268: in-memory state set IMMEDIATELY so the user is logged in
    // for this session regardless of disk state.
    set({
      user: response.user,
      token: response.token,
      isAuthenticated: true,
    });

    // Best-effort persistence — does not throw, does not block UI.
    const ok1 = await safeAuthSet('auth_token', response.token);
    const ok2 = await safeAuthSet('user', JSON.stringify(response.user));
    if (!ok1 || !ok2) {
      console.warn(
        '[V268_AUTH] persistence partial — token may not survive app restart.'
      );
    }
  },

  register: async (username: string, email: string, password: string) => {
    const response: AuthResponse = await api.auth.register(
      username,
      email,
      password
    );
    set({
      user: response.user,
      token: response.token,
      isAuthenticated: true,
    });
    await safeAuthSet('auth_token', response.token);
    await safeAuthSet('user', JSON.stringify(response.user));
  },

  logout: async () => {
    try {
      await AsyncStorage.removeItem('auth_token');
    } catch (_) {}
    try {
      await AsyncStorage.removeItem('user');
    } catch (_) {}
    set({
      user: null,
      token: null,
      isAuthenticated: false,
    });
  },

  clearAuth: async () => {
    try {
      await AsyncStorage.removeItem('auth_token');
    } catch (_) {}
    try {
      await AsyncStorage.removeItem('user');
    } catch (_) {}
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
    });
  },

  loadStoredAuth: async () => {
    try {
      // V268: opportunistic purge BEFORE the read so the SQLite file is
      // in a healthy state and any later setItem from the rest of the
      // app has room to succeed.
      await _purgeCacheBloat();
      const token = await AsyncStorage.getItem('auth_token');
      const userStr = await AsyncStorage.getItem('user');

      if (token && userStr) {
        const user = JSON.parse(userStr);
        set({
          user,
          token,
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      console.log('[AUTH] Error loading stored auth:', error);
      set({ isLoading: false });
    }
  },
}));
