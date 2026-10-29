import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAccount } from "@/features/account/account";
import { Avatar, type Loadout } from "@/features/avatar/Avatar";
import { tierAtLeast } from "@/features/points/points";
import { errorMessage } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { GRADE_LETTERS } from "@/ui/GradeBadge";
import { Header } from "@/ui/Header";
import { Menu } from "@/ui/Menu";
import { TextLink } from "@/ui/TextLink";
import { toast } from "@/ui/Toast";

type Slot = keyof Loadout;
type Item = {
  id: string;
  slot: string;
  name: string;
  rarity: string;
  price: number;
  min_tier: string | null;
  campus_id: string | null;
  active: boolean;
  asset_key: string;
};
type Stock = { items: Item[]; owned: Set<string>; balance: number };

const SLOTS: [Slot, string][] = [
  ["body", "Body"],
  ["background", "Background"],
  ["top", "Top"],
  ["face", "Face"],
  ["head", "Head"],
];

type Sort = "low" | "high" | "rarity";
const SORTS: [Sort, string][] = [
  ["low", "Lowest price"],
  ["high", "Highest price"],
  ["rarity", "Rarest first"],
];
const RARITY = ["common", "rare", "epic", "legendary", "limited"];
const COMPARE: Record<Sort, (a: Item, b: Item) => number> = {
  low: (a, b) => a.price - b.price,
  high: (a, b) => b.price - a.price,
  rarity: (a, b) => RARITY.indexOf(b.rarity) - RARITY.indexOf(a.rarity) || a.price - b.price,
};

const MESSAGES = {
  INSUFFICIENT_POINTS: "You don't have enough points for this.",
  TIER_REQUIRED: "Your grade isn't high enough for this item yet.",
  ALREADY_OWNED: "You already own this.",
  ITEM_NOT_FOR_SALE: "This item isn't for sale anymore.",
  FORBIDDEN: "You don't own this item.",
};

async function load(): Promise<Stock | null> {
  const [items, owned, wallet] = await Promise.all([
    supabase
      .from("shop_items")
      .select("id, slot, name, rarity, price, min_tier, campus_id, active, asset_key")
      .in(
        "slot",
        SLOTS.map(([slot]) => slot),
      ),
    supabase.from("inventory").select("item_id").gt("quantity", 0),
    supabase.rpc("get_wallet"),
  ]);
  if (items.error || owned.error || wallet.error) return null;
  return {
    items: items.data,
    owned: new Set(owned.data.map((row) => row.item_id)),
    balance: (wallet.data as { balance: number }).balance,
  };
}

// Shop and avatar editor (PTS-5, PTS-6, spec 3.3): items by slot with rarity, price and grade or campus
// badges, a live preview, buying with points and equipping what you own.
export default function Shop() {
  const { account, refresh } = useAccount();
  const insets = useSafeAreaInsets();
  const [stock, setStock] = useState<Stock | null | undefined>(undefined);
  const [slot, setSlot] = useState<Slot>("body");
  const [sort, setSort] = useState<Sort>("low");
  const [sorting, setSorting] = useState(false);
  const [picked, setPicked] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => load().then(setStock), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const loadout = account?.avatar ?? {};
  const tier = account?.tier ?? "b";
  // What the shop sells to this user, and anything they already own.
  const shown = (stock?.items ?? [])
    .filter(
      (item) =>
        item.slot === slot &&
        (stock?.owned.has(item.id) ||
          (item.active && (!item.campus_id || item.campus_id === account?.campus?.id))),
    )
    .sort(COMPARE[sort]);

  const run = async (fn: string, args: Record<string, unknown>, done: string) => {
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    if (error) Alert.alert("Couldn't do that", errorMessage(error, MESSAGES));
    else toast(done);
    await Promise.all([reload(), refresh()]);
    setBusy(false);
  };

  const action = () => {
    if (!picked || !stock) return null;
    if (stock.owned.has(picked.id)) {
      const equipped = loadout[slot] === picked.asset_key;
      return (
        <Button
          label={equipped ? "Take off" : "Wear"}
          variant={equipped ? "secondary" : "accent"}
          disabled={busy}
          onPress={() =>
            void run(
              "equip_item",
              { p_slot: slot, p_item_id: equipped ? null : picked.id },
              equipped ? "Taken off" : "You're wearing it",
            )
          }
        />
      );
    }
    const locked = picked.min_tier && !tierAtLeast(tier, picked.min_tier);
    return (
      <View className="gap-2">
        {stock.balance < 0 ? (
          <Text className="text-center text-[13px] text-danger">
            Your balance is negative. New points pay it off first.
          </Text>
        ) : null}
        <Button
          label={locked ? `Needs grade ${GRADE_LETTERS[picked.min_tier!]}` : `Buy for ${picked.price} pts`}
          disabled={busy || !!locked || stock.balance < picked.price}
          onPress={() =>
            void run(
              "purchase_item",
              { p_item_id: picked.id, p_purchase_id: randomUUID() },
              `${picked.name} is yours`,
            )
          }
        />
      </View>
    );
  };

  return (
    <View className="flex-1 bg-bg">
      <Header title="Shop" />
      {stock === undefined ? <ActivityIndicator className="py-8" /> : null}
      {stock === null ? (
        <Text className="px-8 pt-16 text-center text-base text-muted">{"We couldn't load the shop."}</Text>
      ) : null}
      {stock ? (
        <>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
            <View className="items-center gap-2">
              <Avatar loadout={picked ? { ...loadout, [slot]: picked.asset_key } : loadout} size={128} />
              <Text className={`text-[15px] font-bold ${stock.balance < 0 ? "text-danger" : "text-ink"}`}>
                {stock.balance} pts
              </Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {SLOTS.map(([id, label]) => (
                <Chip
                  key={id}
                  label={label}
                  selected={id === slot}
                  onPress={() => {
                    setSlot(id);
                    setPicked(null);
                  }}
                />
              ))}
            </ScrollView>
            <View className="flex-row justify-end">
              <TextLink
                label={`Sort: ${SORTS.find(([id]) => id === sort)![1]}`}
                onPress={() => setSorting(true)}
              />
            </View>
            <View className="flex-row flex-wrap gap-3">
              {shown.map((item) => (
                <ItemTile
                  key={item.id}
                  item={item}
                  preview={{ ...loadout, [slot]: item.asset_key }}
                  owned={stock.owned.has(item.id)}
                  equipped={loadout[slot] === item.asset_key}
                  selected={picked?.id === item.id}
                  onPress={() => setPicked(item)}
                />
              ))}
            </View>
            {!shown.length ? <Text className="text-center text-muted">Nothing here yet.</Text> : null}
          </ScrollView>
          {picked ? (
            <View className="border-t border-line px-5 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
              {action()}
            </View>
          ) : null}
        </>
      ) : null}
      <Menu
        visible={sorting}
        title="Sort items"
        options={SORTS.map(([id, label]) => ({ label, onPress: () => setSort(id) }))}
        onClose={() => setSorting(false)}
      />
    </View>
  );
}

function ItemTile({
  item,
  preview,
  owned,
  equipped,
  selected,
  onPress,
}: {
  item: Item;
  preview: Loadout;
  owned: boolean;
  equipped: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const badges = [
    item.min_tier ? `${GRADE_LETTERS[item.min_tier]} and up` : null,
    item.campus_id ? "Campus only" : null,
  ].filter(Boolean);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${item.name}, ${item.rarity}, ${owned ? "owned" : `${item.price} points`}`}
      onPress={onPress}
      className={`w-[47%] items-center gap-1 rounded-2xl p-3 ${selected ? "border-2 border-ink" : "border border-line"}`}
    >
      <Avatar loadout={preview} size={72} />
      <Text className="text-[15px] font-bold text-ink">{item.name}</Text>
      <Text className="text-[13px] capitalize text-muted">{item.slot === "body" ? "Free" : item.rarity}</Text>
      <Text className="text-[13px] font-bold text-ink">
        {equipped ? "Wearing" : owned ? "Owned" : `${item.price} pts`}
      </Text>
      {badges.length ? <Text className="text-[12px] text-warning">{badges.join(" · ")}</Text> : null}
    </Pressable>
  );
}
