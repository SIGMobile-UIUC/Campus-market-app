import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function Chats() {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-bg px-5" style={{ paddingTop: insets.top + 12 }}>
      <Text className="pb-6 text-2xl font-extrabold text-ink">Chats</Text>
      <Text className="text-base font-bold text-ink">No chats yet</Text>
      <Text className="mt-1 text-sm text-muted">Chats with buyers and sellers show up here.</Text>
    </View>
  );
}
