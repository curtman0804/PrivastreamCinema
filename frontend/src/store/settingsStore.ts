import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface SettingsState {
  // TorrServer URL (e.g., "http://192.168.1.100:8090")
  torrServerUrl: string;
  // Whether to use the external server for streaming
  useExternalServer: boolean;
  // Loading state
  isLoading: boolean;
  // Actions
  setTorrServerUrl: (url: string) => Promise<void>;
  setUseExternalServer: (use: boolean) => Promise<void>;
  loadSettings: () => Promise<void>;
  clearTorrServerUrl: () => Promise<void>;
  testConnection: () => Promise<{ success: boolean; message: string }>;
}

const SETTINGS_KEY = '@privastream_settings';

export const useSettingsStore = create<SettingsState>((set, get) => ({
  torrServerUrl: '',
  useExternalServer: false,
  isLoading: false,

  loadSettings: async () => {
    try {
      const data = await AsyncStorage.getItem(SETTINGS_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        set({
          torrServerUrl: parsed.torrServerUrl || '',
          useExternalServer: parsed.useExternalServer || false,
        });
      }
    } catch (e) {
      console.log('[SETTINGS] Failed to load settings:', e);
    }
  },

  setTorrServerUrl: async (url: string) => {
    // Clean up URL - remove trailing slash
    const cleanUrl = url.replace(/\/+$/, '').trim();
    set({ torrServerUrl: cleanUrl });
    try {
      const state = get();
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({
        torrServerUrl: cleanUrl,
        useExternalServer: state.useExternalServer,
      }));
    } catch (e) {
      console.log('[SETTINGS] Failed to save settings:', e);
    }
  },

  setUseExternalServer: async (use: boolean) => {
    set({ useExternalServer: use });
    try {
      const state = get();
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({
        torrServerUrl: state.torrServerUrl,
        useExternalServer: use,
      }));
    } catch (e) {
      console.log('[SETTINGS] Failed to save settings:', e);
    }
  },

  clearTorrServerUrl: async () => {
    set({ torrServerUrl: '', useExternalServer: false });
    try {
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({
        torrServerUrl: '',
        useExternalServer: false,
      }));
    } catch (e) {
      console.log('[SETTINGS] Failed to clear settings:', e);
    }
  },

  testConnection: async () => {
    const { torrServerUrl } = get();
    if (!torrServerUrl) {
      return { success: false, message: 'No server URL configured' };
    }
    set({ isLoading: true });
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      // Try TorrServer echo endpoint
      const response = await fetch(`${torrServerUrl}/echo`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      
      if (response.ok) {
        const text = await response.text();
        set({ isLoading: false });
        return { success: true, message: `Connected! Server: ${text.substring(0, 50)}` };
      }
      
      // Try alternative health check
      const response2 = await fetch(`${torrServerUrl}/`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      
      if (response2.ok) {
        set({ isLoading: false });
        return { success: true, message: 'Connected to server!' };
      }
      
      set({ isLoading: false });
      return { success: false, message: `Server returned status ${response.status}` };
    } catch (e: any) {
      set({ isLoading: false });
      if (e.name === 'AbortError') {
        return { success: false, message: 'Connection timed out (5s)' };
      }
      return { success: false, message: `Connection failed: ${e.message}` };
    }
  },
}));
