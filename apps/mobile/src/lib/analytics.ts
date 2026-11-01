import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { AppState, Platform } from "react-native";

import { supabase } from "./supabase";

// Behavior events (APP-15, spec 4.17.4): only with analytics consent, queued in memory and in a file so a
// closed app keeps them, and sent to log_events every 30 seconds, when the app goes to the background,
// or at 50. Each event has its id from creation, so a resend is stored once.

type Event = {
  event_id: string;
  name: string;
  occurred_at: string;
  session_id: string;
  screen: string | null;
  props: Record<string, unknown>;
  context: Record<string, unknown>;
};

const SESSION_GAP_MS = 30 * 60_000;
const BATCH = 50;
const file = new File(Paths.document, "analytics-queue.json");
const context = {
  app_version: Constants.expoConfig?.version ?? null,
  platform: Platform.OS,
  os_version: String(Platform.Version),
};

let enabled = false;
let queue: Event[] = [];
let sessionId = randomUUID();
let screen: string | null = null;
let backgroundAt: number | null = null;
let sending = false;

function save() {
  try {
    file.write(JSON.stringify(queue));
  } catch {
    // A lost queue only loses analytics.
  }
}

async function flush() {
  if (!enabled || sending || !queue.length) return;
  sending = true;
  const batch = queue.slice(0, BATCH);
  const { error } = await supabase.rpc("log_events", { p_events: batch });
  sending = false;
  // Sent, or refused for good (no consent, a malformed batch): drop it. Network errors and the hourly
  // limit keep it for the next flush.
  if (!error || error.message === "FORBIDDEN" || error.message === "VALIDATION_FAILED") {
    queue = queue.slice(batch.length);
    save();
  }
}

export function track(name: string, props: Record<string, unknown> = {}) {
  if (!enabled) return;
  queue.push({
    event_id: randomUUID(),
    name,
    occurred_at: new Date().toISOString(),
    session_id: sessionId,
    screen,
    props,
    context,
  });
  save();
  if (queue.length >= BATCH) void flush();
}

// The screen events are attributed to; screen_view records the move (spec 4.17.5).
export function trackScreen(next: string) {
  if (next === screen) return;
  const previous = screen;
  screen = next;
  track("screen_view", { screen: next, previous_screen: previous });
}

// On with analytics consent, off without it or when signed out (the queue goes with it).
export function setAnalytics(on: boolean) {
  if (on === enabled) return;
  enabled = on;
  if (!on) {
    queue = [];
    save();
    return;
  }
  try {
    queue = file.exists ? (JSON.parse(file.textSync()) as Event[]) : [];
  } catch {
    queue = [];
  }
  track("session_start", { source: "direct" });
}

// Prices in coarse buckets, so events never repeat an amount a record holds (4.17.3).
export const priceBucket = (cents: number) =>
  cents === 0
    ? "free"
    : cents < 1000
      ? "under_10"
      : cents < 2500
        ? "10_25"
        : cents < 5000
          ? "25_50"
          : cents < 10000
            ? "50_100"
            : "100_plus";

setInterval(() => void flush(), 30_000);

// A return after 30 minutes in the background starts a new session.
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    if (backgroundAt && Date.now() - backgroundAt > SESSION_GAP_MS) {
      sessionId = randomUUID();
      track("session_start", { source: "direct" });
    }
    backgroundAt = null;
  } else if (state === "background") {
    backgroundAt = Date.now();
    void flush();
  }
});
