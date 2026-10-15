import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { categoryIcon, useCategories, type CategoryDef } from "@/features/catalog/categories";
import { useTheme } from "@/ui/theme";

export type CategoryValue = { category: string; subcategory: string };

// A row that opens a two-level list: category, then subcategory (spec 1.7.5).
export function CategoryField({
  value,
  onChange,
  error,
}: {
  value: CategoryValue | null;
  onChange: (value: CategoryValue) => void;
  error?: string | null;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { categories, failed } = useCategories();
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState<CategoryDef | null>(null);

  const chosen = categories.find((c) => c.id === value?.category);
  const sub = chosen?.subcategories.find((s) => s.id === value?.subcategory);
  const close = () => {
    setOpen(false);
    setBrowsing(null);
  };

  return (
    <View className="gap-1.5">
      <Text className="text-sm font-bold text-ink">Category</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        className={`h-14 flex-row items-center rounded-xl border px-4 ${error ? "border-danger" : "border-line"}`}
      >
        <Text className={`flex-1 text-[17px] ${chosen ? "text-ink" : "text-muted"}`}>
          {chosen && sub ? `${chosen.label} › ${sub.label}` : "Choose a category"}
        </Text>
        <ChevronRight size={18} color={colors.muted} />
      </Pressable>
      {error ? <Text className="text-sm text-danger">{error}</Text> : null}

      <Modal visible={open} animationType="slide" onRequestClose={close}>
        <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
          <View className="h-14 flex-row items-center px-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={browsing ? "All categories" : "Close"}
              onPress={() => (browsing ? setBrowsing(null) : close())}
              className="h-11 w-11 items-center justify-center"
            >
              <ChevronLeft size={24} color={colors.ink} />
            </Pressable>
            <Text accessibilityRole="header" className="text-lg font-extrabold text-ink">
              {browsing?.label ?? "Category"}
            </Text>
          </View>
          {failed ? <Text className="px-6 text-danger">{"We couldn't load categories."}</Text> : null}
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
            {browsing
              ? browsing.subcategories.map((s) => (
                  <Row
                    key={s.id}
                    label={s.label}
                    onPress={() => {
                      onChange({ category: browsing.id, subcategory: s.id });
                      close();
                    }}
                  />
                ))
              : categories.map((c) => {
                  const Icon = categoryIcon(c.icon);
                  return (
                    <Row key={c.id} label={c.label} onPress={() => setBrowsing(c)} chevron>
                      <Icon size={22} color={colors.ink} strokeWidth={1.7} />
                    </Row>
                  );
                })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function Row({
  label,
  onPress,
  chevron = false,
  children,
}: {
  label: string;
  onPress: () => void;
  chevron?: boolean;
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="min-h-14 flex-row items-center gap-3 px-6 active:bg-surface"
    >
      {children}
      <Text className="flex-1 text-base text-ink">{label}</Text>
      {chevron ? <ChevronRight size={18} color={colors.muted} /> : null}
    </Pressable>
  );
}
