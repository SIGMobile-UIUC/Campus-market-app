import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { useAccount } from "@/features/account/account";
import { fetchTrades, formatMeet, placeOf, STATUS_LABEL, type Trade } from "@/features/trades/api";
import { TradeActions } from "@/features/trades/TradeCard";
import { formatPrice } from "@/lib/format";
import { GradeBadge } from "@/ui/GradeBadge";
import { Header } from "@/ui/Header";
import { TextLink } from "@/ui/TextLink";

// Trade details (spec 3.3): status timeline, items and price, meetup time and place, and the actions
// for the current state. "I'm here" (P1) and Report a problem come with disputes (DB-14).
export default function TradeDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAccount();
  const myId = session?.user.id ?? "";
  const [trade, setTrade] = useState<Trade | null | undefined>(undefined);

  const load = useCallback(() => fetchTrades([id]).then((rows) => setTrade(rows?.[0] ?? null)), [id]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (trade === undefined) {
    return (
      <>
        <Header title="Trade" />
        <ActivityIndicator className="flex-1 bg-bg" />
      </>
    );
  }
  if (trade === null) {
    return (
      <>
        <Header title="Trade" />
        <View className="flex-1 items-center gap-2 bg-bg px-8 pt-16">
          <Text className="text-center text-base text-muted">{"We couldn't load this trade."}</Text>
          <TextLink label="Try again" onPress={() => void load()} />
        </View>
      </>
    );
  }

  const imSeller = trade.seller_id === myId;
  const partner = imSeller ? trade.buyer : trade.seller;
  const partnerName = partner?.display_name ?? "Deleted user";
  const who = (userId: string | null) => (userId === myId ? "You" : partnerName);
  const steps = [
    { label: `Proposed by ${who(trade.proposed_by)}`, at: trade.proposed_at },
    trade.accepted_at ? { label: "Accepted", at: trade.accepted_at } : null,
    ...trade.trade_confirmations.map((c) => ({ label: `${who(c.user_id)} marked it completed`, at: null })),
    trade.completed_at ? { label: "Completed", at: trade.completed_at } : null,
    trade.closed_at && !trade.completed_at
      ? { label: STATUS_LABEL[trade.status], at: trade.closed_at }
      : null,
  ].filter(Boolean) as { label: string; at: string | null }[];

  return (
    <View className="flex-1 bg-bg">
      <Header title="Trade" />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
        <View className="gap-1">
          <Text className="text-[13px] font-bold uppercase text-muted">{STATUS_LABEL[trade.status]}</Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push({ pathname: "/listing/[id]", params: { id: trade.listing_id } })}
          >
            <Text accessibilityRole="header" className="text-[22px] font-extrabold text-ink">
              {trade.listing?.title ?? "Listing removed"}
            </Text>
          </Pressable>
          <View className="flex-row items-center gap-2">
            <Text className="text-[15px] text-ink">
              {imSeller ? "Buyer" : "Seller"}: {partnerName}
            </Text>
            {partner ? <GradeBadge tier={partner.tier} /> : null}
          </View>
        </View>

        <View className="gap-1.5 rounded-2xl bg-surface p-4">
          {trade.items.map((item) => (
            <View key={item.line} className="flex-row justify-between gap-3">
              <Text className="flex-1 text-[15px] text-ink">{item.name}</Text>
              <Text className="text-[15px] text-muted">{formatPrice(item.price_cents)}</Text>
            </View>
          ))}
          <View className="flex-row justify-between border-t border-line pt-1.5">
            <Text className="text-[15px] font-bold text-ink">Total</Text>
            <Text className="text-[15px] font-extrabold text-ink">{formatPrice(trade.total_cents)}</Text>
          </View>
        </View>

        <View className="gap-1">
          <Text className="text-sm font-bold text-ink">Meetup</Text>
          <Text className="text-[15px] text-ink">{formatMeet(trade.meet_at)}</Text>
          <Text className="text-[15px] text-ink">{placeOf(trade)}</Text>
        </View>

        <TradeActions trade={trade} myId={myId} partnerName={partnerName} onChanged={() => void load()} />

        <View className="gap-2">
          <Text className="text-sm font-bold text-ink">Timeline</Text>
          {steps.map((step, i) => (
            <View key={i} className="flex-row items-center gap-3">
              <View className="h-2 w-2 rounded-full bg-ink" />
              <Text className="flex-1 text-[15px] text-ink">{step.label}</Text>
              {step.at ? <Text className="text-[13px] text-muted">{formatMeet(step.at)}</Text> : null}
            </View>
          ))}
        </View>

        <TextLink
          label="Open chat"
          onPress={() => router.push({ pathname: "/chat/[id]", params: { id: trade.chat_id } })}
        />
      </ScrollView>
    </View>
  );
}
