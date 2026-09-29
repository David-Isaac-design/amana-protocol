import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

interface AuthState {
  token: string | null;
  walletAddress: string | null;
  /** True when the authenticated user has the admin role. */
  isAdmin: boolean;
  isLoading: boolean;
  setToken: (token: string) => Promise<void>;
  setWalletAddress: (address: string) => void;
  setIsAdmin: (isAdmin: boolean) => void;
  getToken: () => Promise<string | null>;
  clearAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  walletAddress: null,
  isAdmin: false,
  isLoading: true,

  setToken: async (token: string) => {
    await SecureStore.setItemAsync('amana_token', token);
    set({ token });
  },

  setWalletAddress: (address: string) => {
    set({ walletAddress: address });
  },

  setIsAdmin: (isAdmin: boolean) => {
    set({ isAdmin });
  },

  getToken: async () => {
    try {
      const token = await SecureStore.getItemAsync('amana_token');
      set({ token });
      return token;
    } catch (error) {
      console.error('Failed to retrieve token:', error);
      return null;
    }
  },

  clearAuth: async () => {
    await SecureStore.deleteItemAsync('amana_token');
    set({ token: null, walletAddress: null, isAdmin: false });
  },
}));
