import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";

import { ADMIN_MESSAGES, cachedCase, caseTitle, type Case } from "@/features/moderation/admin";
import { errorMessage } from "@/lib/errors";
import { formatTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { Header } from "@/ui/Header";
import { Photo } from "@/ui/Photo";
import { toast } from "@/ui/Toast";
import { Toggle } from "@/ui/Toggle";

type ChatLine = {
  seq: number;
  sender_id: string | null;
  body: string | null;
  hidden: boolean;
  created_at: string;
};
type Evidence = {
  statement: string;
  opened_by: string;
  evidence: {
    id: string;
    user_id: string;
    kind: "photo" | "statement";
    photo_path: string | null;
    body: string | null;
  }[];
};

// Enforcement choices (spec 2.8); the server applies the authority limits.
const ACTIONS: { label: string; kind: string; days?: number }[] = [
  { label: "Warning", kind: "warning" },
  { label: "Content removed", kind: "content_removal" },
  { label: "Suspend 3 days", kind: "suspension", days: 3 },
  { label: "Suspend 7 days", kind: "suspension", days: 7 },
  { label: "Suspend 30 days", kind: "suspension", days: 30 },
  { label: "Ban", kind: "ban" },
];

async function call(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) Alert.alert("Couldn't do that", errorMessage(error, ADMIN_MESSAGES));
  return error ? null : data;
}

// Case view (spec 3.3): what was reported, the private data behind it (each view is logged), hiding,
// the decision and an enforcement action within the admin's authority.
export default function CaseView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [c] = useState<Case | null>(() => cachedCase(id));
  const [chat, setChat] = useState<{ reported_seq: number | null; messages: ChatLine[] } | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [hidden, setHidden] = useState(c?.listing?.hidden ?? false);
  const [harassment, setHarassment] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!c) {
    return (
      <>
        <Header title="Case" />
        <Text className="flex-1 bg-bg px-8 pt-16 text-center text-base text-muted">
          Open this case from the queue.
        </Text>
      </>
    );
  }

  const open = async (resource: "chat" | "evidence") => {
    const data = await call("admin_open_case_data", {
      p_case_type: c.case_type,
      p_case_id: c.case_id,
      p_resource: resource,
    });
    if (data && resource === "chat") setChat(data);
    if (data && resource === "evidence") setEvidence(data);
  };

  const decide = async (fn: string, args: Record<string, unknown>, done: string) => {
    setBusy(true);
    const ok = (await call(fn, args)) !== null;
    setBusy(false);
    if (!ok) return;
    toast(done);
    router.back();
  };

  const hide = async (next: boolean) => {
    const target = c.target_type === "listing" ? "listing" : "message";
    if (
      await call("admin_set_hidden", {
        p_target_type: target,
        p_target_ref: c.target_ref,
        p_hidden: next,
        p_reason: c.reasons[0],
      })
    ) {
      setHidden(next);
      if (chat) void open("chat");
      toast(next ? "Hidden" : "Restored");
    }
  };

  const enforce = (action: (typeof ACTIONS)[number]) =>
    Alert.alert(
      `${action.label} for ${c.target_user_name ?? "this user"}?`,
      "They'll see it on their account status page.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: action.label,
          style: "destructive",
          onPress: () =>
            void call("admin_enforce", {
              p_user_id: c.target_user_id,
              p_kind: action.kind,
              p_duration: action.days ? `${action.days} days` : null,
              p_reason_code: c.reasons[0],
              p_policy_ref: "2.8",
              p_case_type: c.case_type,
              p_case_id: c.case_id,
            }).then((data) => data && toast(`${action.label}: done`)),
        },
      ],
    );

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerStyle={{ padding: 20, gap: 20 }}>
      <Header title={c.case_type === "dispute" ? "Dispute" : "Report"} />
      <View className="gap-1">
        <Text className="text-lg font-extrabold text-ink">{caseTitle(c)}</Text>
        <Text className="text-[13px] text-muted">
          {c.case_type === "report"
            ? `${c.reports} ${c.reports === 1 ? "report" : "reports"} · ${c.reasons.join(", ")} · `
            : ""}
          open {Math.floor(c.age_hours)}h
        </Text>
      </View>

      {c.case_type === "dispute" ? (
        evidence ? (
          <View className="gap-3">
            <Text className="text-[15px] font-bold text-ink">Claim</Text>
            <Text className="text-[15px] text-ink">{evidence.statement}</Text>
            {evidence.evidence.map((e) =>
              e.kind === "photo" && e.photo_path ? (
                <Photo
                  key={e.id}
                  path={e.photo_path}
                  bucket="dispute-evidence"
                  style={{ width: 200, height: 200, borderRadius: 12 }}
                />
              ) : (
                <View key={e.id} className="gap-1">
                  <Text className="text-[15px] font-bold text-ink">
                    {e.user_id === evidence.opened_by ? "Claimant" : "Response"}
                  </Text>
                  <Text className="text-[15px] text-ink">{e.body}</Text>
                </View>
              ),
            )}
          </View>
        ) : (
          <Button variant="secondary" label="View evidence (logged)" onPress={() => void open("evidence")} />
        )
      ) : null}

      {c.target_type === "message" || c.case_type === "dispute" ? (
        chat ? (
          <View className="gap-1 rounded-2xl bg-surface p-3">
            {chat.messages.map((m) => (
              <Text
                key={m.seq}
                className={`text-[13px] ${m.seq === chat.reported_seq ? "font-bold text-danger" : "text-ink"}`}
              >
                {formatTime(m.created_at)} ·{" "}
                {m.sender_id === c.target_user_id ? c.target_user_name : "Other side"}: {m.body ?? "(photo)"}
                {m.hidden ? " [hidden]" : ""}
              </Text>
            ))}
          </View>
        ) : (
          <Button variant="secondary" label="View chat (logged)" onPress={() => void open("chat")} />
        )
      ) : null}

      {c.target_type === "listing" || c.target_type === "message" ? (
        <Button
          variant="secondary"
          label={`${hidden ? "Restore" : "Hide"} ${c.target_type}`}
          onPress={() => void hide(!hidden)}
        />
      ) : null}

      <View className="gap-3">
        <Text className="text-[15px] font-bold text-ink">Decision</Text>
        {c.case_type === "report" ? (
          <>
            <Toggle
              label="Harassment"
              detail="Adds a 3-point penalty to their grade"
              value={harassment}
              onChange={setHarassment}
            />
            <Button
              label="Uphold"
              disabled={busy}
              onPress={() =>
                void decide(
                  "admin_resolve_report",
                  { p_report_id: c.case_id, p_outcome: "actioned", p_harassment: harassment },
                  "Report upheld",
                )
              }
            />
            <Button
              variant="secondary"
              label="Dismiss"
              disabled={busy}
              onPress={() =>
                void decide(
                  "admin_resolve_report",
                  { p_report_id: c.case_id, p_outcome: "dismissed" },
                  "Report dismissed",
                )
              }
            />
          </>
        ) : (
          <>
            <Button
              label="Uphold the no-show"
              disabled={busy}
              onPress={() =>
                void decide(
                  "admin_resolve_dispute",
                  { p_dispute_id: c.case_id, p_outcome: "upheld" },
                  "Claim upheld",
                )
              }
            />
            <Button
              variant="secondary"
              label="Reject"
              disabled={busy}
              onPress={() =>
                void decide(
                  "admin_resolve_dispute",
                  { p_dispute_id: c.case_id, p_outcome: "rejected" },
                  "Claim rejected",
                )
              }
            />
            <Button
              variant="secondary"
              label="Reject as made in bad faith"
              disabled={busy}
              onPress={() =>
                void decide(
                  "admin_resolve_dispute",
                  { p_dispute_id: c.case_id, p_outcome: "rejected", p_bad_faith: true },
                  "Claim rejected",
                )
              }
            />
          </>
        )}
      </View>

      <View className="gap-2">
        <Text className="text-[15px] font-bold text-ink">Action on {c.target_user_name ?? "this user"}</Text>
        <View className="flex-row flex-wrap gap-2">
          {ACTIONS.map((a) => (
            <Chip key={a.label} label={a.label} onPress={() => enforce(a)} />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
