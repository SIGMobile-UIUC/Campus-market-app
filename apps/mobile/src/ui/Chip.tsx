import { Pressable, Text } from "react-native";

export function Chip({
  label,
  selected = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`h-9 justify-center rounded-full px-3.5 ${selected ? "bg-ink" : "border border-line bg-bg"}`}
    >
      <Text className={`text-[13px] ${selected ? "font-bold text-bg" : "text-ink"}`}>{label}</Text>
    </Pressable>
  );
}
