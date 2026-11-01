import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { useAccount } from "@/features/account/account";
import {
  ContactLink,
  fetchPenalties,
  PenaltyList,
  shortDate,
  type Penalty,
} from "@/features/moderation/moderation";
import { supabase } from "@/lib/supabase";
import { Header } from "@/ui/Header";

type Action = {
  id: string;
  kind: "warning" | "content_removal" | "restriction" | "suspension" | "ban";
  reason_code: string;
  policy_ref: string;
  ends_at: string | null;
  created_at: string;
};

const KINDS: Record<Action["kind"], string> = {
  warning: "Warning",
  content_removal: "Content removed",
  restriction: "Feature restricted",
  suspension: "Suspension",
  ban: "Account banned",
};

const REASONS: Record<string, string> = {
  scam: "Scam or fraud",
  prohibited_item: "Prohibited item",
  harassment: "Harassment or threats",
  inappropriate: "Inappropriate content",
  spam: "Spam or misleading",
  no_show: "Repeated no-shows",
};

// Account status (ACC-7, spec 2.10): enforcement actions with reasons and end dates, penalties with
// expiry dates, and the contact address (appeals are P1). Suspended and banned users read it too.
export default function AccountStatus() {
  const { account } = useAccount();
  const [actions, setActions] = useState<Action[] | null>(null);
  const [penalties, setPenalties] = useState<Penalty[]>([]);

  useEffect(() => {
    void Promise.all([
      supabase
        .from("enforcement_actions")
        .select("id, kind, reason_code, policy_ref, ends_at, created_at")
        .order("created_at", { ascending: false }),
      fetchPenalties(),
    ]).then(([enforcement, active]) => {
      setActions((enforcement.data as Action[] | null) ?? []);
      setPenalties(active);
    });
  }, []);

  const standing =
    account?.status === "banned"
      ? "Your account is banned."
      : account?.status === "suspended"
        ? "Your account is suspended. You can read but not post, chat or trade."
        : "Your account is in good standing.";

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerStyle={{ padding: 20, gap: 24 }}>
      <Header title="Account status" />
      <Text
        className={`text-[15px] font-bold ${account?.status === "active" ? "text-success" : "text-danger"}`}
      >
        {standing}
      </Text>
      <View className="gap-2">
        <Text className="text-[15px] font-bold text-ink">Actions on your account</Text>
        {actions?.length ? (
          actions.map((a) => (
            <View key={a.id} className="gap-0.5 border-b border-line py-2">
              <Text className="text-[15px] text-ink">
                {KINDS[a.kind]} · {REASONS[a.reason_code] ?? a.reason_code}
              </Text>
              <Text className="text-[13px] text-muted">
                {shortDate(a.created_at)}
                {a.ends_at ? ` – ${shortDate(a.ends_at)}` : ""} · Rules section {a.policy_ref}
              </Text>
            </View>
          ))
        ) : (
          <Text className="text-[15px] text-muted">{actions ? "None" : "Loading…"}</Text>
        )}
      </View>
      <View className="gap-2">
        <Text className="text-[15px] font-bold text-ink">Penalties</Text>
        <PenaltyList penalties={penalties} />
        <Text className="text-[13px] text-muted">Each penalty lowers your grade until it expires.</Text>
      </View>
      <View className="items-center gap-1">
        <Text className="text-[13px] text-muted">Think we got something wrong?</Text>
        <ContactLink />
      </View>
    </ScrollView>
  );
}
