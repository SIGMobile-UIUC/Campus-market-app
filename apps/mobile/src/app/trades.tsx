import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";

import { formatMeet, STATUS_LABEL, type TradeStatus } from "@/features/trades/api";
import { formatPrice } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { Chip } from "@/ui/Chip";
import { Header } from "@/ui/Header";
import { TextLink } from "@/ui/TextLink";

type Group = "active" | "completed" | "closed";
type Row = {
  id: string;
  status: TradeStatus;
  total_cents: number;
  meet_at: string;
  listing: { title: string } | null;
  partner: { display_name: string | null } | null;
};
type Page = { rows: Row[]; next_cursor: unknown };

const GROUPS: [Group, string][] = [
  ["active", "Active"],
  ["completed", "Completed"],
  ["closed", "Closed"],
];

async function fetchPage(group: Group, cursor: unknown = null): Promise<Page | null> {
  const { data, error } = await supabase.rpc("my_trades", { p_status_group: group, p_cursor: cursor });
  return error ? null : (data as Page);
}

// My trades (TRD-9): by status group, newest proposal first, with the items' price at the time.
export default function MyTrades() {
  const [group, setGroup] = useState<Group>("active");
  const [page, setPage] = useState<Page | null | undefined>(undefined);
  const [more, setMore] = useState(false);

  const load = useCallback((g: Group) => fetchPage(g).then(setPage), []);
  useFocusEffect(
    useCallback(() => {
      void load(group);
    }, [load, group]),
  );

  const loadMore = async () => {
    if (!page?.next_cursor || more) return;
    setMore(true);
    const next = await fetchPage(group, page.next_cursor);
    setMore(false);
    if (next) setPage({ rows: [...page.rows, ...next.rows], next_cursor: next.next_cursor });
  };

  return (
    <View className="flex-1 bg-bg">
      <Header title="My trades" />
      <View className="flex-row gap-2 px-5 pb-2 pt-3">
        {GROUPS.map(([id, label]) => (
          <Chip
            key={id}
            label={label}
            selected={group === id}
            onPress={() => {
              setGroup(id);
              setPage(undefined);
            }}
          />
        ))}
      </View>
      {page === undefined ? (
        <ActivityIndicator className="flex-1" />
      ) : page === null ? (
        <View className="items-center gap-2 px-8 pt-16">
          <Text className="text-center text-base text-muted">{"We couldn't load your trades."}</Text>
          <TextLink label="Try again" onPress={() => void load(group)} />
        </View>
      ) : (
        <FlatList
          data={page.rows}
          keyExtractor={(row) => row.id}
          onEndReached={() => void loadMore()}
          ListEmptyComponent={
            <Text className="px-5 pt-8 text-center text-base text-muted">No {group} trades.</Text>
          }
          ListFooterComponent={more ? <ActivityIndicator className="py-4" /> : null}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/trade/[id]", params: { id: item.id } })}
              className="gap-0.5 border-b border-line px-5 py-3 active:bg-surface"
            >
              <View className="flex-row justify-between gap-3">
                <Text className="flex-1 text-[15px] font-bold text-ink" numberOfLines={1}>
                  {item.listing?.title ?? "Listing removed"}
                </Text>
                <Text className="text-[15px] font-extrabold text-ink">{formatPrice(item.total_cents)}</Text>
              </View>
              <Text className="text-[13px] text-muted">
                {[
                  STATUS_LABEL[item.status],
                  item.partner?.display_name ?? "Deleted user",
                  formatMeet(item.meet_at),
                ].join(" · ")}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
