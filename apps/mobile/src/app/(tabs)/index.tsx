import { router } from "expo-router";
import { Bell, ChevronDown, Globe, Search } from "lucide-react-native";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CATEGORIES, MODES } from "@/features/catalog/catalog";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { CategoryTile, ModeTile } from "@/ui/Tiles";
import { useTheme } from "@/ui/theme";

export default function Home() {
  const { campus, market, setMarket, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const inCampus = market === "campus";

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: 32 }}
    >
      <View className="flex-row items-center px-5 pb-1 pt-3">
        <Pressable accessibilityRole="button" className="flex-row items-center gap-2">
          {inCampus ? (
            <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: campus.accent }} />
          ) : (
            <Globe size={18} color={colors.ink} />
          )}
          <Text className="text-xl font-extrabold text-ink">{inCampus ? campus.name : "Open market"}</Text>
          <ChevronDown size={16} color={colors.ink} strokeWidth={2.4} />
        </Pressable>
        <View className="flex-1" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          className="h-11 w-11 items-center justify-center"
        >
          <Bell size={23} color={colors.ink} />
        </Pressable>
      </View>

      <View className="flex-row gap-1.5 px-5 pb-3">
        <Chip label={`${campus.short} only`} selected={inCampus} onPress={() => setMarket("campus")} />
        <Chip label="Open market" selected={!inCampus} onPress={() => setMarket("open")} />
      </View>

      <View className="mx-5 mb-4 h-12 flex-row items-center gap-2.5 rounded-xl bg-surface px-3.5">
        <Search size={20} color={colors.muted} />
        <TextInput
          accessibilityLabel="Search"
          placeholder={inCampus ? `Search ${campus.short} market` : "Search the open market"}
          placeholderTextColor={colors.muted}
          className="flex-1 text-[15px] text-ink"
        />
      </View>

      <View className="flex-row px-2.5 pb-5">
        {MODES.map((mode) => (
          <ModeTile key={mode.id} label={mode.label} Icon={mode.Icon} tint={mode.tint} ink={mode.ink} />
        ))}
      </View>

      <View className="h-2 bg-surface" />

      <View className="flex-row items-baseline justify-between px-5 pb-2 pt-4">
        <Text className="text-lg font-extrabold text-ink">Shop by category</Text>
        <Pressable accessibilityRole="link" onPress={() => router.push("/categories")}>
          <Text className="text-[13px] text-ink">All categories</Text>
        </Pressable>
      </View>
      <View className="flex-row flex-wrap px-2">
        {CATEGORIES.map((category) => (
          <CategoryTile key={category.id} label={category.short} Icon={category.Icon} />
        ))}
      </View>

      <View className="mx-5 mt-6 items-start gap-2 rounded-2xl bg-surface p-5">
        <Text className="text-base font-extrabold text-ink">Nothing listed yet</Text>
        <Text className="text-sm text-muted">
          Picks, move-out sales and wanted requests will show up here.
        </Text>
        <View className="mt-2">
          <Button label="Sell something" onPress={() => router.push("/sell")} />
        </View>
      </View>
    </ScrollView>
  );
}
