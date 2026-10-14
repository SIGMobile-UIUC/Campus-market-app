import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAccount } from "@/features/account/account";
import { Avatar } from "@/features/avatar/Avatar";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { useTheme } from "@/ui/theme";

// ponytail: grade card, wallet, check-in and shop arrive with APP-12; sign-out moves into Settings (APP-19).
// The avatar frame follows the trust grade once grades show (spec 3.8).
export default function Me() {
  const { campus } = useTheme();
  const { account } = useAccount();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 gap-4 bg-bg px-5" style={{ paddingTop: insets.top + 12 }}>
      <Text className="pb-2 text-2xl font-extrabold text-ink">Me</Text>
      <View className="flex-row items-center gap-4 rounded-2xl bg-primary p-5">
        <Avatar loadout={account?.avatar ?? {}} size={64} />
        <View className="flex-1">
          <Text className="text-base font-extrabold text-on-primary">{campus?.name ?? "Open market"}</Text>
          <Text className="mt-1 text-sm text-on-primary">{account?.email}</Text>
        </View>
      </View>
      <Button
        variant="secondary"
        label="Sign out"
        onPress={() => void supabase.auth.signOut({ scope: "local" })}
      />
    </View>
  );
}
