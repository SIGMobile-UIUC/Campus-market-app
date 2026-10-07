import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/ui/theme";

export default function Me() {
  const { campus } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-bg px-5" style={{ paddingTop: insets.top + 12 }}>
      <Text className="pb-6 text-2xl font-extrabold text-ink">Me</Text>
      <View className="rounded-2xl bg-primary p-5">
        <Text className="text-base font-extrabold text-on-primary">{campus.name}</Text>
        <Text className="mt-1 text-sm text-on-primary">
          Your rank, points and listings show up here after you sign in.
        </Text>
      </View>
    </View>
  );
}
