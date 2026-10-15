import { Stack } from "expo-router";

import { useTheme } from "@/ui/theme";

// The sell editors use a native header with a back button (the onboarding steps do not).
export default function PostLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.ink,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
