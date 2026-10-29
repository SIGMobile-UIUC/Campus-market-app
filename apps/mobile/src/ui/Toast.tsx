import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

let show: ((text: string) => void) | null = null;

// A short message over any screen, such as the points a trade or review earned (spec 3.8).
export const toast = (text: string) => show?.(text);

// Mounted once at the root; each toast replaces the last and fades after 2.5 seconds.
export function Toaster() {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    show = (next) => {
      clearTimeout(timer);
      setText(next);
      timer = setTimeout(() => setText(null), 2500);
    };
    return () => {
      clearTimeout(timer);
      show = null;
    };
  }, []);

  if (!text) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      className="absolute self-center rounded-full bg-ink px-5 py-3"
      style={{ bottom: insets.bottom + 96 }}
    >
      <Text className="text-[15px] font-bold text-bg">{text}</Text>
    </View>
  );
}
