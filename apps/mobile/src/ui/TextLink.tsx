import { Pressable, Text } from "react-native";

// A text-styled button. Not nested inside another Text, so screen readers reach it and the touch
// target can be 44 pt tall.
export function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="min-h-11 items-center justify-center self-center px-3"
    >
      <Text className="text-sm font-bold text-ink underline">{label}</Text>
    </Pressable>
  );
}
