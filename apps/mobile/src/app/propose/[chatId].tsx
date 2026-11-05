import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { Check } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { counterTrade, fetchTrades, proposeTrade } from "@/features/trades/api";
import {
  loadSpots,
  MEETUP_STEPS,
  meetupFrom,
  meetupMissing,
  meetupPayload,
  MeetupFields,
  NO_MEETUP,
  Section,
  useMissingGuide,
  type MeetupStep,
} from "@/features/trades/MeetupFields";
import { track } from "@/lib/analytics";
import { formatPrice, parsePrice } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Header } from "@/ui/Header";
import { Screen } from "@/ui/Screen";
import { useTheme } from "@/ui/theme";

type Item = { id: string; position: number; name: string; price_cents: number; status: string };
type Context = {
  listing: {
    id: string;
    kind: "item" | "bundle";
    campus_id: string | null;
    meet_place: string | null;
    items: Item[];
  };
  spots: { id: string; name: string }[];
};

async function load(chatId: string): Promise<Context | null> {
  const { data } = await supabase
    .from("chats")
    .select(
      "listing:listings!chats_listing_id_fkey(id, kind, campus_id, meet_place, items(id, position, name, price_cents, status))",
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

type Step = "items" | "total" | MeetupStep;
const STEPS: Record<Step, [button: string, hint: string]> = {
  items: ["Choose items", "Pick at least one item."],
  total: ["Check the total", "Enter a price like 40 or 40.50, or leave it empty for the item prices."],
  ...MEETUP_STEPS,
};

// Trade proposal sheet for sell listings (TRD-1, spec 3.3): items (all available ones of a bundle can be
// picked; the ones chosen on the move-out sale page come preselected), total, a time and a spot or typed
// place, prefilled with the seller's meetup place. With counter, it answers a proposal with new terms,
// starting from that proposal's (TRD-2). Wanted requests use the offer sheet instead.
export default function Propose() {
  const {
    chatId,
    items: preselected,
    counter,
  } = useLocalSearchParams<{ chatId: string; items?: string; counter?: string }>();
  const [context, setContext] = useState<Context | null | undefined>(undefined);
  const [selected, setSelected] = useState<string[]>(() => (preselected ? preselected.split(",") : []));
  const [total, setTotal] = useState("");
  const [meetup, setMeetup] = useState(NO_MEETUP);
  const [sending, setSending] = useState(false);
  // One key per sheet, so a double tap or a retry cannot propose twice.
  const [requestId] = useState(() => randomUUID());
  const guide = useMissingGuide<Step>();

  const reload = useCallback(() => load(chatId).then(setContext), [chatId]);

  useEffect(() => {
    void (async () => {
      const [loaded, [earlier] = []] = await Promise.all([
        load(chatId),
        counter ? fetchTrades([counter]).then((t) => t ?? []) : [],
      ]);
      setContext(loaded);
      if (!loaded) return;
      track("proposal_open", { listing_id: loaded.listing.id });
      if (earlier) {
        setSelected(earlier.items.flatMap((i) => (i.item_id ? [i.item_id] : [])));
        setTotal(String(earlier.total_cents / 100));
        setMeetup(meetupFrom(earlier.meet_at, earlier.spot_id, earlier.place_text));
      } else if (loaded.listing.meet_place) {
        setMeetup((m) => ({ ...m, place: loaded.listing.meet_place ?? "" }));
      }
    })();
  }, [chatId, counter]);

  const title = counter ? "Counter offer" : "Propose a trade";
  if (context === undefined) {
    return (
      <>
        <Header title={title} />
        <ActivityIndicator className="flex-1 bg-bg" />
      </>
    );
  }
  if (context === null) {
    return (
      <>
        <Header title={title} />
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
  const missing: Step | null = !chosen.length
    ? "items"
    : totalCents === null
      ? "total"
      : meetupMissing(meetup);
  const hint = (step: Step) => (guide.shown === step && missing === step ? STEPS[step][1] : null);

  const send = async () => {
    if (missing) return guide.show(missing);
    setSending(true);
    const proposal = { item_ids: chosen.map((i) => i.id), total_cents: totalCents, ...meetupPayload(meetup) };
    const trade = counter
      ? await counterTrade(counter, proposal, requestId)
      : await proposeTrade(chatId, proposal, requestId);
    setSending(false);
    // A refusal such as an item just reserved by someone else shows the items as they are now.
    if (trade) router.back();
    else void reload();
  };

  return (
    <>
      <Header title={title} />
      <Screen
        underHeader
        scrollRef={guide.scroll}
        footer={
          <Button
            label={missing ? STEPS[missing][0] : counter ? "Send counter offer" : "Send proposal"}
            disabled={sending}
            onPress={() => void send()}
          />
        }
      >
        <Section label="Items" hint={hint("items")} onLayout={guide.at("items")}>
          {listing.kind === "bundle" ? (
            listing.items.map((item) => (
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
            ))
          ) : chosen.length ? (
            chosen.map((item) => (
              <Text key={item.id} className="text-base text-ink">
                {item.name} · {formatPrice(item.price_cents)}
              </Text>
            ))
          ) : (
            <Text className="text-base text-muted">This item is reserved or sold.</Text>
          )}
        </Section>
        <View onLayout={guide.at("total")}>
          <Field
            label="Total"
            value={total}
            onChangeText={setTotal}
            placeholder={formatPrice(sum)}
            keyboardType="decimal-pad"
            error={hint("total")}
          />
        </View>
        <MeetupFields
          spots={spots}
          value={meetup}
          onChange={setMeetup}
          hint={
            missing && guide.shown === missing && missing !== "items" && missing !== "total" ? missing : null
          }
          onLayout={guide.at}
        />
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
