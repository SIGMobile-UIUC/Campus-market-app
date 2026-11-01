import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";

import { caseTitle, fetchQueue, type Case } from "@/features/moderation/admin";
import { Header } from "@/ui/Header";

// Moderation queue (SAF-5): open cases of the admin's campuses, oldest first, against the 24-hour target.
export default function AdminQueue() {
  const [cases, setCases] = useState<Case[] | null | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      void fetchQueue().then(setCases);
    }, []),
  );

  return (
    <View className="flex-1 bg-bg">
      <Header title="Moderation" />
      {cases === undefined ? <ActivityIndicator className="py-8" /> : null}
      {cases === null ? (
        <Text className="px-8 pt-16 text-center text-base text-muted">{"We couldn't load the queue."}</Text>
      ) : null}
      {cases ? (
        <FlatList
          data={cases}
          keyExtractor={(c) => c.case_id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
          ListEmptyComponent={<Text className="py-8 text-center text-muted">No open cases.</Text>}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push({ pathname: "/admin/[id]", params: { id: item.case_id } })}
              className="gap-1 border-b border-line py-3"
            >
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 text-[15px] font-bold text-ink" numberOfLines={1}>
                  {caseTitle(item)}
                </Text>
                <Text
                  className={`text-[13px] font-bold ${item.age_hours >= 24 ? "text-danger" : item.age_hours >= 20 ? "text-warning" : "text-muted"}`}
                >
                  {Math.floor(item.age_hours)}h
                </Text>
              </View>
              <Text className="text-[13px] text-muted">
                {item.case_type === "dispute"
                  ? "Dispute under review"
                  : `${item.reports} ${item.reports === 1 ? "report" : "reports"} · ${item.reasons.join(", ")}`}
              </Text>
            </Pressable>
          )}
        />
      ) : null}
    </View>
  );
}
