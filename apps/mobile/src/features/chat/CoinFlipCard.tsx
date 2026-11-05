import { Coins } from "lucide-react-native";
import { useState } from "react";
import { Alert, Text, View } from "react-native";

import { errorMessage } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { TextLink } from "@/ui/TextLink";
import { useTheme } from "@/ui/theme";

import { sideLabel, type CoinSide, type Message } from "./api";

const MESSAGES = { INVALID_STATE: "This coin flip already changed." };

async function run(fn: string, args: Record<string, unknown>) {
  const { error } = await supabase.rpc(fn, args);
  if (error) Alert.alert("Couldn't flip the coin", errorMessage(error, MESSAGES));
}

// Either side proposes a coin flip in the chat (CHT-9).
export const proposeCoinFlip = (chatId: string) => run("propose_coin_flip", { p_chat_id: chatId });

// A coin flip at its latest step: the other side calls heads or tails, and the server flips. The chat
// updates through the system message each step posts.
export function CoinFlipCard({
  meta,
  myId,
  partnerName,
}: {
  meta: NonNullable<Message["meta"]>;
  myId: string;
  partnerName: string;
}) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const name = (id?: string) => (id === myId ? "You" : partnerName);
  const act = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true);
    await run(fn, { p_flip_id: meta.flip_id, ...args });
    setBusy(false);
  };

  let body;
  if (meta.status === "flipped") {
    // The caller wins on a right call; otherwise the proposer, who is always the other side, does.
    const iWin = (meta.user_id === myId) === (meta.call === meta.result);
    body = (
      <>
        <Text className="text-[28px] font-extrabold text-ink">{sideLabel(meta.result)}</Text>
        <Text className="text-[15px] text-ink">
          {name(meta.user_id)} called {sideLabel(meta.call)} · {iWin ? "You win" : `${partnerName} wins`}
        </Text>
      </>
    );
  } else if (meta.user_id === myId) {
    body = (
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 text-[15px] text-muted">Waiting for {partnerName} to call it</Text>
        <TextLink label="Cancel" onPress={() => void act("cancel_coin_flip", {})} />
      </View>
    );
  } else {
    body = (
      <>
        <Text className="text-[15px] text-ink">{partnerName} wants to flip a coin. Call it:</Text>
        <View className="flex-row gap-2">
          {(["heads", "tails"] as CoinSide[]).map((side) => (
            <View key={side} className="flex-1">
              <Button
                variant="secondary"
                label={sideLabel(side)}
                disabled={busy}
                onPress={() => void act("call_coin_flip", { p_call: side })}
              />
            </View>
          ))}
        </View>
      </>
    );
  }

  return (
    <View className="my-2 gap-2 rounded-2xl border border-line px-4 py-3">
      <View className="flex-row items-center gap-2">
        <Coins size={18} color={colors.ink} />
        <Text className="text-[15px] font-extrabold text-ink">Coin flip</Text>
      </View>
      {body}
    </View>
  );
}
