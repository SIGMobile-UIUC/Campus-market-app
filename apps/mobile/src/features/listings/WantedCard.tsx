import { router } from "expo-router";
import { Megaphone } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { MODES } from "@/features/catalog/catalog";
import { openChat } from "@/features/chat/api";
import { formatAgo, formatPrice } from "@/lib/format";
import { GradeBadge } from "@/ui/GradeBadge";

import type { FeedRow } from "./types";

const WANTED = MODES.find((m) => m.id === "wanted")!;

// A request card (spec 3.3, Wanted board): what is wanted, the budget, who asks and "I have this", which
// opens a chat with the requester (the offer sheet comes with APP-18).
// ponytail: the offer count arrives with offers (M3).
export function WantedCard({ row, mine = false }: { row: FeedRow; mine?: boolean }) {
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
          <Text className="text-[15px] font-extrabold text-ink">Budget {formatPrice(row.price_cents)}</Text>
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
            onPress={() => void openChat(row.id)}
            className="h-9 justify-center rounded-full bg-accent px-3.5"
          >
            <Text className="text-[13px] font-bold text-on-accent">I have this</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}
