import { Tabs } from "expo-router";

import { TabBar } from "@/ui/TabBar";

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="categories" />
      <Tabs.Screen name="chats" />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}
