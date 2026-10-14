import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";

import { errorMessage } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";

// Matches the hosted email rate limit: one code per address per 60 seconds.
const RESEND_SECONDS = 60;

export default function Verify() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  // On success the session changes and the root layout moves on to onboarding or Home.
  const verify = async (token: string) => {
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    setBusy(false);
    if (verifyError) {
      setError(errorMessage(verifyError));
      setCode("");
    }
  };

  const resend = async () => {
    setError(null);
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (otpError) return setError(errorMessage(otpError));
    setWait(RESEND_SECONDS);
  };

  return (
    <Screen
      title="Enter your code"
      subtitle={`We sent a 6-digit code to ${email}.`}
      footer={
        <Button
          variant="secondary"
          label={wait > 0 ? `Resend code in ${wait}s` : "Resend code"}
          onPress={resend}
          disabled={wait > 0 || busy}
        />
      }
    >
      <Field
        label="Code"
        value={code}
        onChangeText={(text) => {
          const digits = text.replace(/\D/g, "").slice(0, 6);
          setCode(digits);
          setError(null);
          if (digits.length === 6) void verify(digits);
        }}
        hint={busy ? "Checking…" : "Check your spam folder if it doesn't arrive."}
        error={error}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        editable={!busy}
        autoFocus
      />
    </Screen>
  );
}
