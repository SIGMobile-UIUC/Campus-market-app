import { Pressable, Text } from "react-native";

type Variant = "accent" | "primary" | "secondary";

const CONTAINER: Record<Variant, string> = {
  accent: "bg-accent",
  primary: "bg-primary",
  secondary: "border border-line bg-bg",
};

const LABEL: Record<Variant, string> = {
  accent: "text-on-accent",
  primary: "text-on-primary",
  secondary: "text-ink",
};

// The campus accent is reserved for primary actions: Sell, Chat with seller, I have this, Completed (spec 3.6.1).
export function Button({
  label,
  onPress,
  variant = "accent",
  disabled = false,
}: {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`h-12 items-center justify-center rounded-2xl px-6 active:opacity-80 ${CONTAINER[variant]} ${disabled ? "opacity-40" : ""}`}
    >
      <Text className={`text-base font-bold ${LABEL[variant]}`}>{label}</Text>
    </Pressable>
  );
}
