import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useState } from "react";

import { useAccount } from "@/features/account/account";
import { errorMessage } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Header } from "@/ui/Header";
import { Screen } from "@/ui/Screen";
import { toast } from "@/ui/Toast";

const MESSAGES = {
  COOLDOWN_ACTIVE: "You can change your nickname once every 30 days.",
  INSUFFICIENT_POINTS: "You don't have enough points for a nickname change.",
  ALREADY_EXISTS: "That nickname is taken.",
  VALIDATION_FAILED: "Use 3 to 20 letters, numbers, dots or underscores.",
  PROHIBITED_CONTENT: "That nickname isn't allowed.",
};

// Nickname change (APP-22, PTS-3): free in the first week, then paid in points; the server decides.
// One request id per visit, so a retried tap is charged once.
export default function Nickname() {
  const { account, refresh } = useAccount();
  const [name, setName] = useState(account?.display_name ?? "");
  const [requestId] = useState(() => randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const { data, error: rpcError } = await supabase.rpc("change_display_name", {
      p_display_name: name.trim(),
      p_request_id: requestId,
    });
    setSaving(false);
    if (rpcError) return setError(errorMessage(rpcError, MESSAGES));
    const spent = (data as { points_spent: number }).points_spent;
    await refresh();
    toast(spent ? `Nickname changed · ${spent} points` : "Nickname changed");
    router.back();
  };

  return (
    <>
      <Header title="Nickname" />
      <Screen
        underHeader
        footer={
          <Button
            label={saving ? "Saving…" : "Save"}
            disabled={saving || !name.trim() || name.trim() === account?.display_name}
            onPress={() => void save()}
          />
        }
      >
        <Field
          label="Nickname"
          value={name}
          onChangeText={(text) => {
            setName(text);
            setError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          error={error}
          hint="Free in your first week. After that, a change costs points and you can make one every 30 days."
        />
      </Screen>
    </>
  );
}
