import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { Platform } from "react-native";

import { supabase } from "./supabase";

// Push notifications (CHT-5, spec 4.16). The server decides what to send; the app registers the
// device's Expo token and opens what a notification is about.

// Notifications that arrive while the app is open still show as a banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let registered: string | null = null;

// Registers this device for the signed-in user. With ask, the system prompt appears if the user has
// not answered it yet (spec 4.16: at the first chat or first listing); without it, a device that already
// allowed notifications just refreshes its token. Failures are ignored: Expo Go on Android cannot
// receive remote pushes, and the app works without them.
export async function enablePush(ask: boolean): Promise<void> {
  try {
    let { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status !== "granted" && ask && canAskAgain) {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== "granted") return;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Messages and trades",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const { data } = await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig?.extra?.eas?.projectId,
    });
    const { error } = await supabase.rpc("register_push_token", { p_token: data, p_platform: Platform.OS });
    if (!error) registered = data;
  } catch {
    // No push on this device or build.
  }
}

// Signing out stops pushes to this device.
export async function disablePush(): Promise<void> {
  if (!registered) return;
  await supabase.rpc("unregister_push_token", { p_token: registered });
  registered = null;
}

// A tapped notification opens its chat or trade.
export function openNotification(response: Notifications.NotificationResponse) {
  const data = response.notification.request.content.data as {
    type?: string;
    chat_id?: string;
    trade_id?: string;
  };
  if (data.type === "chat" && data.chat_id) {
    router.push({ pathname: "/chat/[id]", params: { id: data.chat_id } });
  } else if (data.type === "trade" && data.trade_id) {
    router.push({ pathname: "/trade/[id]", params: { id: data.trade_id } });
  }
}
