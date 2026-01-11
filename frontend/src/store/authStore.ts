import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, User, AuthResponse } from '../api/client';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
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
    const response: AuthResponse = await api.auth.login(username, password);
    await AsyncStorage.setItem('auth_token', response.token);
    await AsyncStorage.setItem('user', JSON.stringify(response.user));
    set({
      user: response.user,
      token: response.token,
      isAuthenticated: true,
    });
  },

  register: async (username: string, email: string, password: string) => {
    const response: AuthResponse = await api.auth.register(username, email, password);
    await AsyncStorage.setItem('auth_token', response.token);
    await AsyncStorage.setItem('user', JSON.stringify(response.user));
    set({
      user: response.user,
      token: response.token,
      isAuthenticated: true,
    });
  },

  logout: async () => {
    await AsyncStorage.removeItem('auth_token');
    await AsyncStorage.removeItem('user');
    set({
      user: null,
      token: null,
      isAuthenticated: false,
    });
  },

  clearAuth: async () => {
    await AsyncStorage.removeItem('auth_token');
    await AsyncStorage.removeItem('user');
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
    });
  },

  loadStoredAuth: async () => {
    try {
      const token = await AsyncStorage.getItem('auth_token');
      const userStr = await AsyncStorage.getItem('user');
      
      if (token && userStr) {
        // Validate the token by making a test API call
        try {
          // Try to fetch addons - this requires authentication
          const response = await api.addons.getAll();
          // If we get here, the token is valid
          const user = JSON.parse(userStr);
          set({
            user,
            token,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error: any) {
          // Token is invalid or expired - clear everything
          console.log('[AUTH] Stored token is invalid, clearing auth');
          await AsyncStorage.removeItem('auth_token');
          await AsyncStorage.removeItem('user');
          set({
            user: null,
            token: null,
            isAuthenticated: false,
            isLoading: false,
          });
        }
      } else {
        // No stored auth
        set({ isLoading: false });
      }
    } catch (error) {
      console.log('[AUTH] Error loading stored auth:', error);
      set({ isLoading: false });
    }
  },
}));
