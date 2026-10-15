import { Pressable, Switch, Text, View } from "react-native";

import { useTheme } from "./theme";

// A labeled switch whose whole row is the touch target and the screen-reader element.
export function Toggle({
  label,
  detail,
  value,
  onChange,
}: {
  label: string;
  detail?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      className="flex-row items-center gap-3"
    >
      <View className="flex-1">
        <Text className="text-[15px] font-bold text-ink">{label}</Text>
        {detail ? <Text className="text-[13px] text-muted">{detail}</Text> : null}
      </View>
      {/* The row is the switch for screen readers; hiding this one avoids a second focus stop. */}
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent }}
        thumbColor="#FFFFFF"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      />
    </Pressable>
  );
}
