import type { ComponentProps } from "react";
import { router, type Tabs } from "expo-router";
import { House, LayoutGrid, MessageCircle, Plus, User, type LucideIcon } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "./theme";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const ICONS: Record<string, { Icon: LucideIcon; label: string }> = {
  index: { Icon: House, label: "Home" },
  categories: { Icon: LayoutGrid, label: "Categories" },
  chats: { Icon: MessageCircle, label: "Chats" },
  me: { Icon: User, label: "Me" },
};

// Four tabs with a raised Sell button in the middle; Sell opens a sheet instead of a tab (spec 3.2).
export function TabBar({ state, navigation }: TabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const tab = (index: number) => {
    const route = state.routes[index];
    const { Icon, label } = ICONS[route.name];
    const focused = state.index === index;
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        onPress={() => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        }}
        className="min-w-14 items-center gap-0.5"
      >
        <Icon size={24} color={focused ? colors.ink : colors.muted} strokeWidth={2} />
        <Text className={`text-[11px] ${focused ? "font-extrabold text-ink" : "text-muted"}`}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View
      className="flex-row items-end justify-around border-t border-line bg-bg px-1.5 pt-2"
      style={{ paddingBottom: Math.max(insets.bottom, 12) }}
    >
      {tab(0)}
      {tab(1)}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sell"
        onPress={() => router.push("/sell")}
        className="-mt-7 min-w-16 items-center gap-1"
      >
        <View className="h-[58px] w-[58px] items-center justify-center rounded-full border-4 border-bg bg-accent">
          <Plus size={26} color={colors.onAccent} strokeWidth={2.6} />
        </View>
        <Text className="text-[11px] font-extrabold text-ink">Sell</Text>
      </Pressable>
      {tab(2)}
      {tab(3)}
    </View>
  );
}
