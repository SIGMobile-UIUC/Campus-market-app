import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";

import { useAccount } from "@/features/account/account";
import { sendMessage } from "@/features/chat/api";
import { CONDITIONS, conditionLabel } from "@/features/listings/types";
import { PhotoPicker } from "@/features/sell/PhotoPicker";
import { proposeTrade } from "@/features/trades/api";
import { loadSpots, meetupPayload, MeetupFields, NO_MEETUP, Section } from "@/features/trades/MeetupFields";
import { errorMessage } from "@/lib/errors";
import { formatPrice, parsePrice } from "@/lib/format";
import { uploadChatPhoto } from "@/lib/media";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { Field } from "@/ui/Field";
import { Header } from "@/ui/Header";
import { Screen } from "@/ui/Screen";

type Request = { id: string; title: string; budget_cents: number; campus_id: string | null };

async function load(listingId: string) {
  const { data } = await supabase
    .from("listings")
    .select("id, title, budget_cents, campus_id")
    .eq("id", listingId)
    .eq("kind", "wanted")
    .maybeSingle();
  if (!data) return null;
  return { request: data as Request, spots: await loadSpots(data.campus_id) };
}

// Offer sheet (APP-18, spec 3.3), opened by "I have this" or Propose in a chat about a wanted request:
// photos, what is offered, its condition, a price checked against the budget, and the meetup. Sending
// posts the photos and a short note to the chat and proposes the trade, then opens the chat.
export default function Offer() {
  const { listingId, chatId: fromChat } = useLocalSearchParams<{ listingId: string; chatId?: string }>();
  const { session } = useAccount();
  const [context, setContext] = useState<Awaited<ReturnType<typeof load>> | undefined>(undefined);
  const [photos, setPhotos] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [condition, setCondition] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [meetup, setMeetup] = useState(NO_MEETUP);
  const [sending, setSending] = useState(false);
  // Fixed per sheet, so retrying after a failure resends nothing twice: send_message and propose_trade
  // return what they stored for a repeated key, and uploaded photos are kept by local URI.
  const [keys] = useState(() => ({
    request: randomUUID(),
    note: randomUUID(),
    photos: [0, 1, 2].map(() => randomUUID()),
  }));
  const uploaded = useRef(new Map<string, string>());

  useEffect(() => {
    void load(listingId).then(setContext);
  }, [listingId]);

  if (context === undefined) {
    return (
      <>
        <Header title="Make an offer" />
        <ActivityIndicator className="flex-1 bg-bg" />
      </>
    );
  }
  if (context === null) {
    return (
      <>
        <Header title="Make an offer" />
        <Text className="flex-1 bg-bg px-8 pt-16 text-center text-base text-muted">
          {"This request isn't available anymore."}
        </Text>
      </>
    );
  }

  const { request, spots } = context;
  const priceCents = parsePrice(price);
  const where = meetupPayload(meetup);
  const ready = name.trim() !== "" && priceCents !== null && where !== null;
  const budgetHint =
    priceCents === null
      ? `Budget ${formatPrice(request.budget_cents)}`
      : priceCents <= request.budget_cents
        ? `Within the ${formatPrice(request.budget_cents)} budget`
        : `${formatPrice(priceCents - request.budget_cents)} over the ${formatPrice(request.budget_cents)} budget`;

  const send = async () => {
    if (!ready || !session) return;
    setSending(true);
    let chatId = fromChat;
    if (!chatId) {
      const { data, error } = await supabase.rpc("get_or_create_chat", { p_listing_id: request.id });
      if (error) {
        setSending(false);
        Alert.alert(
          "Couldn't send your offer",
          errorMessage(error, { INVALID_STATE: "This request is closed." }),
        );
        return;
      }
      chatId = (data as { chat_id: string }).chat_id;
    }
    try {
      for (const [index, uri] of photos.entries()) {
        const path = uploaded.current.get(uri) ?? (await uploadChatPhoto(chatId, session.user.id, uri));
        uploaded.current.set(uri, path);
        const { error } = await sendMessage(chatId, "image", null, path, keys.photos[index]);
        if (error) throw error;
      }
      const note = `I have this: ${name.trim()}${condition ? `, ${conditionLabel(condition).toLowerCase()} condition` : ""}`;
      const { error } = await sendMessage(chatId, "text", note, null, keys.note);
      if (error) throw error;
    } catch (error) {
      setSending(false);
      Alert.alert("Couldn't send your offer", errorMessage(error));
      return;
    }
    const trade = await proposeTrade(
      chatId,
      { offer_items: [{ name: name.trim(), price_cents: priceCents }], total_cents: priceCents, ...where },
      keys.request,
    );
    setSending(false);
    if (!trade) return;
    if (fromChat) router.back();
    else router.replace({ pathname: "/chat/[id]", params: { id: chatId } });
  };

  return (
    <>
      <Header title="Make an offer" />
      <Screen
        underHeader
        footer={<Button label="Send offer" disabled={!ready || sending} onPress={() => void send()} />}
      >
        <View className="gap-0.5">
          <Text className="text-[13px] text-muted">Looking for</Text>
          <Text className="text-lg font-extrabold text-ink">{request.title}</Text>
        </View>
        <PhotoPicker uris={photos} onChange={setPhotos} max={3} />
        <Field
          label="What you offer"
          value={name}
          onChangeText={setName}
          maxLength={80}
          placeholder="TI-84 Plus"
        />
        <Section label="Condition">
          <View className="flex-row flex-wrap gap-2">
            {CONDITIONS.map(([id, label]) => (
              <Chip
                key={id}
                label={label}
                selected={condition === id}
                onPress={() => setCondition(condition === id ? null : id)}
              />
            ))}
          </View>
        </Section>
        <Field
          label="Price"
          value={price}
          onChangeText={setPrice}
          placeholder="$0"
          keyboardType="decimal-pad"
          hint={budgetHint}
        />
        <MeetupFields spots={spots} value={meetup} onChange={setMeetup} />
      </Screen>
    </>
  );
}
