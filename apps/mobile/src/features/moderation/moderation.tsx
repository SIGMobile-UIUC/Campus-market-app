import { useEffect, useState } from "react";
import { Alert, Linking, Text, View } from "react-native";

import { errorMessage } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { Menu } from "@/ui/Menu";
import { TextLink } from "@/ui/TextLink";
import { toast } from "@/ui/Toast";

// The published contact address (SAF-8, Apple 1.2) until appeals ship.
const CONTACT_EMAIL = "campusmarketsupports@gmail.com";

export function ContactLink() {
  return (
    <TextLink
      label={`Contact ${CONTACT_EMAIL}`}
      onPress={() => void Linking.openURL(`mailto:${CONTACT_EMAIL}`)}
    />
  );
}

export type ReportTarget = { type: "listing" | "user" | "message"; ref: string; label: string };

let reasons: { id: string; label: string }[] | null = null;

// Report and the reasons it offers (SAF-1, app_config.report_reasons): pick a reason, and the report
// goes to the campus queue.
export function ReportMenu({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const [list, setList] = useState(reasons);

  useEffect(() => {
    if (reasons) return;
    void supabase
      .from("app_config")
      .select("value")
      .eq("key", "report_reasons")
      .single()
      .then(({ data }) => {
        reasons = data?.value ?? null;
        setList(reasons);
      });
  }, []);

  const send = async (reason: string) => {
    if (!target) return;
    const { error } = await supabase.rpc("report", {
      p_target_type: target.type,
      p_target_ref: target.ref,
      p_reason: reason,
    });
    if (error) {
      Alert.alert(
        "Couldn't send your report",
        errorMessage(error, {
          ALREADY_EXISTS: "You already reported this.",
          RATE_LIMITED: "You've sent a lot of reports today. Try again tomorrow.",
          NOT_FOUND: "This isn't available anymore.",
        }),
      );
      return;
    }
    toast("Thanks. We review reports within 24 hours.");
  };

  return (
    <Menu
      visible={!!target}
      title={target ? `Report ${target.label}. They won't know who reported.` : undefined}
      options={(list ?? []).map((r) => ({ label: r.label, onPress: () => void send(r.id) }))}
      onClose={onClose}
    />
  );
}

// SAF-3: blocking hides each other's listings and stops messages both ways; the other side isn't told.
export function confirmBlock(userId: string, name: string, onBlocked: () => void) {
  Alert.alert(
    `Block ${name}?`,
    "You won't see each other's listings or be able to message each other. They won't be told.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block",
        style: "destructive",
        onPress: () =>
          void supabase.rpc("block_user", { p_user_id: userId }).then(({ error }) => {
            if (error) return Alert.alert("Couldn't block", errorMessage(error));
            toast(`${name} is blocked`);
            onBlocked();
          }),
      },
    ],
  );
}

export type Penalty = { id: string; reason: string; points: number; expires_at: string };

const PENALTY_REASONS: Record<string, string> = {
  no_show: "No-show",
  harassment: "Harassment or abuse",
  late_cancel: "Late cancellation",
  bad_faith: "Claim made in bad faith",
};

// The caller's penalties that still count (REP-3), soonest to expire first.
export async function fetchPenalties(): Promise<Penalty[]> {
  const { data } = await supabase
    .from("penalties")
    .select("id, reason, points, expires_at")
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("expires_at");
  return data ?? [];
}

export function PenaltyList({ penalties }: { penalties: Penalty[] }) {
  if (!penalties.length) return <Text className="text-[15px] text-muted">None</Text>;
  return (
    <View>
      {penalties.map((p) => (
        <View key={p.id} className="flex-row justify-between border-b border-line py-2">
          <Text className="text-[15px] text-ink">{PENALTY_REASONS[p.reason] ?? p.reason}</Text>
          <Text className="text-[13px] text-muted">
            {p.points} pts until {formatDate(p.expires_at)}
          </Text>
        </View>
      ))}
    </View>
  );
}
