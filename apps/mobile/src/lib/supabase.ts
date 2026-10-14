import { createClient } from "@supabase/supabase-js";
import { AppState } from "react-native";

import { secureStorage } from "./secureStorage";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;
if (!url || !key) {
  throw new Error("Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY in apps/mobile/.env.local");
}

// fetch never times out on its own, so an unreachable server would leave screens waiting forever.
const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  return fetch(input, { ...init, signal: init?.signal ?? controller.signal }).finally(() =>
    clearTimeout(timer),
  );
};

export const supabase = createClient(url, key, {
  global: { fetch: fetchWithTimeout },
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh tokens only while the app is in the foreground, including right after launch.
const followAppState = (state: string) =>
  state === "active" ? supabase.auth.startAutoRefresh() : supabase.auth.stopAutoRefresh();
followAppState(AppState.currentState);
AppState.addEventListener("change", followAppState);
