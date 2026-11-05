import { Coins } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

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

const TURNS = 5;
const TOSS_MS = 1400;

// The coin goes up, turns over TURNS times and lands on the result. Its height follows the cosine of the
// turn and the face changes at each edge, which reads as a flip without 3D transforms.
function Coin({ result, toss }: { result: CoinSide; toss: boolean }) {
  const { colors } = useTheme();
  const end = 360 * TURNS + (result === "heads" ? 0 : 180);
  const turn = useSharedValue(toss ? 0 : end);
  useEffect(() => {
    if (toss) turn.value = withTiming(end, { duration: TOSS_MS, easing: Easing.out(Easing.cubic) });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const coin = useAnimatedStyle(() => {
    const cos = Math.cos((turn.value * Math.PI) / 180);
    return {
      transform: [
        { translateY: -56 * Math.sin((Math.PI * turn.value) / end) },
        { scaleY: Math.max(0.06, Math.abs(cos)) },
      ],
    };
  });
  const heads = useAnimatedStyle(() => ({ opacity: Math.cos((turn.value * Math.PI) / 180) >= 0 ? 1 : 0 }));
  const tails = useAnimatedStyle(() => ({ opacity: Math.cos((turn.value * Math.PI) / 180) < 0 ? 1 : 0 }));
  const face = { position: "absolute", fontSize: 26, fontWeight: "800", color: colors.onAccent } as const;
  return (
    <View className="h-32 justify-end">
      <Animated.View
        style={[
          {
            width: 64,
            height: 64,
            borderRadius: 32,
            borderWidth: 3,
            borderColor: colors.ink,
            backgroundColor: colors.accent,
            alignItems: "center",
            justifyContent: "center",
          },
          coin,
        ]}
      >
        <Animated.Text style={[face, heads]}>H</Animated.Text>
        <Animated.Text style={[face, tails]}>T</Animated.Text>
      </Animated.View>
    </View>
  );
}

// A coin flip at its latest step: the other side calls heads or tails, and the server flips. The chat
// updates through the system message each step posts. A result posted in the last few seconds is tossed
// first; one seen before just shows.
export function CoinFlipCard({
  meta,
  myId,
  partnerName,
  postedAt,
}: {
  meta: NonNullable<Message["meta"]>;
  myId: string;
  partnerName: string;
  postedAt: string;
}) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [toss] = useState(() => Date.now() - new Date(postedAt).getTime() < 15_000);
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
      <View className="items-center">
        <Coin result={meta.result ?? "heads"} toss={toss} />
        <Animated.View entering={toss ? FadeIn.delay(TOSS_MS) : undefined} className="items-center pt-2">
          <Text className="text-[28px] font-extrabold text-ink">{sideLabel(meta.result)}</Text>
          <Text className="text-center text-[15px] text-ink">
            {name(meta.user_id)} called {sideLabel(meta.call)} · {iWin ? "You win" : `${partnerName} wins`}
          </Text>
        </Animated.View>
      </View>
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
