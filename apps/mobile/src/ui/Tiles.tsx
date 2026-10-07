import type { LucideIcon } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { useTheme } from "./theme";

// Shopping modes keep fixed tints on every campus; categories stay neutral (spec 3.6.1).
export function ModeTile({
  label,
  Icon,
  tint,
  ink,
  onPress,
}: {
  label: string;
  Icon: LucideIcon;
  tint: string;
  ink: string;
  onPress?: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="flex-1 items-center gap-1.5">
      <View
        className="h-14 w-14 items-center justify-center rounded-[18px]"
        style={{ backgroundColor: tint }}
      >
        <Icon size={26} color={ink} strokeWidth={1.9} />
      </View>
      <Text className="text-xs font-bold text-ink">{label}</Text>
    </Pressable>
  );
}

export function CategoryTile({
  label,
  Icon,
  onPress,
}: {
  label: string;
  Icon: LucideIcon;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="w-1/5 items-center gap-1.5 py-2">
      <View className="h-[52px] w-[52px] items-center justify-center rounded-2xl bg-surface">
        <Icon size={26} color={colors.ink} strokeWidth={1.7} />
      </View>
      <Text className="text-center text-xs text-ink">{label}</Text>
    </Pressable>
  );
}
