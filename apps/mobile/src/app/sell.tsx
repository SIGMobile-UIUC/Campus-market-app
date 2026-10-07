import { ChevronRight, Tag } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { MODES } from "@/features/catalog/catalog";
import { useTheme } from "@/ui/theme";

const mode = (id: string) => MODES.find((m) => m.id === id)!;

export default function SellType() {
  const { campus, market, colors } = useTheme();
  // One item is the neutral default; the other three reuse their shopping-mode tile.
  const types = [
    {
      id: "item",
      title: "One item",
      detail: "One thing, one price. Takes about a minute.",
      Icon: Tag,
      tint: colors.surface,
      ink: colors.ink,
    },
    {
      ...mode("move_out"),
      title: "Move-out sale",
      detail: "List up to 30 items at once. Each sells on its own.",
    },
    { ...mode("free"), title: "Give it away", detail: "Price set to Free. You choose who gets it." },
    { ...mode("wanted"), title: "Wanted request", detail: "Ask for something you need, with a budget." },
  ];
  return (
    <View className="gap-2 bg-bg px-5 pb-8 pt-6">
      <Text className="pb-2 text-[21px] font-extrabold text-ink">What are you posting?</Text>
      {types.map(({ id, title, detail, Icon, tint, ink }) => (
        <Pressable
          key={id}
          accessibilityRole="button"
          className="flex-row items-center gap-3.5 rounded-2xl border border-line p-3"
        >
          <View
            className="h-[52px] w-[52px] items-center justify-center rounded-2xl"
            style={{ backgroundColor: tint }}
          >
            <Icon size={26} color={ink} strokeWidth={1.9} />
          </View>
          <View className="flex-1">
            <Text className="text-base font-extrabold text-ink">{title}</Text>
            <Text className="text-[13px] text-muted">{detail}</Text>
          </View>
          <ChevronRight size={18} color={colors.muted} />
        </Pressable>
      ))}
      <Text className="pt-2 text-[13px] text-muted">
        {market === "campus"
          ? `Posting to the ${campus.name} campus market. You can also show it in the open market.`
          : "Posting to the open market."}
      </Text>
    </View>
  );
}
