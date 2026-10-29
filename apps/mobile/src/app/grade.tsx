import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { useAccount } from "@/features/account/account";
import { nextTier } from "@/features/points/points";
import { supabase } from "@/lib/supabase";
import { GRADE_LETTERS, GradeBadge } from "@/ui/GradeBadge";
import { Header } from "@/ui/Header";
import { ProgressBar } from "@/ui/ProgressBar";

type Penalty = { id: string; reason: string; points: number; expires_at: string };

const REASONS: Record<string, string> = {
  no_show: "No-show",
  harassment: "Harassment or abuse",
  late_cancel: "Late cancellation",
  bad_faith: "Claim made in bad faith",
};

const TIPS = [
  "Complete trades and earn good reviews.",
  "Rude replies and late cancellations lower your grade.",
  "No-shows lower it further.",
];

// Trust grade detail (spec 3.3, 3.8): the ladder, progress to the next grade, general tips and active
// penalties. The formula and thresholds stay internal (ADR-021).
export default function Grade() {
  const { account } = useAccount();
  const [progress, setProgress] = useState(0);
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const tier = account?.tier ?? "b";
  const next = nextTier(tier);

  useEffect(() => {
    void Promise.all([
      supabase.from("rank_stats").select("next_tier_progress").maybeSingle(),
      supabase
        .from("penalties")
        .select("id, reason, points, expires_at")
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("expires_at"),
    ]).then(([rank, active]) => {
      setProgress(rank.data?.next_tier_progress ?? 0);
      setPenalties(active.data ?? []);
    });
  }, []);

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerStyle={{ padding: 20, gap: 24 }}>
      <Header title="Trust grade" />
      <View className="flex-row justify-between">
        {Object.keys(GRADE_LETTERS).map((t) => (
          <View key={t} className={`rounded-lg p-1 ${t === tier ? "border-2 border-ink" : ""}`}>
            <GradeBadge tier={t} />
          </View>
        ))}
      </View>
      <View className="gap-2">
        <Text className="text-[15px] font-bold text-ink">
          {next ? `On the way to ${GRADE_LETTERS[next]}` : "You have the top grade"}
        </Text>
        {next ? <ProgressBar value={progress} label={`Progress to ${GRADE_LETTERS[next]}`} /> : null}
      </View>
      <View className="gap-2">
        {TIPS.map((tip) => (
          <Text key={tip} className="text-[15px] text-ink">
            • {tip}
          </Text>
        ))}
      </View>
      <View className="gap-2">
        <Text className="text-[15px] font-bold text-ink">Active penalties</Text>
        {penalties.length ? (
          penalties.map((p) => (
            <View key={p.id} className="flex-row justify-between border-b border-line py-2">
              <Text className="text-[15px] text-ink">{REASONS[p.reason] ?? p.reason}</Text>
              <Text className="text-[13px] text-muted">
                {p.points} pts until{" "}
                {new Date(p.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </Text>
            </View>
          ))
        ) : (
          <Text className="text-[15px] text-muted">None</Text>
        )}
      </View>
    </ScrollView>
  );
}
