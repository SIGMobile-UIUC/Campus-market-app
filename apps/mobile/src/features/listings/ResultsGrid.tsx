import { router } from "expo-router";
import type { ReactElement } from "react";
import { ActivityIndicator, FlatList, RefreshControl, Text, useWindowDimensions, View } from "react-native";

import { ListingCard } from "@/ui/ListingCard";
import { TextLink } from "@/ui/TextLink";

import { toCard, type FeedRow } from "./types";
import type { useListings } from "./useListings";

// Two-column results (spec 3.3, Category results) with pull to refresh and endless scroll.
export function ResultsGrid({
  results,
  header,
  empty,
}: {
  results: ReturnType<typeof useListings>;
  header?: ReactElement;
  empty: string;
}) {
  const { rows, loading, error, refreshing, loadMore, refresh } = results;
  // Fixed width, so a tile alone in the last row keeps its size: 20 pt gutters and a 12 pt gap.
  const tileWidth = (useWindowDimensions().width - 52) / 2;
  return (
    <FlatList
      data={rows}
      keyExtractor={(row: FeedRow) => row.id}
      numColumns={2}
      columnWrapperStyle={{ gap: 12, paddingHorizontal: 20 }}
      renderItem={({ item }) => (
        <View style={{ width: tileWidth }}>
          <ListingCard
            variant="tile"
            card={toCard(item)}
            onPress={() => router.push({ pathname: "/listing/[id]", params: { id: item.id } })}
          />
        </View>
      )}
      ListHeaderComponent={header}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator className="py-10" />
        ) : (
          <View className="items-center gap-2 px-8 py-10">
            <Text className="text-center text-base text-muted">
              {error ? "We couldn't load listings." : empty}
            </Text>
            {error ? <TextLink label="Try again" onPress={() => void refresh()} /> : null}
          </View>
        )
      }
      onEndReached={() => void loadMore()}
      onEndReachedThreshold={0.6}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      contentContainerStyle={{ paddingBottom: 32 }}
    />
  );
}
