import { ChevronRight } from "lucide-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CATEGORIES } from "@/features/catalog/catalog";
import { useTheme } from "@/ui/theme";

export default function Categories() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 32 }}
    >
      <Text className="px-5 pb-3 text-2xl font-extrabold text-ink">Categories</Text>
      {CATEGORIES.map(({ id, label, Icon }) => (
        <Pressable
          key={id}
          accessibilityRole="button"
          className="flex-row items-center gap-3.5 border-b border-line px-5 py-3.5"
        >
          <View className="h-10 w-10 items-center justify-center rounded-xl bg-surface">
            <Icon size={22} color={colors.ink} strokeWidth={1.8} />
          </View>
          <Text className="flex-1 text-base text-ink">{label}</Text>
          <ChevronRight size={18} color={colors.muted} />
        </Pressable>
      ))}
    </ScrollView>
  );
}
