import { router, useLocalSearchParams } from "expo-router";
import { Star } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import { useAccount } from "@/features/account/account";
import { fetchTrades, type Trade } from "@/features/trades/api";
import { Section } from "@/features/trades/MeetupFields";
import { errorMessage } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { Field } from "@/ui/Field";
import { Header } from "@/ui/Header";
import { Screen } from "@/ui/Screen";
import { useTheme } from "@/ui/theme";

type Tag = { id: string; label: string };
type Tags = { positive: Tag[]; negative: Tag[] };

async function load(tradeId: string): Promise<{ trade: Trade; tags: Tags } | null> {
  const [trades, { data }] = await Promise.all([
    fetchTrades([tradeId]),
    supabase.from("app_config").select("value").eq("key", "review_tags").maybeSingle(),
  ]);
  if (!trades?.[0] || !data) return null;
  return { trade: trades[0], tags: data.value as Tags };
}

// Review sheet (REP-1, APP-11): 1 to 5 stars, tags from the configured list and an optional comment,
// once per side within 14 days of completion. ponytail: the review points toast joins with DB-12.
export default function Review() {
  const { tradeId } = useLocalSearchParams<{ tradeId: string }>();
  const { session } = useAccount();
  const { colors } = useTheme();
  const [context, setContext] = useState<Awaited<ReturnType<typeof load>> | undefined>(undefined);
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    void load(tradeId).then(setContext);
  }, [tradeId]);

  if (context === undefined) {
    return (
      <>
        <Header title="Leave a review" />
        <ActivityIndicator className="flex-1 bg-bg" />
      </>
    );
  }
  if (context === null) {
    return (
      <>
        <Header title="Leave a review" />
        <Text className="flex-1 bg-bg px-8 pt-16 text-center text-base text-muted">
          {"We couldn't load this trade."}
        </Text>
      </>
    );
  }

  const { trade } = context;
  const partner = trade.seller_id === session?.user.id ? trade.buyer : trade.seller;
  const partnerName = partner?.display_name ?? "Deleted user";
  const toggle = (id: string) =>
    setTags((current) => (current.includes(id) ? current.filter((t) => t !== id) : [...current, id]));

  const submit = async () => {
    setSending(true);
    const { error } = await supabase.rpc("submit_review", {
      p_trade_id: tradeId,
      p_rating: rating,
      p_tags: tags,
      p_comment: comment.trim() || null,
    });
    setSending(false);
    if (error) {
      Alert.alert(
        "Couldn't send your review",
        errorMessage(error, {
          ALREADY_EXISTS: "You already reviewed this trade.",
          WINDOW_CLOSED: "Reviews close 14 days after the trade.",
        }),
      );
      return;
    }
    router.back();
  };

  return (
    <>
      <Header title="Leave a review" />
      <Screen
        underHeader
        footer={<Button label="Send review" disabled={!rating || sending} onPress={() => void submit()} />}
      >
        <View className="gap-1">
          <Text className="text-lg font-extrabold text-ink">How was trading with {partnerName}?</Text>
          <Text className="text-[13px] text-muted">{trade.listing?.title ?? "Listing removed"}</Text>
        </View>
        <View
          className="flex-row justify-center gap-2"
          accessibilityRole="adjustable"
          accessibilityLabel={`Rating, ${rating} of 5`}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityLabel={`${n} ${n === 1 ? "star" : "stars"}`}
              accessibilityState={{ selected: rating === n }}
              onPress={() => setRating(n)}
              hitSlop={6}
            >
              <Star
                size={40}
                color={n <= rating ? colors.warning : colors.line}
                fill={n <= rating ? colors.warning : "transparent"}
              />
            </Pressable>
          ))}
        </View>
        {(["positive", "negative"] as const).map((group) => (
          <Section key={group} label={group === "positive" ? "What went well" : "What could be better"}>
            <View className="flex-row flex-wrap gap-2">
              {context.tags[group].map((tag) => (
                <Chip
                  key={tag.id}
                  label={tag.label}
                  selected={tags.includes(tag.id)}
                  onPress={() => toggle(tag.id)}
                />
              ))}
            </View>
          </Section>
        ))}
        <Field
          label="Comment (optional)"
          value={comment}
          onChangeText={setComment}
          maxLength={500}
          multiline
          style={{ height: 96, textAlignVertical: "top", paddingTop: 12 }}
        />
      </Screen>
    </>
  );
}
