import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'innov8_token';
const LEGACY_TOKEN_KEY = 'amana_token';

/** Reads the token, migrating it from the legacy key so sessions survive the rename. */
export async function readTokenWithMigration(): Promise<string | null> {
  const current = await SecureStore.getItemAsync(TOKEN_KEY);
  if (current) return current;
  const legacy = await SecureStore.getItemAsync(LEGACY_TOKEN_KEY);
  if (!legacy) return null;
  await SecureStore.setItemAsync(TOKEN_KEY, legacy);
  await SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY);
  return legacy;
}

interface AuthState {
  token: string | null;
  walletAddress: string | null;
  isLoading: boolean;
  setToken: (token: string) => Promise<void>;
  setWalletAddress: (address: string) => void;
  getToken: () => Promise<string | null>;
  clearAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  walletAddress: null,
  isLoading: true,

  setToken: async (token: string) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    set({ token });
  },

  setWalletAddress: (address: string) => {
    set({ walletAddress: address });
  },

  getToken: async () => {
    try {
      const token = await readTokenWithMigration();
      set({ token });
      return token;
    } catch (error) {
      console.error('Failed to retrieve token:', error);
      return null;
    }
  },

  clearAuth: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY);
    set({ token: null, walletAddress: null });
  },
}));
