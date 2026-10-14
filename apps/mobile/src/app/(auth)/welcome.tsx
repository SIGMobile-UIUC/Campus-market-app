import { router } from "expo-router";
import { Text } from "react-native";

import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";

export default function Welcome() {
  return (
    <Screen
      title="Campus Market"
      subtitle="Buy and sell with verified students at your school."
      footer={
        <>
          <Button label="Continue with email" onPress={() => router.push("/email")} />
          <Text className="text-center text-[13px] text-muted">
            A school email unlocks your campus market. Any email works for the open market.
          </Text>
        </>
      }
    />
  );
}
