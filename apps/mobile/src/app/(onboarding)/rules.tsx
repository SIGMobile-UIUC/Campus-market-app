import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, Text, View } from "react-native";

import { useAccount } from "@/features/account/account";
import { errorMessage } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { TextLink } from "@/ui/TextLink";
import { Toggle } from "@/ui/Toggle";

// Stored with the consent row; matches the version line of docs/TERMS.md.
const TERMS_VERSION = "2026-10";
// The public repo renders the Terms until there is a website.
const TERMS_URL = "https://github.com/SIGMobile-UIUC/Campus-market-app/blob/main/docs/TERMS.md";

const RULES = [
  "Meet in public places, like the spots suggested in each trade.",
  "List only things you own. No alcohol, weapons, tickets, housing or other prohibited items.",
  "Be respectful in chat and at meetups.",
  "Show up, or cancel early. No-shows lower your trust grade.",
];

export default function RulesAndConsent() {
  const { zip, name, avatar } = useLocalSearchParams<{ zip?: string; name: string; avatar: string }>();
  const { refresh } = useAccount();
  const [agreed, setAgreed] = useState(false);
  const [analytics, setAnalytics] = useState(true);
  const [ads, setAds] = useState(true);
  const [error, setError] = useState<{ text: string; nickname: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("complete_onboarding", {
      p_display_name: name,
      p_starter_avatar: avatar,
      p_accept_terms_version: TERMS_VERSION,
      p_analytics: analytics,
      p_personalized_ads: ads,
      p_zip: zip ?? null,
      p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "America/Chicago",
    });
    // INVALID_STATE means an earlier attempt already went through (for example, the reply was lost).
    if (rpcError && rpcError.message !== "INVALID_STATE") {
      setBusy(false);
      const nickname = rpcError.message === "ALREADY_EXISTS" || rpcError.message === "PROHIBITED_CONTENT";
      return setError({ text: errorMessage(rpcError), nickname });
    }
    // Once the account reads as onboarded, the root layout switches to Home.
    await refresh();
  };

  return (
    <Screen
      title="Community rules"
      subtitle="Campus Market works because people keep their word."
      footer={
        <>
          {error ? (
            <Text accessibilityLiveRegion="polite" className="text-center text-sm text-danger">
              {error.text}
            </Text>
          ) : null}
          {error?.nickname ? <TextLink label="Change nickname" onPress={() => router.back()} /> : null}
          <Button
            label={busy ? "Setting up…" : "Start trading"}
            onPress={finish}
            disabled={!agreed || busy}
          />
        </>
      }
    >
      <View className="gap-3 rounded-2xl bg-surface p-4">
        {RULES.map((rule) => (
          <Text key={rule} className="text-[15px] leading-5 text-ink">
            • {rule}
          </Text>
        ))}
      </View>
      <TextLink
        label="Read the full Terms and Community Rules"
        onPress={() => void Linking.openURL(TERMS_URL)}
      />
      <Toggle label="I agree to the Terms and Community Rules" value={agreed} onChange={setAgreed} />
      <Toggle
        label="Share usage data to improve Campus Market"
        detail="Which screens and features you use. Change it anytime in Settings."
        value={analytics}
        onChange={setAnalytics}
      />
      <Toggle
        label="Personalized deals"
        detail="Use your interests to pick sponsored deals. Change it anytime in Settings."
        value={ads}
        onChange={setAds}
      />
    </Screen>
  );
}
