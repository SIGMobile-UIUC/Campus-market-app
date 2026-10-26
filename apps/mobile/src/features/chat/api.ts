import { router } from "expo-router";
import { Alert } from "react-native";

import { errorMessage } from "@/lib/errors";
import { supabase } from "@/lib/supabase";

// Chat calls and shapes (spec 4.9, 6.5).

export type Message = {
  chat_id: string;
  seq: number;
  sender_id: string | null;
  kind: "text" | "image" | "system";
  body: string | null;
  image_path: string | null;
  meta: { event?: string; status?: string; user_id?: string; trade_id?: string } | null;
  client_id: string;
  created_at: string;
};

export type Person = { id: string; display_name: string | null; tier: string; campus_id: string | null };

export type ChatRow = {
  chat_id: string;
  listing_id: string;
  last_message_at: string;
  closed_at: string | null;
  unread: number;
  muted: boolean;
  listing: {
    title: string;
    kind: string;
    status: string;
    thumb_path: string | null;
    blurhash: string | null;
  } | null;
  partner: { id: string; display_name: string | null; tier: string; student: boolean } | null;
  last_message: Pick<Message, "kind" | "body" | "sender_id" | "meta"> | null;
  active_trade: boolean;
};

export type Room = {
  id: string;
  listing_id: string;
  owner_id: string;
  member_id: string;
  closed_at: string | null;
  listing: {
    id: string;
    title: string;
    kind: "item" | "bundle" | "wanted";
    status: string;
    budget_cents: number | null;
    items: { price_cents: number; status: string }[];
    listing_photos: { thumb_path: string; blurhash: string; position: number }[];
  } | null;
  owner: Person | null;
  member: Person | null;
  chat_reads: { user_id: string; last_read_seq: number; muted: boolean; left_at: string | null }[];
};

// Named foreign keys: chats reach listings and profiles through trades and messages too.
const ROOM_SELECT = `id, listing_id, owner_id, member_id, closed_at,
  listing:listings!chats_listing_id_fkey(id, title, kind, status, budget_cents, items(price_cents, status),
    listing_photos(thumb_path, blurhash, position)),
  owner:profiles!chats_owner_id_fkey(id, display_name, tier, campus_id),
  member:profiles!chats_member_id_fkey(id, display_name, tier, campus_id),
  chat_reads(user_id, last_read_seq, muted, left_at)`;

export async function fetchRoom(chatId: string): Promise<Room | null | "failed"> {
  const { data, error } = await supabase.from("chats").select(ROOM_SELECT).eq("id", chatId).maybeSingle();
  if (error) return "failed";
  return (data as unknown as Room) ?? null;
}

export async function fetchChats(): Promise<ChatRow[] | null> {
  const { data, error } = await supabase.rpc("my_chats");
  return error ? null : (data as ChatRow[]);
}

export async function fetchMessages(
  chatId: string,
  page: { after?: number; before?: number; limit?: number },
): Promise<Message[] | null> {
  const { data, error } = await supabase.rpc("get_messages", {
    p_chat_id: chatId,
    p_after_seq: page.after ?? null,
    p_before_seq: page.before ?? null,
    p_limit: page.limit ?? 50,
  });
  return error ? null : (data as Message[]);
}

export function sendMessage(
  chatId: string,
  kind: "text" | "image",
  body: string | null,
  imagePath: string | null,
  clientId: string,
) {
  return supabase.rpc("send_message", {
    p_chat_id: chatId,
    p_kind: kind,
    p_body: body,
    p_image_path: imagePath,
    p_client_id: clientId,
  });
}

export const markRead = (chatId: string, seq: number) =>
  supabase.rpc("mark_read", { p_chat_id: chatId, p_seq: seq });

export const setMuted = (chatId: string, muted: boolean) =>
  supabase.rpc("set_chat_muted", { p_chat_id: chatId, p_muted: muted });

// Asks first, since leaving cannot be undone (CHT-7, CHT-8). Resolves true when the chat was left.
export function leaveChat(chatId: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(
      "Leave this chat?",
      "It disappears from your list and the other person can't message you here. Once you have both left, messages and photos are deleted after 7 days.",
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        {
          text: "Leave",
          style: "destructive",
          onPress: async () => {
            const { error } = await supabase.rpc("leave_chat", { p_chat_id: chatId });
            if (error) {
              Alert.alert(
                "Couldn't leave",
                errorMessage(error, { INVALID_STATE: "Finish or cancel the open trade first." }),
              );
            }
            resolve(!error);
          },
        },
      ],
    ),
  );
}

// The chat for this listing and the caller, created on first use (CHT-1). With items picked on a
// move-out sale, the proposal sheet opens over the chat with them selected.
export async function openChat(listingId: string, items: string[] = []) {
  const { data, error } = await supabase.rpc("get_or_create_chat", { p_listing_id: listingId });
  if (error) {
    Alert.alert(
      "Couldn't open the chat",
      errorMessage(error, { INVALID_STATE: "This listing isn't taking new chats." }),
    );
    return;
  }
  const chatId = (data as { chat_id: string }).chat_id;
  router.push({ pathname: "/chat/[id]", params: { id: chatId } });
  if (items.length)
    router.push({ pathname: "/propose/[chatId]", params: { chatId, items: items.join(",") } });
}

const TRADE_TEXT: Record<string, string> = {
  proposed: "Trade proposed",
  accepted: "Trade accepted",
  completed: "Trade completed",
  declined: "Proposal declined",
  withdrawn: "Proposal withdrawn",
  cancelled: "Trade cancelled",
  expired: "Trade expired",
  disputed: "Problem reported",
  failed: "Trade failed",
};

// What a system message says, for the timeline and the list preview. Trade steps are one line here;
// the trade card shows the current state.
export function systemText(meta: Message["meta"], myId: string, partnerName: string): string {
  const who = meta?.user_id === myId ? "You" : partnerName;
  if (meta?.event === "left") return `${who} left the chat`;
  if (meta?.status === "confirmed") return `${who} marked the trade completed`;
  return TRADE_TEXT[meta?.status ?? ""] ?? "Update";
}

export function previewText(message: ChatRow["last_message"], myId: string, partnerName: string): string {
  if (!message) return "";
  if (message.kind === "system") return systemText(message.meta, myId, partnerName);
  const text = message.kind === "image" ? "Photo" : (message.body ?? "");
  return message.sender_id === myId ? `You: ${text}` : text;
}
