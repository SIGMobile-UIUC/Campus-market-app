import { router } from "expo-router";
import { useState } from "react";

import { errorMessage } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";

export default function Email() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return setError("Enter a valid email address.");
    // The server rejects these too; checking here saves a round trip.
    if (value.split("@")[0].includes("+"))
      return setError(errorMessage({ message: "PLUS_ADDRESS_NOT_ALLOWED" }));

    setBusy(true);
    setError(null);
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: value,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (otpError) return setError(errorMessage(otpError));
    router.push({ pathname: "/verify", params: { email: value } });
  };

  return (
    <Screen
      title="What's your email?"
      subtitle="We'll send you a 6-digit code. No password needed."
      footer={<Button label={busy ? "Sending…" : "Send code"} onPress={submit} disabled={busy || !email} />}
    >
      <Field
        label="Email"
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          setError(null);
        }}
        placeholder="you@illinois.edu"
        hint="Use your school email for your campus market."
        error={error}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={submit}
        autoFocus
      />
    </Screen>
  );
}
