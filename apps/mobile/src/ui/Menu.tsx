import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type MenuOption = { label: string; onPress: () => void; destructive?: boolean };

// A bottom sheet of actions, closed by tapping outside or Cancel.
export function Menu({
  visible,
  title,
  options,
  onClose,
}: {
  visible: boolean;
  title?: string;
  options: MenuOption[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close menu" className="flex-1 bg-black/40" onPress={onClose} />
      <View className="rounded-t-3xl bg-bg px-2 pt-3" style={{ paddingBottom: insets.bottom + 8 }}>
        {title ? (
          <Text className="px-4 pb-2 text-[13px] text-muted" numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        {[...options, { label: "Cancel", onPress: () => {} }].map((option) => (
          <Pressable
            key={option.label}
            accessibilityRole="button"
            onPress={() => {
              onClose();
              option.onPress();
            }}
            className="min-h-14 justify-center rounded-xl px-4 active:bg-surface"
          >
            <Text
              className={`text-base ${option.destructive ? "text-danger" : "text-ink"} ${option.label === "Cancel" ? "font-bold" : ""}`}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}
