import { router } from "expo-router";
import { Megaphone } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { MODES } from "@/features/catalog/catalog";
import { formatAgo, formatPrice } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { GradeBadge } from "@/ui/GradeBadge";

import type { FeedRow } from "./types";

const WANTED = MODES.find((m) => m.id === "wanted")!;

// Offers on the shown requests (APP-21), by listing id.
export function useOfferCounts(rows: FeedRow[]) {
  const [counts, setCounts] = useState(new Map<string, number>());
  const ids = rows.map((r) => r.id).join(",");
  useEffect(() => {
    if (!ids) return;
    void supabase
      .rpc("offer_counts", { p_listing_ids: ids.split(",") })
      .then(({ data }) =>
        setCounts(
          new Map(
            ((data ?? []) as { listing_id: string; offers: number }[]).map((c) => [c.listing_id, c.offers]),
          ),
        ),
      );
  }, [ids]);
  return counts;
}

// A request card (spec 3.3, Wanted board): what is wanted, the budget, the offers so far, who asks and
// "I have this", which opens the offer sheet.
export function WantedCard({
  row,
  offers = 0,
  mine = false,
}: {
  row: FeedRow;
  offers?: number;
  mine?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.title}, budget ${formatPrice(row.price_cents)}, asked by ${row.owner.display_name}`}
      onPress={() => router.push({ pathname: "/listing/[id]", params: { id: row.id } })}
      className="gap-3 rounded-2xl border border-line p-4"
    >
      <View className="flex-row gap-3">
        <View
          className="h-11 w-11 items-center justify-center rounded-xl"
          style={{ backgroundColor: WANTED.tint }}
        >
          <Megaphone size={22} color={WANTED.ink} strokeWidth={1.9} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-base font-bold text-ink" numberOfLines={2}>
            {row.title}
          </Text>
          <Text className="text-[15px] font-extrabold text-ink">
            Budget {formatPrice(row.price_cents)}
            {offers ? (
              <Text className="font-normal text-muted">
                {" "}
                · {offers} {offers === 1 ? "offer" : "offers"}
              </Text>
            ) : null}
          </Text>
        </View>
      </View>
      <View className="flex-row items-center gap-2">
        <Text className="text-[13px] text-ink">{row.owner.display_name}</Text>
        <GradeBadge tier={row.owner.tier} />
        <Text className="flex-1 text-[13px] text-muted" numberOfLines={1}>
          · {row.area_label} · {formatAgo(row.bumped_at)}
        </Text>
        {mine ? null : (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/offer/[listingId]", params: { listingId: row.id } })}
            className="h-9 justify-center rounded-full bg-accent px-3.5"
          >
            <Text className="text-[13px] font-bold text-on-accent">I have this</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}
