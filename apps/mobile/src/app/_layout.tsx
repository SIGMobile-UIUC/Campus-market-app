import "../../global.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { AccountProvider, useAccount } from "@/features/account/account";
import { ChatProvider } from "@/features/chat/ChatProvider";
import { toCampus } from "@/features/campus/campuses";
import { Button } from "@/ui/Button";
import { ThemeProvider } from "@/ui/theme";

export default function RootLayout() {
  return (
    <AccountProvider>
      <Shell />
    </AccountProvider>
  );
}

// Exactly one route group is reachable: sign-in when signed out, onboarding until the profile is
// complete, then the app. Expo Router redirects when a guard flips.
function Shell() {
  const { loading, session, account, failed, refresh } = useAccount();
  const campus = useMemo(() => toCampus(account?.campus), [account?.campus]);
  const onboarded = account?.onboarded === true;
  // Right after sign-in the session arrives a moment before the account.
  const waiting = loading || (!!session && !account && !failed);

  return (
    // Keyed by user so the market choice of one account does not carry over to the next.
    <ThemeProvider key={session?.user.id ?? "signed-out"} campus={campus}>
      <StatusBar style="auto" />
      {waiting ? (
        <View className="flex-1 items-center justify-center bg-bg">
          <ActivityIndicator />
        </View>
      ) : failed ? (
        <View className="flex-1 items-center justify-center gap-4 bg-bg px-8">
          <Text className="text-center text-base text-ink">
            {"We couldn't load your account. Check your connection."}
          </Text>
          <Button label="Try again" onPress={refresh} />
        </View>
      ) : (
        <ChatProvider userId={session && onboarded ? session.user.id : null}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Protected guard={!session}>
              <Stack.Screen name="(auth)" />
            </Stack.Protected>
            <Stack.Protected guard={!!session && !!account && !onboarded}>
              <Stack.Screen name="(onboarding)" />
            </Stack.Protected>
            <Stack.Protected guard={!!session && onboarded}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="post" />
              <Stack.Screen name="browse" />
              <Stack.Screen name="search" />
              <Stack.Screen name="listing/[id]" />
              <Stack.Screen name="edit/[id]" />
              <Stack.Screen name="favorites" />
              <Stack.Screen name="wanted" />
              <Stack.Screen name="chat/[id]" />
              <Stack.Screen name="propose/[chatId]" />
              <Stack.Screen name="offer/[listingId]" />
              <Stack.Screen name="trade/[id]" />
              <Stack.Screen name="trades" />
              <Stack.Screen
                name="sell"
                options={{
                  presentation: "formSheet",
                  sheetGrabberVisible: true,
                  sheetAllowedDetents: "fitToContents",
                }}
              />
            </Stack.Protected>
          </Stack>
        </ChatProvider>
      )}
    </ThemeProvider>
  );
}
