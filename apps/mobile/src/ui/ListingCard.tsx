import { Image } from "expo-image";
import { Text, View } from "react-native";

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

// One feed row as buyers see it (spec 3.4 wireframe): photo, title, price, area and age.
export function ListingCard({ card }: { card: ListingCardData }) {
  const photoStyle = { width: 96, height: 96, borderRadius: 12 };
  return (
    <View className="flex-row gap-3 py-3">
      {card.image && "path" in card.image ? (
        <Photo path={card.image.path} blurhash={card.image.blurhash} style={photoStyle} />
      ) : card.image ? (
        <Image source={{ uri: card.image.uri }} style={photoStyle} contentFit="cover" />
      ) : (
        <View className="items-center justify-center bg-surface" style={photoStyle}>
          <Text className="text-xs font-bold text-muted">
            {card.kind === "wanted" ? "Wanted" : "No photo"}
          </Text>
        </View>
      )}
      <View className="flex-1 gap-1">
        <Text className="text-base text-ink" numberOfLines={2}>
          {card.title || "Title"}
        </Text>
        <Text className="text-base font-extrabold text-ink">{priceLine(card)}</Text>
        <Text className="text-[13px] text-muted">
          {[
            card.areaLabel,
            card.bumpedAt ? formatAgo(card.bumpedAt) : "now",
            card.campusOnly ? "Campus only" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
    </View>
  );
}
