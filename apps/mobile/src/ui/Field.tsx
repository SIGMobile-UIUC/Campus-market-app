import { Text, TextInput, View, type TextInputProps } from "react-native";

import { useTheme } from "./theme";

// Labeled text input with a hint or an error under it. Errors are announced to screen readers.
export function Field({
  label,
  hint,
  error,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const { colors } = useTheme();
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-bold text-ink">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        className={`h-14 rounded-xl border bg-bg px-4 text-[17px] text-ink ${error ? "border-danger" : "border-line"}`}
        {...input}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-danger">
          {error}
        </Text>
      ) : hint ? (
        <Text className="text-sm text-muted">{hint}</Text>
      ) : null}
    </View>
  );
}
