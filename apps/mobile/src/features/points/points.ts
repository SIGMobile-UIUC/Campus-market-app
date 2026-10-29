import { supabase } from "@/lib/supabase";
import { GRADE_LETTERS } from "@/ui/GradeBadge";

// get_wallet (spec 6.8).
export type Wallet = { balance: number; earned_today: number; daily_cap: number };
// The caller's own rank_stats row; none until the first recompute after a trade or review.
export type Rank = {
  counted_trades: number;
  reviews_count: number;
  rating_bayes: number;
  next_tier_progress: number;
};
export type MeStats = {
  wallet: Wallet;
  rank: Rank | null;
  timezone: string;
  lastCheckin: { local_date: string; streak: number } | null;
};

// The Me tab's numbers: wallet, grade inputs, and the latest check-in with the time zone it counts in.
export async function fetchMeStats(userId: string): Promise<MeStats | null> {
  const [wallet, rank, profile, checkin] = await Promise.all([
    supabase.rpc("get_wallet"),
    supabase
      .from("rank_stats")
      .select("counted_trades, reviews_count, rating_bayes, next_tier_progress")
      .maybeSingle(),
    supabase.from("profiles").select("timezone").eq("id", userId).single(),
    supabase
      .from("checkins")
      .select("local_date, streak")
      .order("local_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (wallet.error || rank.error || profile.error || checkin.error) return null;
  return {
    wallet: wallet.data as Wallet,
    rank: rank.data,
    timezone: profile.data.timezone,
    lastCheckin: checkin.data,
  };
}

// A date in the profile's time zone as YYYY-MM-DD, like check_in counts days.
export function localDate(timeZone: string, daysAgo = 0, now = new Date()) {
  const [month, day, year] = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .split("/");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) - daysAgo));
  return date.toISOString().slice(0, 10);
}

// Today's state of the daily check-in (PTS-7): done today, and the streak it continues or holds.
export function checkinState(stats: Pick<MeStats, "timezone" | "lastCheckin">, now = new Date()) {
  const last = stats.lastCheckin;
  const done = last?.local_date === localDate(stats.timezone, 0, now);
  const continues = done || last?.local_date === localDate(stats.timezone, 1, now);
  return { done, streak: continues && last ? last.streak : 0 };
}

const TIERS = Object.keys(GRADE_LETTERS);

export const nextTier = (tier: string): string | null => TIERS[TIERS.indexOf(tier) + 1] ?? null;
export const tierAtLeast = (tier: string, min: string) => TIERS.indexOf(tier) >= TIERS.indexOf(min);
