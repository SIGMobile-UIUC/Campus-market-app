import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { Check } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { proposeTrade } from "@/features/trades/api";
import { formatPrice, parsePrice } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { Field } from "@/ui/Field";
import { Header } from "@/ui/Header";
import { Screen } from "@/ui/Screen";
import { useTheme } from "@/ui/theme";

type Item = { id: string; position: number; name: string; price_cents: number; status: string };
type Context = {
  listing: {
    kind: "item" | "bundle" | "wanted";
    campus_id: string | null;
    budget_cents: number | null;
    items: Item[];
  };
  spots: { id: string; name: string }[];
};

async function load(chatId: string): Promise<Context | null> {
  const { data } = await supabase
    .from("chats")
    .select(
      "listing:listings!chats_listing_id_fkey(kind, campus_id, budget_cents, items(id, position, name, price_cents, status))",
    )
    .eq("id", chatId)
    .maybeSingle();
  const listing = (data as unknown as { listing: Context["listing"] | null } | null)?.listing;
  if (!listing) return null;
  const { data: spots } = listing.campus_id
    ? await supabase.from("meetup_spots").select("id, name").eq("campus_id", listing.campus_id).order("name")
    : { data: [] };
  return {
    listing: { ...listing, items: [...listing.items].sort((a, b) => a.position - b.position) },
    spots: spots ?? [],
  };
}

// Meetup times on the half hour from 8 AM to 9:30 PM, over the next 7 days.
const TIMES = Array.from({ length: 28 }, (_, i) => 8 * 60 + i * 30);
function dayStart(offset: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}
const dayLabel = (offset: number) =>
  offset === 0
    ? "Today"
    : offset === 1
      ? "Tomorrow"
      : dayStart(offset).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const timeLabel = (minutes: number) =>
  new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

// Trade proposal sheet (TRD-1, spec 3.3): items (all available ones of a bundle can be picked; the ones
// chosen on the move-out sale page come preselected), total, a time and a spot or typed place. On a
// wanted request the responder describes what they offer.
export default function Propose() {
  const { chatId, items: preselected } = useLocalSearchParams<{ chatId: string; items?: string }>();
  const [context, setContext] = useState<Context | null | undefined>(undefined);
  const [selected, setSelected] = useState<string[]>(() => (preselected ? preselected.split(",") : []));
  const [total, setTotal] = useState("");
  const [offerName, setOfferName] = useState("");
  const [day, setDay] = useState<number | null>(null);
  const [time, setTime] = useState<number | null>(null);
  const [spot, setSpot] = useState<string | null>(null);
  const [place, setPlace] = useState("");
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
  const wanted = listing.kind === "wanted";
  // A single-item listing has nothing to choose.
  const chosen =
    listing.kind === "item"
      ? listing.items.filter((i) => i.status === "available")
      : listing.items.filter((i) => selected.includes(i.id) && i.status === "available");
  const sum = chosen.reduce((s, i) => s + i.price_cents, 0);
  const totalCents = total.trim() ? parsePrice(total) : wanted ? null : sum;
  const now = new Date();
  const times = TIMES.filter((m) => day !== 0 || m > now.getHours() * 60 + now.getMinutes() + 15);
  const meet = day !== null && time !== null ? new Date(dayStart(day).getTime() + time * 60_000) : null;
  const ready =
    totalCents !== null &&
    meet !== null &&
    (spot !== null || place.trim() !== "") &&
    (wanted ? offerName.trim() !== "" : chosen.length > 0);

  const send = async () => {
    if (!ready) return;
    setSending(true);
    const trade = await proposeTrade(
      chatId,
      {
        ...(wanted
          ? { offer_items: [{ name: offerName.trim(), price_cents: totalCents }] }
          : { item_ids: chosen.map((i) => i.id) }),
        total_cents: totalCents,
        meet_at: meet!.toISOString(),
        spot_id: spot,
        place_text: spot ? null : place.trim(),
      },
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
        {wanted ? (
          <Field label="What you offer" value={offerName} onChangeText={setOfferName} maxLength={80} />
        ) : listing.kind === "bundle" ? (
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
          label={wanted ? `Price (budget ${formatPrice(listing.budget_cents ?? 0)})` : "Total"}
          value={total}
          onChangeText={setTotal}
          placeholder={wanted ? "$0" : formatPrice(sum)}
          keyboardType="decimal-pad"
        />

        <Section label="When">
          <ChipRow>
            {Array.from({ length: 7 }, (_, offset) => (
              <Chip
                key={offset}
                label={dayLabel(offset)}
                selected={day === offset}
                onPress={() => setDay(offset)}
              />
            ))}
          </ChipRow>
          {day !== null && !times.length ? (
            <Text className="text-[13px] text-muted">No meetup times left today. Pick another day.</Text>
          ) : null}
          {day !== null && times.length ? (
            <ChipRow>
              {times.map((m) => (
                <Chip key={m} label={timeLabel(m)} selected={time === m} onPress={() => setTime(m)} />
              ))}
            </ChipRow>
          ) : null}
        </Section>

        <Section label="Where">
          {spots.length ? (
            <View className="flex-row flex-wrap gap-2">
              {spots.map((s) => (
                <Chip
                  key={s.id}
                  label={s.name}
                  selected={spot === s.id}
                  onPress={() => setSpot(spot === s.id ? null : s.id)}
                />
              ))}
            </View>
          ) : null}
          <Field
            label={spots.length ? "Or type a place" : "Place"}
            value={place}
            onChangeText={(text) => {
              setPlace(text);
              if (text) setSpot(null);
            }}
            placeholder="A busy public place"
            maxLength={120}
          />
        </Section>
      </Screen>
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-bold text-ink">{label}</Text>
      {children}
    </View>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {children}
    </ScrollView>
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
