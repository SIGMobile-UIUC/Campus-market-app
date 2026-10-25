import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import { formatPrice } from "@/lib/format";
import { Button } from "@/ui/Button";
import { Menu } from "@/ui/Menu";
import { TextLink } from "@/ui/TextLink";

import {
  CANCEL_REASONS,
  canConfirmNow,
  canReviewNow,
  isLateCancel,
  formatMeet,
  placeOf,
  tradeAction,
  type Trade,
} from "./api";

const TITLE: Record<Trade["status"], string> = {
  proposed: "Trade proposed",
  accepted: "Trade accepted",
  disputed: "Problem reported",
  completed: "Trade completed",
  declined: "Proposal declined",
  withdrawn: "Proposal withdrawn",
  cancelled: "Trade cancelled",
  expired: "Trade expired",
  failed: "Trade failed",
};

// The trade card in the chat (CHT-3): items, price, meetup and the actions for the trade's current
// state. Tapping it opens the trade details.
export function TradeCard({
  trade,
  myId,
  partnerName,
  onChanged,
}: {
  trade: Trade;
  myId: string;
  partnerName: string;
  onChanged: () => void;
}) {
  const shown = trade.items.slice(0, 3);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${TITLE[trade.status]}, ${formatPrice(trade.total_cents)}, open trade details`}
      onPress={() => router.push({ pathname: "/trade/[id]", params: { id: trade.id } })}
      className="my-2 overflow-hidden rounded-2xl border border-line"
    >
      <View className="bg-primary px-4 py-2.5">
        <Text className="text-[15px] font-extrabold text-on-primary">{TITLE[trade.status]}</Text>
      </View>
      <View className="gap-1.5 px-4 py-3">
        {shown.map((item) => (
          <View key={item.line} className="flex-row justify-between gap-3">
            <Text className="flex-1 text-[15px] text-ink" numberOfLines={1}>
              {item.name}
            </Text>
            <Text className="text-[15px] text-muted">{formatPrice(item.price_cents)}</Text>
          </View>
        ))}
        {trade.items.length > shown.length ? (
          <Text className="text-[13px] text-muted">+{trade.items.length - shown.length} more</Text>
        ) : null}
        <View className="flex-row justify-between border-t border-line pt-1.5">
          <Text className="text-[15px] font-bold text-ink">Total</Text>
          <Text className="text-[15px] font-extrabold text-ink">{formatPrice(trade.total_cents)}</Text>
        </View>
        <Text className="text-[13px] text-muted">
          {formatMeet(trade.meet_at)} · {placeOf(trade)}
        </Text>
        <TradeActions trade={trade} myId={myId} partnerName={partnerName} onChanged={onChanged} />
      </View>
    </Pressable>
  );
}

// What the caller can do now (5.2): answer or withdraw a proposal, confirm or cancel an accepted trade.
export function TradeActions({
  trade,
  myId,
  partnerName,
  onChanged,
}: {
  trade: Trade;
  myId: string;
  partnerName: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const run = async (fn: string, args: Record<string, unknown> = {}) => {
    setBusy(true);
    const result = await tradeAction<{ completed?: boolean }>(fn, { p_trade_id: trade.id, ...args });
    setBusy(false);
    onChanged();
    return result;
  };

  if (trade.status === "proposed") {
    return trade.proposed_by === myId ? (
      <View className="flex-row items-center justify-between pt-1">
        <Text className="flex-1 text-[13px] text-muted">Waiting for {partnerName} to answer</Text>
        <TextLink label="Withdraw" onPress={() => void run("withdraw_trade")} />
      </View>
    ) : (
      <View className="flex-row gap-2 pt-1">
        <View className="flex-1">
          <Button
            variant="secondary"
            label="Decline"
            disabled={busy}
            onPress={() => void run("decline_trade")}
          />
        </View>
        <View className="flex-1">
          <Button label="Accept" disabled={busy} onPress={() => void run("accept_trade")} />
        </View>
      </View>
    );
  }

  if (trade.status === "accepted") {
    const confirmed = trade.trade_confirmations.some((c) => c.user_id === myId);
    const open = canConfirmNow(trade);
    const cancel = (reason: string) => {
      const late = isLateCancel(trade);
      const go = () => void run("cancel_trade", { p_reason: reason });
      if (!late) return go();
      Alert.alert(
        "Cancel this close to the meetup?",
        "Cancelling within 2 hours of the meetup counts as a late cancel and lowers your grade.",
        [
          { text: "Keep the trade", style: "cancel" },
          { text: "Cancel trade", style: "destructive", onPress: go },
        ],
      );
    };
    return (
      <View className="gap-1 pt-1">
        {confirmed ? (
          <Text className="text-[13px] text-muted">You marked it completed. Waiting for {partnerName}.</Text>
        ) : (
          <>
            <Button
              label="Completed"
              disabled={busy || !open}
              onPress={() =>
                void run("confirm_trade").then((result) => {
                  // The completion moment leads to the review (spec 3.8). ponytail: the points toast joins with DB-12.
                  if (result?.completed)
                    router.push({ pathname: "/review/[tradeId]", params: { tradeId: trade.id } });
                })
              }
            />
            {open ? null : (
              <Text className="text-center text-[12px] text-muted">Opens 30 minutes before the meetup</Text>
            )}
          </>
        )}
        <TextLink label="Cancel trade" onPress={() => setCancelling(true)} />
        <Menu
          visible={cancelling}
          title="Why are you cancelling?"
          onClose={() => setCancelling(false)}
          options={CANCEL_REASONS.map((reason) => ({ label: reason, onPress: () => cancel(reason) }))}
        />
      </View>
    );
  }

  if (trade.status === "completed") {
    if (trade.reviews.some((r) => r.reviewer_id === myId)) {
      return <Text className="pt-1 text-[13px] text-muted">You reviewed this trade.</Text>;
    }
    return canReviewNow(trade) ? (
      <View className="pt-1">
        <Button
          variant="secondary"
          label="Leave a review"
          onPress={() => router.push({ pathname: "/review/[tradeId]", params: { tradeId: trade.id } })}
        />
      </View>
    ) : null;
  }
  if (trade.status === "disputed") {
    return (
      <Text className="pt-1 text-[13px] text-muted">A problem was reported. An admin will review it.</Text>
    );
  }
  if (trade.status === "cancelled" && trade.cancel_reason) {
    return (
      <Text className="pt-1 text-[13px] text-muted">
        {trade.cancelled_by === myId ? "You" : partnerName} cancelled: {trade.cancel_reason}
      </Text>
    );
  }
  return null;
}
