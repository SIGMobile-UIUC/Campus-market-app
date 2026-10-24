import { randomUUID } from "expo-crypto";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState } from "react-native";

import { errorMessage } from "@/lib/errors";
import { uploadChatPhoto } from "@/lib/media";
import { supabase } from "@/lib/supabase";

import { fetchMessages, fetchRoom, markRead, sendMessage, type Message, type Room } from "./api";
import { useChats } from "./ChatProvider";

const PAGE = 50;

// A message on its way: shown as pending until the server's copy (same client_id) arrives.
export type Pending = {
  client_id: string;
  kind: "text" | "image";
  body: string | null;
  localUri: string | null;
  imagePath: string | null;
  failed: boolean;
};

// One chat room (spec 4.9): the latest page, older pages on demand, live messages and read receipts
// over chat:{id}, and gap fill (get_messages after the newest seq) on reconnect, on returning to the
// foreground and whenever a broadcast skips a seq.
export function useChatRoom(chatId: string, myId: string) {
  const { refresh: refreshUnread } = useChats();
  const focused = useIsFocused();
  const [room, setRoom] = useState<Room | null | "failed" | undefined>(undefined);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [partnerRead, setPartnerRead] = useState(0);
  const [hasOlder, setHasOlder] = useState(false);
  const lastSeq = useRef(0);
  const loaded = useRef(false);

  const merge = useCallback(
    (incoming: Message[]) => {
      if (!incoming.length) return;
      lastSeq.current = Math.max(lastSeq.current, ...incoming.map((m) => m.seq));
      setMessages((current) => {
        const bySeq = new Map(current.map((m) => [m.seq, m]));
        for (const m of incoming) bySeq.set(m.seq, m);
        return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
      });
      const arrived = new Set(incoming.map((m) => m.client_id));
      setPending((current) => current.filter((p) => !arrived.has(p.client_id)));
      // Sending moves the sender's own read marker (6.5), so their message means they read up to it.
      const theirs = incoming.filter((m) => m.sender_id && m.sender_id !== myId).map((m) => m.seq);
      if (theirs.length) setPartnerRead((seq) => Math.max(seq, ...theirs));
    },
    [myId],
  );

  const applyRoom = useCallback(
    (next: Room | null | "failed") => {
      setRoom(next);
      if (next && next !== "failed") {
        const theirs = next.chat_reads.find((r) => r.user_id !== myId);
        setPartnerRead((seq) => Math.max(seq, theirs?.last_read_seq ?? 0));
      }
    },
    [myId],
  );
  const loadRoom = useCallback(() => fetchRoom(chatId).then(applyRoom), [chatId, applyRoom]);

  const catchUp = useCallback(async () => {
    if (!loaded.current) return;
    for (;;) {
      const page = await fetchMessages(chatId, { after: lastSeq.current, limit: 100 });
      if (!page) return;
      merge(page);
      if (page.length < 100) return;
    }
  }, [chatId, merge]);

  // A message from the broadcast or our own send: appended in order, or a gap fill when seqs are missing.
  const receive = useCallback(
    (message: Message) => {
      if (message.seq > lastSeq.current + 1) void catchUp();
      else merge([message]);
      if (message.kind === "system" && message.meta?.event === "left") void loadRoom();
    },
    [catchUp, merge, loadRoom],
  );

  useEffect(() => {
    let alive = true;
    void Promise.all([fetchRoom(chatId), fetchMessages(chatId, { limit: PAGE })]).then(([next, page]) => {
      if (!alive) return;
      applyRoom(next);
      if (!page) return;
      merge(page);
      setHasOlder(page.length === PAGE);
      loaded.current = true;
      // Covers messages sent between this page and the subscription.
      void catchUp();
    });

    const channel = supabase
      .channel(`chat:${chatId}`, { config: { private: true } })
      .on("broadcast", { event: "message" }, ({ payload }) => receive(payload.record as Message))
      .on("broadcast", { event: "read" }, ({ payload }) => {
        if (payload.user_id !== myId) setPartnerRead((seq) => Math.max(seq, payload.seq as number));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void catchUp();
      });
    const appState = AppState.addEventListener("change", (state) => state === "active" && void catchUp());
    return () => {
      alive = false;
      loaded.current = false;
      lastSeq.current = 0;
      appState.remove();
      void supabase.removeChannel(channel);
    };
  }, [chatId, myId, applyRoom, merge, catchUp, receive]);

  // Reading what is on screen moves the marker; the server only moves it forward.
  const newest = messages[messages.length - 1]?.seq ?? 0;
  useEffect(() => {
    if (!focused || newest === 0) return;
    void markRead(chatId, newest).then(refreshUnread);
  }, [focused, newest, chatId, refreshUnread]);

  const loadOlder = useCallback(async () => {
    const first = messages[0]?.seq;
    if (!hasOlder || first === undefined) return;
    const page = await fetchMessages(chatId, { before: first, limit: PAGE });
    if (!page) return;
    merge(page);
    setHasOlder(page.length === PAGE);
  }, [chatId, hasOlder, messages, merge]);

  const deliver = useCallback(
    async (item: Pending) => {
      const update = (changes: Partial<Pending>) =>
        setPending((current) =>
          current.map((p) => (p.client_id === item.client_id ? { ...p, ...changes } : p)),
        );
      update({ failed: false });
      try {
        let imagePath = item.imagePath;
        if (item.kind === "image" && !imagePath) {
          imagePath = await uploadChatPhoto(chatId, myId, item.localUri!);
          update({ imagePath });
        }
        // The same client_id makes a retry return the stored message instead of sending twice.
        const { data, error } = await sendMessage(chatId, item.kind, item.body, imagePath, item.client_id);
        if (error) throw error;
        const sent = data as { seq: number; created_at: string };
        receive({
          chat_id: chatId,
          seq: sent.seq,
          sender_id: myId,
          kind: item.kind,
          body: item.body,
          image_path: imagePath,
          meta: null,
          client_id: item.client_id,
          created_at: sent.created_at,
        });
      } catch (error) {
        // A refusal (filter, rate limit, closed chat) will not pass on retry; a network failure may.
        if ((error as { code?: string }).code === "P0001") {
          setPending((current) => current.filter((p) => p.client_id !== item.client_id));
          Alert.alert(
            "Message not sent",
            errorMessage(error, {
              INVALID_STATE: "This chat has ended.",
              PROHIBITED_CONTENT: "That message isn't allowed.",
            }),
          );
          if ((error as { message?: string }).message === "INVALID_STATE") void loadRoom();
        } else {
          update({ failed: true });
        }
      }
    },
    [chatId, myId, receive, loadRoom],
  );

  const send = useCallback(
    (draft: { kind: "text"; body: string } | { kind: "image"; localUri: string }) => {
      const item: Pending = {
        client_id: randomUUID(),
        kind: draft.kind,
        body: draft.kind === "text" ? draft.body : null,
        localUri: draft.kind === "image" ? draft.localUri : null,
        imagePath: null,
        failed: false,
      };
      setPending((current) => [...current, item]);
      void deliver(item);
    },
    [deliver],
  );

  return {
    room,
    messages,
    pending,
    partnerRead,
    hasOlder,
    loadOlder,
    send,
    retry: deliver,
    reloadRoom: loadRoom,
  };
}
