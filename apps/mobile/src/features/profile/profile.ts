import { supabase } from "@/lib/supabase";

import type { Loadout } from "../avatar/Avatar";

// public_profile (ACC-4): what anyone signed in sees of another account.
export type PublicProfile = {
  id: string;
  display_name: string;
  tier: string;
  member_since: string;
  campus: { short_name: string | null; name: string } | null;
  trades: number;
  reply_minutes: number | null;
  avatar: Loadout;
  tags: Record<string, number>;
};

export async function fetchProfile(userId: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase.rpc("public_profile", { p_user_id: userId });
  return error ? null : (data as PublicProfile);
}

// "Usually replies within an hour"; nothing until there are enough chats to tell.
export function replyLabel(minutes: number | null) {
  if (minutes === null) return null;
  if (minutes <= 60) return "Usually replies within an hour";
  if (minutes <= 360) return "Usually replies within a few hours";
  if (minutes <= 1440) return "Usually replies within a day";
  return "Usually replies in a few days";
}

export const tradesLabel = (n: number) => `${n} ${n === 1 ? "trade" : "trades"}`;
