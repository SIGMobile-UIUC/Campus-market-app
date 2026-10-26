import { Alert } from "react-native";

import { errorMessage } from "@/lib/errors";
import { supabase } from "@/lib/supabase";

// Trade calls and shapes (spec 4.10, 6.6).

export type TradeStatus =
  | "proposed"
  | "accepted"
  | "disputed"
  | "completed"
  | "declined"
  | "withdrawn"
  | "cancelled"
  | "expired"
  | "failed";

export type Trade = {
  id: string;
  listing_id: string;
  chat_id: string;
  seller_id: string;
  buyer_id: string;
  proposed_by: string;
  status: TradeStatus;
  total_cents: number;
  meet_at: string;
  place_text: string | null;
  proposed_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  closed_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  items: { line: number; item_id: string | null; name: string; price_cents: number }[];
  trade_confirmations: { user_id: string }[];
  spot: { name: string } | null;
  listing: { title: string } | null;
  seller: { display_name: string | null; tier: string } | null;
  buyer: { display_name: string | null; tier: string } | null;
  // The caller's own review and the other side's review of them (reviews are visible to both parties).
  reviews: { reviewer_id: string }[];
};

const TRADE_SELECT = `id, listing_id, chat_id, seller_id, buyer_id, proposed_by, status, total_cents, meet_at,
  place_text, proposed_at, accepted_at, completed_at, closed_at, cancelled_by, cancel_reason,
  items:trade_items(line, item_id, name, price_cents), trade_confirmations(user_id), spot:meetup_spots(name),
  listing:listings!trades_listing_id_fkey(title), seller:profiles!trades_seller_id_fkey(display_name, tier),
  buyer:profiles!trades_buyer_id_fkey(display_name, tier), reviews(reviewer_id)`;
// Named foreign keys: trades also reach listings through items and profiles through confirmations.

export async function fetchTrades(ids: string[]): Promise<Trade[] | null> {
  const { data, error } = await supabase.from("trades").select(TRADE_SELECT).in("id", ids);
  return error ? null : (data as unknown as Trade[]);
}

export const STATUS_LABEL: Record<TradeStatus, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  disputed: "Problem reported",
  completed: "Completed",
  declined: "Declined",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
  expired: "Expired",
  failed: "Failed",
};

export const placeOf = (trade: Pick<Trade, "spot" | "place_text">) =>
  trade.spot?.name ?? trade.place_text ?? "Place not set";

// "Thu, Nov 6 · 5:30 PM"
export function formatMeet(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

// Completed opens 30 minutes before the meetup (6.6). Seven days after it, the trades job closes the trade.
export const canConfirmNow = (trade: Trade, now = Date.now()) =>
  now >= new Date(trade.meet_at).getTime() - 30 * 60_000;

// Reviews are open for 14 days after completion (REP-1).
export const canReviewNow = (trade: Trade, now = Date.now()) =>
  !!trade.completed_at && now <= new Date(trade.completed_at).getTime() + 14 * 86_400_000;

// Cancelling within 2 hours of the meetup is a late cancel (TRD-6).
export const isLateCancel = (trade: Trade, now = Date.now()) =>
  now > new Date(trade.meet_at).getTime() - 2 * 3600_000;

const MESSAGES = {
  ITEM_UNAVAILABLE: "Some of these items were just reserved or sold.",
  INVALID_STATE: "This trade already changed. It shows the latest state now.",
  WINDOW_CLOSED: "You can mark it completed from 30 minutes before the meetup.",
  FORBIDDEN: "Only the person who proposed can withdraw.",
};

// Runs a trade action and reports a refusal; resolves with the result, or null when it failed.
export async function tradeAction<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    Alert.alert("Couldn't update the trade", errorMessage(error, MESSAGES));
    return null;
  }
  return data as T;
}

export function proposeTrade(chatId: string, proposal: Record<string, unknown>, requestId: string) {
  return tradeAction<Trade>("propose_trade", {
    p_chat_id: chatId,
    p_proposal: proposal,
    p_request_id: requestId,
  });
}

export const CANCEL_REASONS = [
  "Plans changed",
  "Can't make the meetup time",
  "Item is no longer available",
  "Something else",
];
