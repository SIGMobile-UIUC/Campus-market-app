import { router } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { categoryIcon, useCategories } from "@/features/catalog/categories";
import { useTheme } from "@/ui/theme";

// Categories tab (spec 3.3, DSC-13): categories on the left, the chosen one's subcategories on the right.
// Later: per-subcategory counts and popular searches need aggregate queries (DB-15).
export default function Categories() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { categories, failed } = useCategories();
  const [chosen, setChosen] = useState<string | null>(null);
  const category = categories.find((c) => c.id === chosen) ?? categories[0];

  const open = (subcategory?: string) =>
    category &&
    router.push({
      pathname: "/browse",
      params: { category: category.id, ...(subcategory ? { subcategory } : {}) },
    });

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top + 12 }}>
      <Text accessibilityRole="header" className="px-5 pb-3 text-2xl font-extrabold text-ink">
        Categories
      </Text>
      {failed ? <Text className="px-5 text-danger">{"We couldn't load categories."}</Text> : null}
      <View className="flex-1 flex-row border-t border-line">
        <ScrollView className="w-[42%] flex-none bg-surface">
          {categories.map((c) => {
            const Icon = categoryIcon(c.icon);
            const selected = c.id === category?.id;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setChosen(c.id)}
                className={`min-h-14 flex-row items-center gap-2.5 px-3.5 py-2.5 ${selected ? "bg-bg" : ""}`}
              >
                <Icon size={20} color={selected ? colors.ink : colors.muted} strokeWidth={1.8} />
                <Text className={`flex-1 text-[13px] ${selected ? "font-extrabold text-ink" : "text-muted"}`}>
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
          {category ? (
            <>
              <Row label={`All ${category.label.toLowerCase()}`} bold onPress={() => open()} />
              {category.subcategories.map((s) => (
                <Row key={s.id} label={s.label} onPress={() => open(s.id)} />
              ))}
            </>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

function Row({ label, bold = false, onPress }: { label: string; bold?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="min-h-14 flex-row items-center border-b border-line px-4"
    >
      <Text className={`flex-1 text-[15px] text-ink ${bold ? "font-extrabold" : ""}`}>{label}</Text>
      <ChevronRight size={16} color={colors.muted} />
    </Pressable>
  );
}
