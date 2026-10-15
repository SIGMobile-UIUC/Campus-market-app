import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";

import { formatAgo, formatPrice } from "@/lib/format";

import { Photo } from "./Photo";

export type ListingCardData = {
  kind: "item" | "bundle" | "wanted";
  title: string;
  priceCents: number;
  itemCount: number;
  areaLabel: string;
  campusOnly: boolean;
  bumpedAt?: string;
  // A stored photo by path, or a local file before upload (the sell preview).
  image: { path: string; blurhash?: string | null } | { uri: string } | null;
};

function priceLine(card: ListingCardData) {
  if (card.kind === "wanted") return `Budget ${formatPrice(card.priceCents)}`;
  if (card.kind === "bundle") return `From ${formatPrice(card.priceCents)} · ${card.itemCount} items`;
  return formatPrice(card.priceCents);
}

function metaLine(card: ListingCardData) {
  return [
    card.areaLabel,
    card.bumpedAt ? formatAgo(card.bumpedAt) : "now",
    card.campusOnly ? "Campus only" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function Thumb({ card, style }: { card: ListingCardData; style: object }) {
  if (card.image && "path" in card.image) {
    return <Photo path={card.image.path} blurhash={card.image.blurhash} style={style} />;
  }
  if (card.image) return <Image source={{ uri: card.image.uri }} style={style} contentFit="cover" />;
  return (
    <View className="items-center justify-center bg-surface" style={style}>
      <Text className="text-xs font-bold text-muted">{card.kind === "wanted" ? "Wanted" : "No photo"}</Text>
    </View>
  );
}

// A listing as buyers see it (spec 3.4): a row for lists and previews, a tile for two-column grids.
export function ListingCard({
  card,
  variant = "row",
  onPress,
}: {
  card: ListingCardData;
  variant?: "row" | "tile";
  onPress?: () => void;
}) {
  const label = `${card.title}, ${priceLine(card)}, ${metaLine(card)}`;
  if (variant === "tile") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        className="flex-1 gap-1 pb-4"
      >
        <Thumb card={card} style={{ width: "100%", aspectRatio: 1, borderRadius: 12 }} />
        <Text className="pt-1 text-[15px] text-ink" numberOfLines={1}>
          {card.title || "Title"}
        </Text>
        <Text className="text-[15px] font-extrabold text-ink" numberOfLines={1}>
          {priceLine(card)}
        </Text>
        <Text className="text-xs text-muted" numberOfLines={1}>
          {metaLine(card)}
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={!onPress}
      className="flex-row gap-3 py-3"
    >
      <Thumb card={card} style={{ width: 96, height: 96, borderRadius: 12 }} />
      <View className="flex-1 gap-1">
        <Text className="text-base text-ink" numberOfLines={2}>
          {card.title || "Title"}
        </Text>
        <Text className="text-base font-extrabold text-ink">{priceLine(card)}</Text>
        <Text className="text-[13px] text-muted">{metaLine(card)}</Text>
      </View>
    </Pressable>
  );
}
