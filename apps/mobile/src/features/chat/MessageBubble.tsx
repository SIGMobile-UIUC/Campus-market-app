import { Image } from "expo-image";
import { ShieldCheck, TriangleAlert } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { formatTime } from "@/lib/format";
import { Photo } from "@/ui/Photo";
import { useTheme } from "@/ui/theme";

import { systemText, type Message } from "./api";
import { scamWarning } from "./safety";
import type { Pending } from "./useChatRoom";

const PHOTO = { width: 220, height: 220, borderRadius: 16 };

// One timeline entry: the server's message, or one of ours still on its way.
export function MessageBubble({
  message,
  pending,
  myId,
  partnerName,
  showTime,
  read,
  onRetry,
}: {
  message?: Message;
  pending?: Pending;
  myId: string;
  partnerName: string;
  showTime: boolean;
  read: boolean;
  onRetry: (pending: Pending) => void;
}) {
  if (message?.kind === "system") {
    return (
      <Text className="my-2 self-center px-6 text-center text-[13px] text-muted">
        {systemText(message.meta, myId, partnerName)}
      </Text>
    );
  }
  const mine = pending ? true : message!.sender_id === myId;
  const kind = pending?.kind ?? message!.kind;
  const body = pending?.body ?? message?.body ?? null;
  const warning = mine ? null : scamWarning(body);
  const status = pending ? (pending.failed ? "Not sent · Tap to retry" : "Sending…") : read ? "Read" : null;
  const time = message && showTime ? formatTime(message.created_at) : null;

  return (
    <View className={`mb-1 max-w-[78%] gap-1 ${mine ? "items-end self-end" : "items-start self-start"}`}>
      <Pressable
        disabled={!pending?.failed}
        accessibilityRole={pending?.failed ? "button" : undefined}
        onPress={() => pending && onRetry(pending)}
        className={pending && !pending.failed ? "opacity-60" : ""}
      >
        {kind === "image" ? (
          pending?.localUri ? (
            <Image source={{ uri: pending.localUri }} style={PHOTO} contentFit="cover" />
          ) : message?.image_path ? (
            <Photo path={message.image_path} bucket="chat-images" style={PHOTO} accessibilityLabel="Photo" />
          ) : (
            <View style={PHOTO} className="items-center justify-center bg-surface">
              <Text className="text-[13px] text-muted">Photo expired</Text>
            </View>
          )
        ) : null}
        {body ? (
          <View className={`rounded-2xl px-3.5 py-2.5 ${mine ? "bg-ink" : "bg-surface"}`}>
            <Text className={`text-[15px] leading-5 ${mine ? "text-bg" : "text-ink"}`}>{body}</Text>
          </View>
        ) : null}
      </Pressable>
      {warning ? <Warning text={warning} /> : null}
      {time || status ? (
        <Text className={`px-1 text-[11px] ${pending?.failed ? "text-danger" : "text-muted"}`}>
          {[status, time].filter(Boolean).join(" · ")}
        </Text>
      ) : null}
    </View>
  );
}

function Warning({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="alert"
      className="flex-row items-center gap-2 rounded-xl border border-warning px-3 py-2"
    >
      <TriangleAlert size={16} color={colors.warning} />
      <Text className="flex-1 text-[13px] text-ink">{text}</Text>
    </View>
  );
}

// Spec 3.9: tips at the start of every chat, before the first message.
export function SafetyTips() {
  const { colors } = useTheme();
  return (
    <View className="mb-4 gap-2 rounded-2xl bg-surface p-4">
      <View className="flex-row items-center gap-2">
        <ShieldCheck size={18} color={colors.success} />
        <Text className="text-sm font-bold text-ink">Trade safely</Text>
      </View>
      <Text className="text-[13px] leading-5 text-muted">
        Meet at a listed spot or a busy public place. Check the item before you pay. Never share a
        verification code.
      </Text>
    </View>
  );
}
