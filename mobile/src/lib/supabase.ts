import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) =>
    SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

const webStorage = {
  getItem: async (key: string) =>
    typeof localStorage === 'undefined' ? null : localStorage.getItem(key),
  setItem: async (key: string, value: string) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  },
};

export const supabase = createClient(
  url ?? 'https://example.supabase.co',
  anonKey ?? 'missing-anon-key',
  {
    auth: {
      storage: process.env.EXPO_OS === 'web' ? webStorage : secureStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);
