import { FunctionsHttpError } from "@supabase/supabase-js";
import { useState } from "react";
import { Alert, Text } from "react-native";

import { useAccount } from "@/features/account/account";
import { errorMessage } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Header } from "@/ui/Header";
import { Screen } from "@/ui/Screen";
import { toast } from "@/ui/Toast";

const MESSAGES: Record<number, string> = {
  400: "That code is wrong or expired. Send a new one.",
  409: "You can delete your account once the dispute about your trade is resolved.",
};

// Delete account (ACC-8, spec 3.3): what goes and what stays, a fresh code from the sign-in email, then a
// final confirm. delete-account does the work; the session ends with the account.
export default function DeleteAccount() {
  const { account } = useAccount();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    setError(null);
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: account!.email,
      options: { shouldCreateUser: false },
    });
    if (otpError) return setError(errorMessage(otpError));
    setSent(true);
  };

  const remove = async () => {
    setBusy(true);
    const { error: fnError } = await supabase.functions.invoke("delete-account", { body: { code } });
    setBusy(false);
    if (fnError) {
      const status = fnError instanceof FunctionsHttpError ? (fnError.context as Response).status : 0;
      setCode("");
      return setError(MESSAGES[status] ?? "Couldn't delete your account. Try again.");
    }
    toast("Your account was deleted");
    await supabase.auth.signOut({ scope: "local" });
  };

  const confirm = () =>
    Alert.alert("Delete your account?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void remove() },
    ]);

  return (
    <>
      <Header title="Delete account" />
      <Screen
        underHeader
        footer={
          sent ? (
            <Button
              label={busy ? "Deleting…" : "Delete account"}
              variant="primary"
              disabled={busy || code.length !== 6}
              onPress={confirm}
            />
          ) : (
            <Button label="Email me a code" variant="primary" onPress={() => void sendCode()} />
          )
        }
      >
        <Text className="text-[15px] leading-6 text-ink">
          {"Deleting your account removes your email, settings, saved listings, blocks and avatar. " +
            "Your active listings come down, open trades are cancelled, and you leave every chat.\n\n" +
            'Past trades, reviews and messages stay, shown as "Deleted user". Points and avatar items are lost.'}
        </Text>
        {sent ? (
          <Field
            label="Code"
            value={code}
            onChangeText={(text) => {
              setCode(text.replace(/\D/g, "").slice(0, 6));
              setError(null);
            }}
            hint={`We sent a 6-digit code to ${account?.email}.`}
            error={error}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            editable={!busy}
            autoFocus
          />
        ) : error ? (
          <Text className="text-sm text-danger">{error}</Text>
        ) : null}
      </Screen>
    </>
  );
}
