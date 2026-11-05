import { useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PRIVACY, TERMS } from "@/features/legal/documents";
import { Markdown } from "@/features/legal/Markdown";
import { Header } from "@/ui/Header";

const DOCS = { terms: ["Terms", TERMS], privacy: ["Privacy Policy", PRIVACY] } as const;

// The Terms and the Privacy Policy, readable in the app before and after sign-in.
export default function Legal() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const insets = useSafeAreaInsets();
  const [title, source] = DOCS[doc as keyof typeof DOCS] ?? DOCS.terms;
  return (
    <>
      <Header title={title} />
      <ScrollView
        className="flex-1 bg-bg"
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}
      >
        <Markdown source={source} />
      </ScrollView>
    </>
  );
}
