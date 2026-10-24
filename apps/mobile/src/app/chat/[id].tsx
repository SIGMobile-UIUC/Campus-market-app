import { router, useLocalSearchParams } from "expo-router";
import { Ellipsis, ImagePlus, SendHorizontal } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAccount } from "@/features/account/account";
import { leaveChat, setMuted, type Message, type Room } from "@/features/chat/api";
import { useChats } from "@/features/chat/ChatProvider";
import { MessageBubble, SafetyTips } from "@/features/chat/MessageBubble";
import { useChatRoom, type Pending } from "@/features/chat/useChatRoom";
import { formatPrice } from "@/lib/format";
import { pickPhotos } from "@/lib/media";
import { Chip } from "@/ui/Chip";
import { GradeBadge } from "@/ui/GradeBadge";
import { Header } from "@/ui/Header";
import { Menu } from "@/ui/Menu";
import { Photo } from "@/ui/Photo";
import { useKeyboardHeight } from "@/ui/Screen";
import { TextLink } from "@/ui/TextLink";
import { useTheme } from "@/ui/theme";

// CHT-2 quick replies.
const QUICK_REPLIES = ["Is this still available?", "When can you meet?"];

type Entry = { key: string; message?: Message; pending?: Pending };

// Chat room (spec 3.3): listing header, timeline, quick replies, photos, safety tips, leave and mute.
// ponytail: trade steps show as one line until the trade cards and proposal sheet of APP-10.
export default function ChatRoom() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAccount();
  const myId = session?.user.id ?? "";
  const { room, messages, pending, partnerRead, hasOlder, loadOlder, send, retry, reloadRoom } = useChatRoom(
    id,
    myId,
  );
  const { refresh: refreshUnread } = useChats();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const [menu, setMenu] = useState<"chat" | "photo" | null>(null);

  if (room === undefined) {
    return (
      <>
        <Header title="" />
        <ActivityIndicator className="flex-1 bg-bg" />
      </>
    );
  }
  if (room === null || room === "failed") {
    return (
      <>
        <Header title="" />
        <View className="flex-1 items-center gap-2 bg-bg px-8 pt-16">
          <Text className="text-center text-base text-muted">
            {room === null ? "This chat isn't available." : "We couldn't load this chat."}
          </Text>
          {room === "failed" ? <TextLink label="Try again" onPress={() => void reloadRoom()} /> : null}
        </View>
      </>
    );
  }

  const partner = room.owner_id === myId ? room.member : room.owner;
  const partnerName = partner?.display_name ?? "Deleted user";
  const muted = room.chat_reads.find((r) => r.user_id === myId)?.muted ?? false;
  // "Read" goes under the newest of my messages the other side has seen.
  const readSeq = Math.max(
    0,
    ...messages.filter((m) => m.sender_id === myId && m.seq <= partnerRead).map((m) => m.seq),
  );
  const entries: Entry[] = [
    ...[...pending].reverse().map((p) => ({ key: p.client_id, pending: p })),
    ...[...messages].reverse().map((m) => ({ key: String(m.seq), message: m })),
  ];
  // Android reports the keyboard without the navigation bar under it; iOS includes the home indicator.
  const bottom = keyboard > 0 ? keyboard + (Platform.OS === "android" ? insets.bottom : 0) : insets.bottom;

  const pickPhoto = async (source: "camera" | "library") => {
    const [uri] = await pickPhotos(source, 1);
    if (uri) send({ kind: "image", localUri: uri });
  };

  return (
    <View className="flex-1 bg-bg" style={{ paddingBottom: bottom }}>
      <Header
        title={partnerName}
        titleView={() => (
          <View className="flex-row items-center gap-2">
            <Text className="text-[17px] font-bold text-ink">{partnerName}</Text>
            {partner ? <GradeBadge tier={partner.tier} /> : null}
          </View>
        )}
        right={() => <MenuButton onPress={() => setMenu("chat")} />}
      />
      <ListingStrip room={room} />
      <FlatList
        inverted
        data={entries}
        keyExtractor={(entry) => entry.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
        onEndReached={() => void loadOlder()}
        onEndReachedThreshold={0.3}
        // Inverted: the footer sits above the oldest message.
        ListFooterComponent={hasOlder ? <ActivityIndicator className="py-4" /> : <SafetyTips />}
        renderItem={({ item, index }) => {
          const newer = entries[index - 1]?.message;
          const m = item.message;
          // Time under the last message of a run from one sender, or after a 5-minute pause.
          const showTime =
            !!m &&
            (!newer ||
              newer.sender_id !== m.sender_id ||
              new Date(newer.created_at).getTime() - new Date(m.created_at).getTime() > 5 * 60_000);
          return (
            <MessageBubble
              message={m}
              pending={item.pending}
              myId={myId}
              partnerName={partnerName}
              showTime={showTime}
              read={!!m && m.seq === readSeq}
              onRetry={(p) => void retry(p)}
            />
          );
        }}
      />
      {room.closed_at ? (
        <View className="items-center gap-1 border-t border-line px-5 py-4">
          <Text className="text-[15px] font-bold text-ink">This chat has ended</Text>
          {room.listing ? (
            <TextLink
              label="View listing"
              onPress={() => router.push({ pathname: "/listing/[id]", params: { id: room.listing_id } })}
            />
          ) : null}
        </View>
      ) : (
        <Composer onSend={(body) => send({ kind: "text", body })} onPhoto={() => setMenu("photo")} />
      )}
      <Menu
        visible={menu === "chat"}
        onClose={() => setMenu(null)}
        options={[
          {
            label: muted ? "Turn on notifications" : "Mute notifications",
            onPress: () => void setMuted(id, !muted).then(() => reloadRoom()),
          },
          ...(room.closed_at && room.chat_reads.find((r) => r.user_id === myId)?.left_at
            ? []
            : [
                {
                  label: "Leave chat",
                  destructive: true,
                  onPress: () =>
                    void leaveChat(id).then((left) => {
                      if (!left) return;
                      refreshUnread();
                      router.back();
                    }),
                },
              ]),
        ]}
      />
      <Menu
        visible={menu === "photo"}
        onClose={() => setMenu(null)}
        options={[
          { label: "Take photo", onPress: () => void pickPhoto("camera") },
          { label: "Choose from library", onPress: () => void pickPhoto("library") },
        ]}
      />
    </View>
  );
}

function MenuButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Chat options" onPress={onPress} hitSlop={12}>
      <Ellipsis size={24} color={colors.ink} />
    </Pressable>
  );
}

// The listing this chat is about, with its price and status; tapping opens it.
function ListingStrip({ room }: { room: Room }) {
  const listing = room.listing;
  if (!listing) {
    return (
      <View className="border-b border-line px-5 py-3">
        <Text className="text-[13px] text-muted">This listing is no longer available.</Text>
      </View>
    );
  }
  const cover = [...listing.listing_photos].sort((a, b) => a.position - b.position)[0];
  const available = listing.items.filter((i) => i.status === "available");
  const price =
    listing.kind === "wanted"
      ? `Budget ${formatPrice(listing.budget_cents ?? 0)}`
      : listing.kind === "item"
        ? formatPrice(listing.items[0]?.price_cents ?? 0)
        : `From ${formatPrice(Math.min(...(available.length ? available : listing.items).map((i) => i.price_cents)))}`;
  const status =
    listing.status === "sold_out"
      ? "Sold"
      : listing.status === "closed"
        ? "Closed"
        : listing.kind === "item" && listing.items[0]?.status === "reserved"
          ? "Reserved"
          : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${listing.title}, ${price}${status ? `, ${status}` : ""}`}
      onPress={() => router.push({ pathname: "/listing/[id]", params: { id: listing.id } })}
      className="flex-row items-center gap-3 border-b border-line px-5 py-2.5"
    >
      {cover ? (
        <Photo
          path={cover.thumb_path}
          blurhash={cover.blurhash}
          style={{ width: 44, height: 44, borderRadius: 8 }}
        />
      ) : (
        <View className="h-11 w-11 rounded-lg bg-surface" />
      )}
      <View className="flex-1">
        <Text className="text-[15px] text-ink" numberOfLines={1}>
          {listing.title}
        </Text>
        <Text className="text-[15px] font-extrabold text-ink">{price}</Text>
      </View>
      {status ? (
        <View className={`rounded-md px-2 py-0.5 ${status === "Reserved" ? "bg-warning" : "bg-surface"}`}>
          <Text className={`text-xs font-extrabold ${status === "Reserved" ? "text-bg" : "text-muted"}`}>
            {status}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Composer({ onSend, onPhoto }: { onSend: (body: string) => void; onPhoto: () => void }) {
  const { colors } = useTheme();
  const [text, setText] = useState("");
  const body = text.trim();
  return (
    <View className="gap-2 border-t border-line pt-2">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
      >
        {QUICK_REPLIES.map((reply) => (
          <Chip key={reply} label={reply} onPress={() => onSend(reply)} />
        ))}
      </ScrollView>
      <View className="flex-row items-end gap-2 px-3 pb-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send a photo"
          onPress={onPhoto}
          className="h-11 w-11 items-center justify-center"
        >
          <ImagePlus size={24} color={colors.ink} />
        </Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Message"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={2000}
          accessibilityLabel="Message"
          className="max-h-32 min-h-11 flex-1 rounded-2xl border border-line px-4 py-2.5 text-base text-ink"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !body }}
          disabled={!body}
          onPress={() => {
            onSend(body);
            setText("");
          }}
          className={`h-11 w-11 items-center justify-center rounded-full bg-ink ${body ? "" : "opacity-30"}`}
        >
          <SendHorizontal size={20} color={colors.bg} />
        </Pressable>
      </View>
    </View>
  );
}
