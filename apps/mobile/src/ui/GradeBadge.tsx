import { Text, View } from "react-native";

// Lowest to highest.
export const GRADE_LETTERS: Record<string, string> = {
  c: "C",
  b_minus: "B−",
  b: "B",
  b_plus: "B+",
  a_minus: "A−",
  a: "A",
  a_plus: "A+",
};

// Spec 3.6.2: a rounded square with the letter. C filled warning, B− warning outline, B muted,
// B+ and A− accent, A and A+ success. The letter carries the meaning, never the color alone.
const STYLE: Record<string, { box: string; text: string }> = {
  c: { box: "bg-warning", text: "text-bg" },
  b_minus: { box: "border border-warning", text: "text-warning" },
  b: { box: "bg-surface", text: "text-muted" },
  b_plus: { box: "bg-accent", text: "text-on-accent" },
  a_minus: { box: "bg-accent", text: "text-on-accent" },
  a: { box: "bg-success", text: "text-bg" },
  a_plus: { box: "bg-success", text: "text-bg" },
};

const SPOKEN: Record<string, string> = {
  b_minus: "B minus",
  b_plus: "B plus",
  a_minus: "A minus",
  a_plus: "A plus",
};

export function GradeBadge({ tier }: { tier: string }) {
  const style = STYLE[tier] ?? STYLE.b;
  return (
    <View
      accessibilityLabel={`Grade ${SPOKEN[tier] ?? GRADE_LETTERS[tier] ?? "B"}`}
      className={`h-6 min-w-6 items-center justify-center rounded-md px-1 ${style.box}`}
    >
      <Text className={`text-xs font-extrabold ${style.text}`}>{GRADE_LETTERS[tier] ?? "B"}</Text>
    </View>
  );
}
