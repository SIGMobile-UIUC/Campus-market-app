import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { Check } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { proposeTrade } from "@/features/trades/api";
import { loadSpots, meetupPayload, MeetupFields, NO_MEETUP } from "@/features/trades/MeetupFields";
import { formatPrice, parsePrice } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Header } from "@/ui/Header";
import { Screen } from "@/ui/Screen";
import { useTheme } from "@/ui/theme";

type Item = { id: string; position: number; name: string; price_cents: number; status: string };
type Context = {
  listing: { kind: "item" | "bundle"; campus_id: string | null; items: Item[] };
  spots: { id: string; name: string }[];
};

async function load(chatId: string): Promise<Context | null> {
  const { data } = await supabase
    .from("chats")
    .select(
      "listing:listings!chats_listing_id_fkey(kind, campus_id, items(id, position, name, price_cents, status))",
    )
    .eq("id", chatId)
    .maybeSingle();
  const listing = (data as unknown as { listing: Context["listing"] | null } | null)?.listing;
  if (!listing) return null;
  return {
    listing: { ...listing, items: [...listing.items].sort((a, b) => a.position - b.position) },
    spots: await loadSpots(listing.campus_id),
  };
}

// Trade proposal sheet for sell listings (TRD-1, spec 3.3): items (all available ones of a bundle can be
// picked; the ones chosen on the move-out sale page come preselected), total, a time and a spot or typed
// place. Wanted requests use the offer sheet instead.
export default function Propose() {
  const { chatId, items: preselected } = useLocalSearchParams<{ chatId: string; items?: string }>();
  const [context, setContext] = useState<Context | null | undefined>(undefined);
  const [selected, setSelected] = useState<string[]>(() => (preselected ? preselected.split(",") : []));
  const [total, setTotal] = useState("");
  const [meetup, setMeetup] = useState(NO_MEETUP);
  const [sending, setSending] = useState(false);
  // One key per sheet, so a double tap or a retry cannot propose twice.
  const [requestId] = useState(() => randomUUID());

  useEffect(() => {
    void load(chatId).then(setContext);
  }, [chatId]);

  if (context === undefined) {
    return (
      <>
        <Header title="Propose a trade" />
        <ActivityIndicator className="flex-1 bg-bg" />
      </>
    );
  }
  if (context === null) {
    return (
      <>
        <Header title="Propose a trade" />
        <Text className="flex-1 bg-bg px-8 pt-16 text-center text-base text-muted">
          {"This listing isn't available anymore."}
        </Text>
      </>
    );
  }

  const { listing, spots } = context;
  // A single-item listing has nothing to choose.
  const chosen = listing.items.filter(
    (i) => i.status === "available" && (listing.kind === "item" || selected.includes(i.id)),
  );
  const sum = chosen.reduce((s, i) => s + i.price_cents, 0);
  const totalCents = total.trim() ? parsePrice(total) : sum;
  const where = meetupPayload(meetup);
  const ready = totalCents !== null && where !== null && chosen.length > 0;

  const send = async () => {
    if (!ready) return;
    setSending(true);
    const trade = await proposeTrade(
      chatId,
      { item_ids: chosen.map((i) => i.id), total_cents: totalCents, ...where },
      requestId,
    );
    setSending(false);
    if (trade) router.back();
  };

  return (
    <>
      <Header title="Propose a trade" />
      <Screen
        underHeader
        footer={<Button label="Send proposal" disabled={!ready || sending} onPress={() => void send()} />}
      >
        {listing.kind === "bundle" ? (
          <View className="gap-1">
            <Text className="text-sm font-bold text-ink">Items</Text>
            {listing.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                checked={selected.includes(item.id)}
                onToggle={() =>
                  setSelected((current) =>
                    current.includes(item.id)
                      ? current.filter((id) => id !== item.id)
                      : [...current, item.id],
                  )
                }
              />
            ))}
          </View>
        ) : (
          chosen.map((item) => (
            <Text key={item.id} className="text-base text-ink">
              {item.name} · {formatPrice(item.price_cents)}
            </Text>
          ))
        )}
        <Field
          label="Total"
          value={total}
          onChangeText={setTotal}
          placeholder={formatPrice(sum)}
          keyboardType="decimal-pad"
        />
        <MeetupFields spots={spots} value={meetup} onChange={setMeetup} />
      </Screen>
    </>
  );
}

function ItemRow({ item, checked, onToggle }: { item: Item; checked: boolean; onToggle: () => void }) {
  const { colors } = useTheme();
  const available = item.status === "available";
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !available }}
      disabled={!available}
      onPress={onToggle}
      className={`min-h-12 flex-row items-center gap-3 ${available ? "" : "opacity-40"}`}
    >
      <View
        className={`h-6 w-6 items-center justify-center rounded-md ${checked ? "bg-ink" : "border border-line"}`}
      >
        {checked ? <Check size={16} color={colors.bg} strokeWidth={3} /> : null}
      </View>
      <Text className="flex-1 text-base text-ink">{item.name}</Text>
      <Text className="text-base text-muted">
        {available ? formatPrice(item.price_cents) : item.status === "reserved" ? "Reserved" : "Sold"}
      </Text>
    </Pressable>
  );
}
