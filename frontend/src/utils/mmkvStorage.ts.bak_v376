/* mmkvStorage.ts — V346 EMERGENCY FALLBACK
 * MMKV path failed on this RN version. This shim keeps all V344 codemod'd
 * imports (14 files) resolving to the AsyncStorage-compatible API without
 * requiring the react-native-mmkv native module. Everything continues to
 * work exactly like it did BEFORE the MMKV migration.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export default AsyncStorage;
export { AsyncStorage };
export const rawMMKV = { get() { return null; } };