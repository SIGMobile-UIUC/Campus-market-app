import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";

import type { Wallet as WalletState } from "@/features/points/points";
import { formatAgo } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { Header } from "@/ui/Header";

type Row = { id: number; delta: number; label: string; created_at: string };
type Page = { rows: Row[]; next_cursor: number | null };

async function load(cursor: number | null = null) {
  const [wallet, history] = await Promise.all([
    cursor ? null : supabase.rpc("get_wallet"),
    supabase.rpc("points_history", { p_cursor: cursor }),
  ]);
  if (wallet?.error || history.error) return null;
  return { wallet: wallet?.data as WalletState | undefined, page: history.data as Page };
}

// Wallet (PTS-1, spec 3.3): the balance (red with an explanation when negative), today's earnings against
// the cap, and every change with its reason.
export default function Wallet() {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [page, setPage] = useState<Page | null | undefined>(undefined);
  const [more, setMore] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void load().then((result) => {
        setWallet(result?.wallet ?? null);
        setPage(result ? result.page : null);
      });
    }, []),
  );

  const loadMore = async () => {
    if (!page?.next_cursor || more) return;
    setMore(true);
    const next = await load(page.next_cursor);
    setMore(false);
    if (next) setPage({ rows: [...page.rows, ...next.page.rows], next_cursor: next.page.next_cursor });
  };

  return (
    <View className="flex-1 bg-bg">
      <Header title="Wallet" />
      {page === undefined ? <ActivityIndicator className="py-8" /> : null}
      {page === null ? (
        <Text className="px-8 pt-16 text-center text-base text-muted">{"We couldn't load your wallet."}</Text>
      ) : null}
      {page && wallet ? (
        <FlatList
          data={page.rows}
          keyExtractor={(row) => String(row.id)}
          onEndReached={() => void loadMore()}
          ListHeaderComponent={
            <View className="gap-1 pb-4 pt-2">
              <Text className={`text-4xl font-extrabold ${wallet.balance < 0 ? "text-danger" : "text-ink"}`}>
                {wallet.balance} pts
              </Text>
              {wallet.balance < 0 ? (
                <Text className="text-[13px] text-danger">
                  Points were taken back after a dispute. New points pay this off first.
                </Text>
              ) : null}
              <Text className="text-[13px] text-muted">
                Earned today {wallet.earned_today} of {wallet.daily_cap}
              </Text>
            </View>
          }
          ListEmptyComponent={
            <Text className="py-8 text-center text-muted">Complete trades and check in to earn points.</Text>
          }
          ListFooterComponent={more ? <ActivityIndicator className="py-4" /> : null}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
          renderItem={({ item }) => (
            <View className="flex-row items-center border-b border-line py-3">
              <View className="flex-1">
                <Text className="text-[15px] text-ink">{item.label}</Text>
                <Text className="text-[13px] text-muted">{formatAgo(item.created_at)}</Text>
              </View>
              <Text className={`text-[15px] font-bold ${item.delta > 0 ? "text-success" : "text-ink"}`}>
                {item.delta > 0 ? `+${item.delta}` : item.delta}
              </Text>
            </View>
          )}
        />
      ) : null}
    </View>
  );
}
