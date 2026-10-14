import { router } from "expo-router";
import { Globe } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { useAccount } from "@/features/account/account";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";
import { TextLink } from "@/ui/TextLink";
import { useTheme } from "@/ui/theme";

// Campus reveal (spec 3.3): a live campus animates in; a waitlist school or any other email gets the
// open market, and general users set the ZIP code their listings show up around.
export default function CampusReveal() {
  const { account } = useAccount();
  const { campus } = useTheme();
  const school = account?.campus ?? null;

  if (campus) {
    return (
      <Screen
        title={`Welcome to ${campus.name}`}
        subtitle={`You're in the ${campus.name} campus market. Campus listings are visible only to verified ${campus.name} students.`}
        footer={
          <>
            <Button label="Continue" onPress={() => router.push("/profile")} />
            <SwitchEmail />
          </>
        }
      >
        <Animated.View
          entering={FadeInDown.duration(600)}
          className="h-40 items-center justify-center rounded-3xl"
          style={{ backgroundColor: campus.primary }}
        >
          <View className="h-5 w-5 rounded-full" style={{ backgroundColor: campus.accent }} />
          <Text className="mt-3 text-2xl font-extrabold" style={{ color: campus.onPrimary }}>
            {campus.name}
          </Text>
        </Animated.View>
      </Screen>
    );
  }

  if (school) return <Waitlist campusId={school.id} name={school.short_name ?? school.name} />;

  return <OpenMarketZip />;
}

// The email decides the market, so someone who meant to use their school email can start over.
function SwitchEmail() {
  const { account } = useAccount();
  return (
    <View>
      <Text className="text-center text-[13px] text-muted">Signed in as {account?.email}</Text>
      <TextLink
        label="Use a different email"
        onPress={() => void supabase.auth.signOut({ scope: "local" })}
      />
    </View>
  );
}

function Waitlist({ campusId, name }: { campusId: string; name: string }) {
  // Other students' profiles count once onboarded; the caller's own row is always visible, so it counts too.
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    void supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("campus_id", campusId)
      .then(({ count: total }) => setCount(total));
  }, [campusId]);

  return (
    <Screen
      title="You're in the open market"
      subtitle={`${name} isn't on Campus Market yet. Until it opens, trade in the open market with a verified student badge.`}
      footer={
        <>
          <Button label="Continue" onPress={() => router.push("/profile")} />
          <SwitchEmail />
        </>
      }
    >
      {count ? (
        <Text className="text-base text-ink">
          {count === 1
            ? `You're the first student from ${name} on the waitlist.`
            : `${count} students from ${name} are on the waitlist, including you.`}
        </Text>
      ) : null}
    </Screen>
  );
}

function OpenMarketZip() {
  const { colors } = useTheme();
  const [zip, setZip] = useState("");
  // The answer is kept with the ZIP it belongs to, so a late reply for an old ZIP is ignored.
  const [lookup, setLookup] = useState<{ zip: string; place: string | null } | null>(null);
  const place = lookup?.zip === zip ? lookup.place : null;
  const error = lookup?.zip === zip && !lookup.place ? "We don't know that ZIP code." : null;

  useEffect(() => {
    if (zip.length !== 5) return;
    void supabase
      .from("zip_codes")
      .select("city, state")
      .eq("zip", zip)
      .maybeSingle()
      .then(({ data }) => setLookup({ zip, place: data ? `${data.city}, ${data.state}` : null }));
  }, [zip]);

  return (
    <Screen
      title="You're in the open market"
      subtitle="Anyone can join the open market. Your ZIP code sets where your listings show up."
      footer={
        <>
          <Button
            label="Continue"
            onPress={() => router.push({ pathname: "/profile", params: { zip } })}
            disabled={!place}
          />
          <SwitchEmail />
        </>
      }
    >
      <Animated.View
        entering={FadeInDown.duration(600)}
        className="h-24 items-center justify-center rounded-3xl bg-surface"
      >
        <Globe size={36} color={colors.ink} />
      </Animated.View>
      <Field
        label="ZIP code"
        value={zip}
        onChangeText={(text) => setZip(text.replace(/\D/g, "").slice(0, 5))}
        placeholder="5-digit ZIP"
        autoFocus
        hint={place ?? "Only the city is shown to others."}
        error={error}
        keyboardType="number-pad"
        autoComplete="postal-code"
        textContentType="postalCode"
        maxLength={5}
      />
    </Screen>
  );
}
