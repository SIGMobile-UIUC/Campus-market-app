import { router, useFocusEffect } from "expo-router";
import { ChevronRight, Ellipsis, Heart } from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAccount } from "@/features/account/account";
import { Avatar } from "@/features/avatar/Avatar";
import { rowToCard } from "@/features/listings/types";
import { useMyListings, type MyListing } from "@/features/listings/useMyListings";
import { errorMessage } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { ListingCard } from "@/ui/ListingCard";
import { Menu, type MenuOption } from "@/ui/Menu";
import { useTheme } from "@/ui/theme";

type Tab = "selling" | "reserved" | "sold";

const TABS: [Tab, string, (l: MyListing) => boolean][] = [
  ["selling", "Selling", (l) => l.status === "active" || l.status === "closed"],
  ["reserved", "Reserved", (l) => l.items.some((i) => i.status === "reserved")],
  ["sold", "Sold", (l) => l.status === "sold_out"],
];

// Me (spec 3.3) with My listings (APP-20). ponytail: grade card, wallet, check-in and shop arrive with
// APP-12; sign-out moves into Settings (APP-19). The avatar frame follows the grade once grades show.
export default function Me() {
  const { campus, colors } = useTheme();
  const { account, session } = useAccount();
  const insets = useSafeAreaInsets();
  const { listings, failed, reload } = useMyListings(session?.user.id);
  const [tab, setTab] = useState<Tab>("selling");
  const [menuFor, setMenuFor] = useState<MyListing | null>(null);

  // Back from a listing or the editor, the list shows what changed there.
  useFocusEffect(useCallback(() => reload(), [reload]));

  const shown = (listings ?? []).filter(TABS.find(([id]) => id === tab)![2]);

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 32 }}
    >
      <Text accessibilityRole="header" className="px-5 pb-4 text-2xl font-extrabold text-ink">
        Me
      </Text>
      <View className="mx-5 flex-row items-center gap-4 rounded-2xl bg-primary p-5">
        <Avatar loadout={account?.avatar ?? {}} size={64} />
        <View className="flex-1">
          <Text className="text-base font-extrabold text-on-primary">{campus?.name ?? "Open market"}</Text>
          <Text className="mt-1 text-sm text-on-primary">{account?.email}</Text>
        </View>
      </View>

      <View className="mt-6 flex-row border-b border-line px-5">
        {TABS.map(([id, label, test]) => {
          const selected = id === tab;
          return (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setTab(id)}
              className={`flex-1 items-center border-b-2 pb-2.5 ${selected ? "border-ink" : "border-transparent"}`}
            >
              <Text className={`text-[15px] ${selected ? "font-extrabold text-ink" : "text-muted"}`}>
                {label} ({(listings ?? []).filter(test).length})
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="px-5">
        {listings === null && !failed ? <ActivityIndicator className="py-8" /> : null}
        {failed ? (
          <Text className="py-8 text-center text-muted">{"We couldn't load your listings."}</Text>
        ) : null}
        {listings && !shown.length ? (
          <Text className="py-8 text-center text-muted">
            {tab === "selling" ? "Nothing for sale. Tap Sell to post something." : `Nothing ${tab} yet.`}
          </Text>
        ) : null}
        {shown.map((listing) => (
          <View key={listing.id} className="flex-row items-center border-b border-line">
            <View className="flex-1">
              <ListingCard
                card={rowToCard(listing)}
                onPress={() => router.push({ pathname: "/listing/[id]", params: { id: listing.id } })}
              />
              <Text className="-mt-2 pb-3 pl-[108px] text-[13px] text-muted">{statusLine(listing)}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Actions for ${listing.title}`}
              onPress={() => setMenuFor(listing)}
              className="h-11 w-11 items-center justify-center"
            >
              <Ellipsis size={20} color={colors.ink} />
            </Pressable>
          </View>
        ))}
      </View>

      <Pressable
        accessibilityRole="link"
        onPress={() => router.push("/favorites")}
        className="mx-5 mt-6 h-14 flex-row items-center gap-3 rounded-2xl bg-surface px-4"
      >
        <Heart size={20} color={colors.ink} />
        <Text className="flex-1 text-base text-ink">Favorites</Text>
        <ChevronRight size={18} color={colors.muted} />
      </Pressable>
      <View className="mx-5 mt-4">
        <Button
          variant="secondary"
          label="Sign out"
          onPress={() => void supabase.auth.signOut({ scope: "local" })}
        />
      </View>

      <Menu
        visible={!!menuFor}
        title={menuFor?.title}
        options={menuFor ? actions(menuFor, reload) : []}
        onClose={() => setMenuFor(null)}
      />
    </ScrollView>
  );
}

function statusLine(listing: MyListing) {
  const sold = listing.items.filter((i) => i.status === "sold").length;
  return [
    listing.status === "closed" ? "Closed" : null,
    listing.kind === "bundle" && sold ? `${sold} of ${listing.items.length} sold` : null,
    `${listing.saves} ${listing.saves === 1 ? "save" : "saves"}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

// Edit, close or reopen, mark sold elsewhere and delete (LST-7). Server rules still apply: a reserved
// item cannot change and a listing with one cannot be deleted.
function actions(listing: MyListing, reload: () => void): MenuOption[] {
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { error } = await supabase.rpc(fn, args);
    if (error) Alert.alert("Couldn't update", errorMessage(error));
    reload();
  };
  const options: MenuOption[] = [
    { label: "Edit", onPress: () => router.push({ pathname: "/edit/[id]", params: { id: listing.id } }) },
  ];
  if (listing.status === "active") {
    options.push({
      label: "Close listing",
      onPress: () => void call("close_listing", { p_listing_id: listing.id }),
    });
  }
  if (listing.status === "closed") {
    options.push({
      label: "Reopen listing",
      onPress: () => void call("reopen_listing", { p_listing_id: listing.id }),
    });
  }
  const available = listing.items.filter((i) => i.status === "available");
  if (listing.kind === "item" && available.length && listing.status === "active") {
    options.push({
      label: "Mark as sold",
      onPress: () => void call("mark_sold_elsewhere", { p_item_ids: available.map((i) => i.id) }),
    });
  }
  options.push({
    label: "Delete",
    destructive: true,
    onPress: () =>
      Alert.alert("Delete this listing?", "It disappears for buyers. Its photos are removed after 30 days.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void call("delete_listing", { p_listing_id: listing.id }),
        },
      ]),
  });
  return options;
}
