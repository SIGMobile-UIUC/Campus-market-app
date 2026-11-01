import { supabase } from "@/lib/supabase";

// One admin_queue entry (spec 6.10): open reports grouped by target, or a dispute under review.
export type Case = {
  case_id: string;
  case_type: "report" | "dispute";
  target_type: "listing" | "user" | "message" | "trade";
  target_ref: string;
  target_user_id: string;
  target_user_name: string | null;
  opened_at: string;
  age_hours: number;
  reports: number;
  reasons: string[];
  listing: { title: string; status: string; hidden: boolean; hidden_reason: string | null } | null;
};

// The queue the case view reads from, so opening a case is not a second logged queue call.
let latest: Case[] = [];
export const cachedCase = (id: string) => latest.find((c) => c.case_id === id) ?? null;

export async function fetchQueue(): Promise<Case[] | null> {
  const { data, error } = await supabase.rpc("admin_queue");
  if (error) return null;
  latest = data as Case[];
  return latest;
}

export function caseTitle(c: Case) {
  const who = c.target_user_name ?? "Deleted user";
  switch (c.target_type) {
    case "listing":
      return `Listing: ${c.listing?.title ?? "removed"}${c.listing?.hidden ? " (hidden)" : ""}`;
    case "message":
      return `Message from ${who}`;
    case "trade":
      return `No-show claim against ${who}`;
    default:
      return `User: ${who}`;
  }
}

export const ADMIN_MESSAGES = {
  FORBIDDEN: "Only a super admin can do this.",
  INVALID_STATE: "Someone already resolved this case.",
};
