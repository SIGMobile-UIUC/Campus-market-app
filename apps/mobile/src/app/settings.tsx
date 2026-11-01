import { router } from "expo-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Linking, ScrollView, Text, View } from "react-native";

import { useAccount } from "@/features/account/account";
import { ContactLink } from "@/features/moderation/moderation";
import { errorMessage } from "@/lib/errors";
import { disablePush } from "@/lib/push";
import { supabase } from "@/lib/supabase";
import { TERMS_URL, TERMS_VERSION } from "@/lib/terms";
import { Button } from "@/ui/Button";
import { Header } from "@/ui/Header";
import { TextLink } from "@/ui/TextLink";
import { Toggle } from "@/ui/Toggle";

type Consent = { analytics: boolean; personalized_ads: boolean };
type Blocked = { blocked_id: string; blocked: { display_name: string | null } | null };

// Settings (APP-19, spec 3.3): notifications, privacy and consent, blocked users, rules, contact, data
// credits and the account. Per-type notification switches are P1 (ACC-9); deleting the account
// arrives with its Edge Function (FN-2).
export default function Settings() {
  const { account } = useAccount();
  const [consent, setConsent] = useState<Consent | null>(null);
  const [blocked, setBlocked] = useState<Blocked[]>([]);

  const loadBlocked = useCallback(
    () =>
      supabase
        .from("blocks")
        .select("blocked_id, blocked:profiles!blocks_blocked_id_fkey(display_name)")
        .order("created_at", { ascending: false })
        .then(({ data }) => setBlocked((data as Blocked[] | null) ?? [])),
    [],
  );

  useEffect(() => {
    void supabase
      .from("consents")
      .select("analytics, personalized_ads")
      .maybeSingle()
      .then(({ data }) => setConsent(data ?? { analytics: false, personalized_ads: false }));
    void loadBlocked();
  }, [loadBlocked]);

  const changeConsent = async (next: Consent) => {
    const previous = consent;
    setConsent(next);
    const { error } = await supabase.rpc("set_consent", {
      p_analytics: next.analytics,
      p_personalized_ads: next.personalized_ads,
      p_policy_version: TERMS_VERSION,
    });
    if (error) {
      setConsent(previous);
      Alert.alert("Couldn't save", errorMessage(error));
    }
  };

  const unblock = async (userId: string) => {
    const { error } = await supabase.rpc("unblock_user", { p_user_id: userId });
    if (error) Alert.alert("Couldn't unblock", errorMessage(error));
    void loadBlocked();
  };

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerStyle={{ padding: 20, gap: 28, paddingBottom: 40 }}>
      <Header title="Settings" />

      <Section title="Notifications">
        <Text className="text-[15px] text-muted">
          Turn notifications on or off in your phone&apos;s settings.
        </Text>
        <TextLink label="Open phone settings" onPress={() => void Linking.openSettings()} />
      </Section>

      <Section title="Privacy">
        {consent ? (
          <>
            <Toggle
              label="Anonymous usage data"
              detail="Helps us see which features work. Never your messages or location."
              value={consent.analytics}
              onChange={(analytics) => void changeConsent({ ...consent, analytics })}
            />
            <Toggle
              label="Personalized ads"
              detail="Ads based on what you browse. Off shows general ads."
              value={consent.personalized_ads}
              onChange={(personalized_ads) => void changeConsent({ ...consent, personalized_ads })}
            />
          </>
        ) : null}
      </Section>

      <Section title="Blocked users">
        {blocked.length ? (
          blocked.map((b) => (
            <View key={b.blocked_id} className="flex-row items-center justify-between border-b border-line">
              <Text className="text-[15px] text-ink">{b.blocked?.display_name ?? "Deleted user"}</Text>
              <TextLink label="Unblock" onPress={() => void unblock(b.blocked_id)} />
            </View>
          ))
        ) : (
          <Text className="text-[15px] text-muted">No one</Text>
        )}
      </Section>

      <Section title="Help">
        <View className="items-start">
          <TextLink label="Community rules and terms" onPress={() => void Linking.openURL(TERMS_URL)} />
          <ContactLink />
        </View>
        <Text className="text-[13px] text-muted">
          ZIP code data: GeoNames (geonames.org), licensed under CC BY 4.0.
        </Text>
      </Section>

      <Section title="Account">
        <Text className="text-[15px] text-muted">
          {account?.display_name} · {account?.email}
        </Text>
        <View className="items-start">
          <TextLink label="Change nickname" onPress={() => router.push("/nickname")} />
        </View>
        <Button
          variant="secondary"
          label="Sign out"
          onPress={() => void disablePush().finally(() => supabase.auth.signOut({ scope: "local" }))}
        />
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="text-[13px] font-bold uppercase text-muted">{title}</Text>
      {children}
    </View>
  );
}
