import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Avatar } from "@/features/avatar/Avatar";
import { useStarterLooks } from "@/features/avatar/starterLooks";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";
import { TextLink } from "@/ui/TextLink";

const NICKNAME = /^[A-Za-z0-9_.]{3,20}$/;

// Nickname and starter avatar (spec 3.3, ACC-3).
export default function ProfileSetup() {
  const { zip } = useLocalSearchParams<{ zip?: string }>();
  const { looks, failed, retry } = useStarterLooks();
  const [picked, setPicked] = useState<string | null>(null);
  const avatar = picked ?? looks[0]?.id ?? null;
  const [name, setName] = useState("");
  const [checked, setChecked] = useState<{ name: string; taken: boolean } | null>(null);
  const valid = NICKNAME.test(name);
  const taken = checked?.name === name ? checked.taken : null;

  // Live availability check; complete_onboarding has the final say, so a race only costs one retry.
  useEffect(() => {
    if (!valid) return;
    const timer = setTimeout(() => {
      void supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .ilike(
          "display_name",
          name.replace(/[\\_%]/g, (c) => `\\${c}`),
        )
        .then(({ count }) => setChecked({ name, taken: (count ?? 0) > 0 }));
    }, 400);
    return () => clearTimeout(timer);
  }, [name, valid]);

  const hint = !name
    ? "3 to 20 letters, numbers, _ or ."
    : !valid
      ? "Use 3 to 20 letters, numbers, _ or ."
      : taken === null
        ? "Checking…"
        : "Available";

  return (
    <Screen
      title="Make your profile"
      subtitle="Others see your nickname and avatar, never your email or real name."
      footer={
        <Button
          label="Continue"
          onPress={() => router.push({ pathname: "/rules", params: { zip, name, avatar } })}
          disabled={!valid || taken !== false || !avatar}
        />
      }
    >
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Starter avatar"
        className="flex-row flex-wrap justify-between gap-y-3"
      >
        {looks.map((look, index) => {
          const selected = look.id === avatar;
          return (
            <Pressable
              key={look.id}
              accessibilityRole="radio"
              accessibilityLabel={`Avatar ${index + 1}`}
              accessibilityState={{ checked: selected }}
              onPress={() => setPicked(look.id)}
              className={`w-[31%] items-center rounded-2xl border-2 py-2 ${selected ? "border-accent" : "border-transparent"}`}
            >
              <Avatar loadout={look.loadout} size={80} />
            </Pressable>
          );
        })}
      </View>
      {failed ? (
        <View>
          <Text className="text-center text-sm text-danger">{"We couldn't load the avatars."}</Text>
          <TextLink label="Try again" onPress={retry} />
        </View>
      ) : null}
      <Field
        label="Nickname"
        value={name}
        onChangeText={setName}
        placeholder="e.g. maple_23"
        hint={hint}
        error={taken ? "That nickname is taken." : null}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={20}
      />
    </Screen>
  );
}
