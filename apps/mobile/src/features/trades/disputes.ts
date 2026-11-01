import { supabase } from "@/lib/supabase";

import type { Trade } from "./api";

export type Dispute = {
  id: string;
  opened_by: string;
  against_id: string;
  status: "awaiting_response" | "under_review" | "upheld" | "rejected" | "withdrawn" | "overturned";
  statement: string;
  opened_at: string;
  response_due_at: string;
  resolution_note: string | null;
  bad_faith: boolean;
};
export type Evidence = {
  id: string;
  dispute_id: string;
  user_id: string;
  kind: "photo" | "statement";
  photo_path: string | null;
  body: string | null;
};

// The trade's no-show claims both ways and their evidence (DSP-1, DSP-5); the parties read both.
export async function fetchDisputes(tradeId: string) {
  const disputes = await supabase
    .from("disputes")
    .select(
      "id, opened_by, against_id, status, statement, opened_at, response_due_at, resolution_note, bad_faith",
    )
    .eq("trade_id", tradeId)
    .order("opened_at");
  if (disputes.error) return null;
  const evidence = await supabase
    .from("dispute_evidence")
    .select("id, dispute_id, user_id, kind, photo_path, body")
    .in(
      "dispute_id",
      disputes.data.map((d) => d.id),
    )
    .order("created_at");
  if (evidence.error) return null;
  return { disputes: disputes.data as Dispute[], evidence: evidence.data as Evidence[] };
}

// No-show claims open 15 minutes after the meetup and close 48 hours after it (DSP-1).
export const canClaimNow = (trade: Trade, now = Date.now()) => {
  const meet = new Date(trade.meet_at).getTime();
  return (
    (trade.status === "accepted" || trade.status === "disputed") &&
    now >= meet + 15 * 60_000 &&
    now <= meet + 48 * 3600_000
  );
};

// "Response due in 31h", or that the window has closed.
export function responseDue(iso: string, now = Date.now()) {
  const hours = Math.ceil((new Date(iso).getTime() - now) / 3600_000);
  return hours > 0 ? `Response due in ${hours}h` : "The response window has closed";
}

export const DISPUTE_STATUS: Record<Dispute["status"], string> = {
  awaiting_response: "Waiting for a response",
  under_review: "An admin is reviewing it",
  upheld: "Upheld",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  overturned: "Overturned on appeal",
};

export const DISPUTE_MESSAGES = {
  WINDOW_CLOSED: "No-show reports open 15 minutes after the meetup and close 48 hours after it.",
  ALREADY_EXISTS: "You already reported this trade.",
  FORBIDDEN: "Only the other side can respond.",
  INVALID_STATE: "This claim already moved on.",
};
