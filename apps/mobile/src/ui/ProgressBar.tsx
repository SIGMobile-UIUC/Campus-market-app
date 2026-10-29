import { View } from "react-native";

// value from 0 to 1.
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      className="h-2 overflow-hidden rounded-full bg-line"
    >
      <View className="h-full rounded-full bg-success" style={{ width: `${percent}%` }} />
    </View>
  );
}
