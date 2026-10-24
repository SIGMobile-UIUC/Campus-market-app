import { Stack } from "expo-router";
import type { ReactNode } from "react";

import { useTheme } from "./theme";

// A native header with a back button, in the current theme. Screens outside the tabs render it.
// titleView replaces the plain title, e.g. a name with a grade badge.
export function Header({
  title,
  titleView,
  right,
}: {
  title: string;
  titleView?: () => ReactNode;
  right?: () => ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Stack.Screen
      options={{
        headerShown: true,
        title,
        headerTitle: titleView,
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.ink,
        headerShadowVisible: false,
        headerRight: right,
        // Lists without their own background would otherwise show the navigator's default gray.
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
