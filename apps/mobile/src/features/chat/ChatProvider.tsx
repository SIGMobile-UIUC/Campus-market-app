import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as Notifications from "expo-notifications";
import { AppState } from "react-native";

import { enablePush, openNotification } from "@/lib/push";
import { supabase } from "@/lib/supabase";

type ChatState = {
  // Unread messages over every open chat, for the tab badge (CHT-4).
  unread: number;
  // Bumps on every badge event, so the chat list knows to reload.
  version: number;
  refresh: () => void;
};

const ChatContext = createContext<ChatState>({ unread: 0, version: 0, refresh: () => {} });

export const useChats = () => useContext(ChatContext);

// Listens on the user's private topic (spec 4.9): the server sends a badge event for every new
// message in the user's chats. Foregrounding the app reloads, since events sent while away are lost.
export function ChatProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const [unread, setUnread] = useState(0);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    void supabase.rpc("unread_summary").then(({ data }) => {
      if (data) setUnread((data as { total: number }).total);
    });
  }, []);

  // A device that already allowed notifications refreshes its token; a tapped notification, including
  // the one that launched the app, opens its chat or trade.
  useEffect(() => {
    if (!userId) return;
    void enablePush(false);
    void Notifications.getLastNotificationResponseAsync().then(
      (response) => response && openNotification(response),
    );
    const tapped = Notifications.addNotificationResponseReceivedListener(openNotification);
    return () => tapped.remove();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    refresh();
    const changed = () => {
      setVersion((v) => v + 1);
      refresh();
    };
    const channel = supabase
      .channel(`user:${userId}`, { config: { private: true } })
      .on("broadcast", { event: "badge" }, changed)
      .subscribe();
    const appState = AppState.addEventListener("change", (state) => state === "active" && changed());
    return () => {
      appState.remove();
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  return (
    <ChatContext.Provider value={{ unread: userId ? unread : 0, version, refresh }}>
      {children}
    </ChatContext.Provider>
  );
}
