import { router } from "expo-router";
import { ChevronRight, Megaphone } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { useAccount } from "@/features/account/account";
import { MODES } from "@/features/catalog/catalog";
import { useCategories } from "@/features/catalog/categories";
import { MarketChips, useScope } from "@/features/listings/Toolbar";
import { WantedCard } from "@/features/listings/WantedCard";
import { useListings } from "@/features/listings/useListings";
import { Chip } from "@/ui/Chip";
import { Header } from "@/ui/Header";
import { TextLink } from "@/ui/TextLink";

const WANTED = MODES.find((m) => m.id === "wanted")!;

// Wanted board (spec 3.3, LST-3): a "Post a request" banner, category chips and request cards.
export default function WantedBoard() {
  const scope = useScope();
  const { account } = useAccount();
  const { categories } = useCategories();
  const [category, setCategory] = useState<string | null>(null);
  const results = useListings({ scope, filters: { mode: "wanted", category: category ?? undefined } });

  return (
    <>
      <Header title="Wanted" />
      <FlatList
        className="flex-1 bg-bg"
        data={results.rows}
        keyExtractor={(row) => row.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 12 }}
        renderItem={({ item }) => (
          <WantedCard row={item} mine={item.owner.display_name === account?.display_name} />
        )}
        onEndReached={() => void results.loadMore()}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl refreshing={results.refreshing} onRefresh={() => void results.refresh()} />
        }
        ListHeaderComponent={
          <View className="gap-3 pb-1 pt-2">
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/post/wanted")}
              className="flex-row items-center gap-3 rounded-2xl p-4"
              style={{ backgroundColor: WANTED.tint }}
            >
              <Megaphone size={24} color={WANTED.ink} />
              <View className="flex-1">
                <Text className="text-base font-extrabold" style={{ color: WANTED.ink }}>
                  Looking for something?
                </Text>
                <Text className="text-[13px]" style={{ color: WANTED.ink }}>
                  Post a request with a budget. Sellers who have it reach out.
                </Text>
              </View>
              <ChevronRight size={20} color={WANTED.ink} />
            </Pressable>
            <View className="flex-row gap-1.5">
              <MarketChips />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              <Chip label="All" selected={!category} onPress={() => setCategory(null)} />
              {categories.map((c) => (
                <Chip
                  key={c.id}
                  label={c.label}
                  selected={category === c.id}
                  onPress={() => setCategory(c.id)}
                />
              ))}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={
          results.loading ? (
            <ActivityIndicator className="py-10" />
          ) : (
            <View className="items-center gap-2 py-10">
              <Text className="text-center text-base text-muted">
                {results.error ? "We couldn't load requests." : "No requests here yet."}
              </Text>
              {results.error ? <TextLink label="Try again" onPress={() => void results.refresh()} /> : null}
            </View>
          )
        }
      />
    </>
  );
}
