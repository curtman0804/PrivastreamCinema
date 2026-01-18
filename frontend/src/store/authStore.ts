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
    
    // Save to storage first
    await AsyncStorage.setItem('auth_token', response.token);
    await AsyncStorage.setItem('user', JSON.stringify(response.user));
    
    // Then update state - this must happen after storage is complete
    set({
      user: response.user,
      token: response.token,
      isAuthenticated: true,
      isLoading: false,
    });
    
    // Return the response for any callers that need it
    return;
  },

  register: async (username: string, email: string, password: string) => {
    const response: AuthResponse = await api.auth.register(username, email, password);
    await AsyncStorage.setItem('auth_token', response.token);
    await AsyncStorage.setItem('user', JSON.stringify(response.user));
    set({
      user: response.user,
      token: response.token,
      isAuthenticated: true,
      isLoading: false,
    });
  },

  logout: async () => {
    // Clear storage first
    await AsyncStorage.multiRemove(['auth_token', 'user']);
    
    // Then update state
    set({
      user: null,
      token: null,
      isAuthenticated: false,
    });
  },

  clearAuth: async () => {
    await AsyncStorage.multiRemove(['auth_token', 'user']);
    set({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
    });
  },

  loadStoredAuth: async () => {
    try {
      const [token, userStr] = await AsyncStorage.multiGet(['auth_token', 'user']);
      
      if (token[1] && userStr[1]) {
        const user = JSON.parse(userStr[1]);
        set({
          user,
          token: token[1],
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        set({ isLoading: false, isAuthenticated: false });
      }
    } catch (error) {
      console.log('[AUTH] Error loading stored auth:', error);
      set({ isLoading: false, isAuthenticated: false });
    }
  },
}));