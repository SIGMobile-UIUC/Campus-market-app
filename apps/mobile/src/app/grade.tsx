import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { useAccount } from "@/features/account/account";
import { fetchPenalties, PenaltyList, type Penalty } from "@/features/moderation/moderation";
import { nextTier } from "@/features/points/points";
import { supabase } from "@/lib/supabase";
import { GRADE_LETTERS, GradeBadge } from "@/ui/GradeBadge";
import { Header } from "@/ui/Header";
import { ProgressBar } from "@/ui/ProgressBar";

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
      fetchPenalties(),
    ]).then(([rank, active]) => {
      setProgress(rank.data?.next_tier_progress ?? 0);
      setPenalties(active);
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
        <PenaltyList penalties={penalties} />
      </View>
    </ScrollView>
  );
}
