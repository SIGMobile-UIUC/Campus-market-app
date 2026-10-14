import { useEffect, useState, type ReactNode } from "react";
import { Keyboard, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// KeyboardAvoidingView measures its own layout, which is wrong on Android when an autofocused field opens
// the keyboard during the screen transition. The keyboard height from the event needs no layout.
function useKeyboardHeight() {
  const [height, setHeight] = useState(() => Keyboard.metrics()?.height ?? 0);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) =>
      setHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

// Full-screen step with a title, content and a footer that stays above the keyboard (onboarding).
export function Screen({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  // Android reports the keyboard without the navigation bar under it; iOS includes the home indicator.
  const bottom =
    keyboard > 0
      ? keyboard + (Platform.OS === "android" ? insets.bottom : 0) + 12
      : Math.max(insets.bottom, 16);
  return (
    <View className="flex-1 bg-bg">
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + 48, paddingHorizontal: 24, paddingBottom: 24 }}
      >
        <Text accessibilityRole="header" className="text-[28px] font-extrabold text-ink">
          {title}
        </Text>
        {subtitle ? <Text className="mt-2 text-base text-muted">{subtitle}</Text> : null}
        <View className="mt-8 gap-4">{children}</View>
      </ScrollView>
      {footer ? (
        <View className="gap-3 px-6 pt-3" style={{ paddingBottom: bottom }}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}
