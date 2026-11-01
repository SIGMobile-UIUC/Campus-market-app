import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { useAccount } from "@/features/account/account";
import { Avatar } from "@/features/avatar/Avatar";
import { OWN_LISTING_SELECT, rowToCard, type OwnListingRow } from "@/features/listings/types";
import { confirmBlock, ReportMenu, type ReportTarget } from "@/features/moderation/moderation";
import { fetchProfile, replyLabel, tradesLabel } from "@/features/profile/profile";
import { supabase } from "@/lib/supabase";
import { GradeBadge } from "@/ui/GradeBadge";
import { Header } from "@/ui/Header";
import { ListingCard } from "@/ui/ListingCard";
import { Menu, MenuButton } from "@/ui/Menu";

type Tag = { id: string; label: string };

async function load(userId: string) {
  const [profile, listings, tags] = await Promise.all([
    fetchProfile(userId),
    supabase
      .from("listings")
      .select(OWN_LISTING_SELECT)
      .eq("owner_id", userId)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("bumped_at", { ascending: false })
      .limit(30),
    supabase.from("app_config").select("value").eq("key", "review_tags").maybeSingle(),
  ]);
  if (!profile) return null;
  return {
    profile,
    listings: (listings.data as unknown as OwnListingRow[] | null) ?? [],
    tags: ((tags.data?.value as { positive: Tag[] } | undefined)?.positive ?? []).filter(
      (t) => profile.tags[t.id],
    ),
  };
}

// Public profile (ACC-4, spec 3.3): nickname, school and grade, member since, trades and reply time,
// the positive review tags with their counts, and active listings. Report and Block in the menu.
export default function Profile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAccount();
  const [data, setData] = useState<Awaited<ReturnType<typeof load>> | undefined>(undefined);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const mine = id === session?.user.id;

  useEffect(() => {
    void load(id).then(setData);
  }, [id]);

  if (!data) {
    return (
      <>
        <Header title="" />
        {data === undefined ? (
          <ActivityIndicator className="flex-1 bg-bg" />
        ) : (
          <Text className="flex-1 bg-bg px-8 pt-16 text-center text-base text-muted">
            {"This profile isn't available."}
          </Text>
        )}
      </>
    );
  }

  const { profile, listings, tags } = data;
  const name = profile.display_name;
  return (
    <ScrollView className="flex-1 bg-bg" contentContainerStyle={{ padding: 20, gap: 20 }}>
      <Header
        title=""
        right={mine ? undefined : () => <MenuButton label="Profile options" onPress={() => setMenu(true)} />}
      />
      <View className="flex-row items-center gap-4">
        <Avatar loadout={profile.avatar} size={72} />
        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-xl font-extrabold text-ink">{name}</Text>
            <GradeBadge tier={profile.tier} />
          </View>
          <Text className="text-[13px] text-muted">
            {profile.campus
              ? `Verified ${profile.campus.short_name ?? profile.campus.name} student`
              : "Open market member"}{" "}
            · Since{" "}
            {new Date(profile.member_since).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
          </Text>
          <Text className="text-[13px] text-ink">
            {[tradesLabel(profile.trades), replyLabel(profile.reply_minutes)].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </View>

      {tags.length ? (
        <View className="flex-row flex-wrap gap-2">
          {tags.map((t) => (
            <View key={t.id} className="rounded-full bg-surface px-3 py-1.5">
              <Text className="text-[13px] text-ink">
                {t.label} · {profile.tags[t.id]}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View className="gap-1">
        <Text className="text-[15px] font-bold text-ink">Listings</Text>
        {listings.length ? (
          listings.map((l) => (
            <ListingCard
              key={l.id}
              card={rowToCard(l)}
              onPress={() => router.push({ pathname: "/listing/[id]", params: { id: l.id } })}
            />
          ))
        ) : (
          <Text className="text-[15px] text-muted">Nothing for sale right now.</Text>
        )}
      </View>

      <Menu
        visible={menu}
        onClose={() => setMenu(false)}
        options={[
          {
            label: `Report ${name}`,
            onPress: () => setReporting({ type: "user", ref: profile.id, label: name }),
          },
          {
            label: `Block ${name}`,
            destructive: true,
            onPress: () => confirmBlock(profile.id, name, () => router.back()),
          },
        ]}
      />
      <ReportMenu target={reporting} onClose={() => setReporting(null)} />
    </ScrollView>
  );
}
