import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";

import { OWN_LISTING_SELECT, rowToCard, type OwnListingRow } from "@/features/listings/types";
import { supabase } from "@/lib/supabase";
import { Header } from "@/ui/Header";
import { ListingCard } from "@/ui/ListingCard";

// Listings the user saved (DSC-4). The embed applies the listings policy, so a listing that was
// deleted, hidden or is no longer visible drops out on its own.
async function fetchFavorites(): Promise<OwnListingRow[] | null> {
  const { data, error } = await supabase
    .from("favorites")
    .select(`created_at, listing:listings(${OWN_LISTING_SELECT}, deleted_at)`)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return null;
  return (data as unknown as { listing: (OwnListingRow & { deleted_at: string | null }) | null }[])
    .map((row) => row.listing)
    .filter((listing): listing is OwnListingRow & { deleted_at: null } => !!listing && !listing.deleted_at);
}

export default function Favorites() {
  const [rows, setRows] = useState<OwnListingRow[] | null | undefined>(undefined);

  // Refetched on focus, so an unsaved listing is gone when coming back from it.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void fetchFavorites().then((next) => alive && setRows(next));
      return () => {
        alive = false;
      };
    }, []),
  );

  return (
    <>
      <Header title="Favorites" />
      {rows === undefined ? (
        <ActivityIndicator className="flex-1 bg-bg" />
      ) : (
        <FlatList
          className="flex-1 bg-bg"
          data={rows ?? []}
          keyExtractor={(row) => row.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
          ItemSeparatorComponent={() => <View className="h-px bg-line" />}
          renderItem={({ item }) => (
            <ListingCard
              card={rowToCard(item)}
              onPress={() => router.push({ pathname: "/listing/[id]", params: { id: item.id } })}
            />
          )}
          ListEmptyComponent={
            <Text className="px-4 pt-12 text-center text-base text-muted">
              {rows === null
                ? "We couldn't load your favorites."
                : "Tap the heart on a listing to save it here."}
            </Text>
          }
        />
      )}
    </>
  );
}
