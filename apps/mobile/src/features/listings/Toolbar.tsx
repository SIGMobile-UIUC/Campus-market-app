import { SlidersHorizontal } from "lucide-react-native";
import { Pressable, Text } from "react-native";

import { Chip } from "@/ui/Chip";
import { useTheme } from "@/ui/theme";

// The campus / open market toggle; nothing for users without a live campus (DSC-1).
export function MarketChips() {
  const { campus, market, setMarket } = useTheme();
  if (!campus) return null;
  return (
    <>
      <Chip
        label={`${campus.name} only`}
        selected={market === "campus"}
        onPress={() => setMarket("campus")}
      />
      <Chip label="Open market" selected={market === "open"} onPress={() => setMarket("open")} />
    </>
  );
}

export function FilterButton({
  label,
  count,
  onPress,
}: {
  label: string;
  count: number;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Filters and sort${count ? `, ${count} on` : ""}`}
      onPress={onPress}
      className="h-9 flex-row items-center gap-1.5 rounded-full border border-line px-3"
    >
      <SlidersHorizontal size={16} color={colors.ink} />
      <Text className="text-[13px] text-ink">{count ? `Filters (${count})` : label}</Text>
    </Pressable>
  );
}

// The market the screens query: campus only when the user has a live campus and chose it.
export function useScope(): "campus" | "open" {
  const { campus, market } = useTheme();
  return campus && market === "campus" ? "campus" : "open";
}
