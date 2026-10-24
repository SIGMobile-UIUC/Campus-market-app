import { router, useFocusEffect } from "expo-router";
import { BellOff, Ellipsis } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAccount } from "@/features/account/account";
import { fetchChats, leaveChat, previewText, setMuted, type ChatRow } from "@/features/chat/api";
import { useChats } from "@/features/chat/ChatProvider";
import { formatAgo } from "@/lib/format";
import { GradeBadge } from "@/ui/GradeBadge";
import { Menu } from "@/ui/Menu";
import { Photo } from "@/ui/Photo";
import { TextLink } from "@/ui/TextLink";
import { useTheme } from "@/ui/theme";

// Chat list (spec 3.3): listing thumbnail, the other person and their grade, the last message, unread
// count and an active-trade chip; "..." to mute or leave. Reloads on focus and on every badge event.
export default function Chats() {
  const insets = useSafeAreaInsets();
  const { session } = useAccount();
  const myId = session?.user.id ?? "";
  const { version, refresh: refreshUnread } = useChats();
  const [rows, setRows] = useState<ChatRow[] | null | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [menuFor, setMenuFor] = useState<ChatRow | null>(null);

  const load = useCallback(() => fetchChats().then(setRows), []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    if (version) void load();
  }, [version, load]);

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top + 12 }}>
      <Text accessibilityRole="header" className="px-5 pb-3 text-2xl font-extrabold text-ink">
        Chats
      </Text>
      {rows === undefined ? (
        <ActivityIndicator className="flex-1" />
      ) : rows === null ? (
        <View className="items-center gap-2 px-8 pt-16">
          <Text className="text-center text-base text-muted">{"We couldn't load your chats."}</Text>
          <TextLink label="Try again" onPress={() => void load()} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.chat_id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load().finally(() => setRefreshing(false));
              }}
            />
          }
          ListEmptyComponent={
            <View className="px-5 pt-4">
              <Text className="text-base font-bold text-ink">No chats yet</Text>
              <Text className="mt-1 text-sm text-muted">Chats with buyers and sellers show up here.</Text>
            </View>
          }
          renderItem={({ item }) => <ChatListRow row={item} myId={myId} onMenu={() => setMenuFor(item)} />}
        />
      )}
      <Menu
        visible={!!menuFor}
        title={menuFor?.listing?.title}
        onClose={() => setMenuFor(null)}
        options={
          menuFor
            ? [
                {
                  label: menuFor.muted ? "Turn on notifications" : "Mute notifications",
                  onPress: () => void setMuted(menuFor.chat_id, !menuFor.muted).then(load),
                },
                {
                  label: "Leave chat",
                  destructive: true,
                  onPress: () =>
                    void leaveChat(menuFor.chat_id).then((left) => {
                      if (!left) return;
                      refreshUnread();
                      void load();
                    }),
                },
              ]
            : []
        }
      />
    </View>
  );
}

function ChatListRow({ row, myId, onMenu }: { row: ChatRow; myId: string; onMenu: () => void }) {
  const { colors } = useTheme();
  const name = row.partner?.display_name ?? "Deleted user";
  const preview = previewText(row.last_message, myId, name);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${row.listing?.title ?? "listing removed"}, ${preview}${row.unread ? `, ${row.unread} unread` : ""}`}
      onPress={() => router.push({ pathname: "/chat/[id]", params: { id: row.chat_id } })}
      onLongPress={onMenu}
      className="flex-row items-center gap-3 px-5 py-3 active:bg-surface"
    >
      {row.listing?.thumb_path ? (
        <Photo
          path={row.listing.thumb_path}
          blurhash={row.listing.blurhash}
          style={{ width: 52, height: 52, borderRadius: 10 }}
        />
      ) : (
        <View className="h-[52px] w-[52px] rounded-[10px] bg-surface" />
      )}
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-1.5">
          <Text className="shrink text-[15px] font-bold text-ink" numberOfLines={1}>
            {name}
          </Text>
          {row.partner ? <GradeBadge tier={row.partner.tier} /> : null}
          {row.partner && !row.partner.student ? (
            <Text className="text-xs text-muted">Open market</Text>
          ) : null}
          {row.muted ? <BellOff size={14} color={colors.muted} accessibilityLabel="Muted" /> : null}
        </View>
        <Text className="text-[13px] text-muted" numberOfLines={1}>
          {row.listing?.title ?? "Listing removed"}
        </Text>
        <Text className={`text-sm ${row.unread ? "font-bold text-ink" : "text-muted"}`} numberOfLines={1}>
          {preview}
        </Text>
      </View>
      <View className="items-end gap-1.5">
        <Text className="text-xs text-muted">{formatAgo(row.last_message_at)}</Text>
        {row.unread ? (
          <View className="h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5">
            <Text className="text-[11px] font-extrabold text-on-accent">
              {row.unread > 99 ? "99+" : row.unread}
            </Text>
          </View>
        ) : null}
        {row.active_trade ? (
          <View className="rounded-md bg-surface px-1.5 py-0.5">
            <Text className="text-[11px] font-bold text-ink">Trade</Text>
          </View>
        ) : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Chat options" onPress={onMenu} hitSlop={8}>
        <Ellipsis size={20} color={colors.muted} />
      </Pressable>
    </Pressable>
  );
}
