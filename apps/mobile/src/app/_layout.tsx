import "../../global.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { DEMO_CAMPUS } from "@/features/campus/campuses";
import { ThemeProvider } from "@/ui/theme";

export default function RootLayout() {
  return (
    <ThemeProvider campus={DEMO_CAMPUS}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="sell"
          options={{
            presentation: "formSheet",
            sheetGrabberVisible: true,
            sheetAllowedDetents: "fitToContents",
          }}
        />
      </Stack>
    </ThemeProvider>
  );
}
