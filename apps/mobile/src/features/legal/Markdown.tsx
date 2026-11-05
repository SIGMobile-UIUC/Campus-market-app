import { Text, View } from "react-native";

// The markdown the legal documents use: # and ## headings, one-line paragraphs, "- " and "1. " list items
// and **bold**.
export function Markdown({ source }: { source: string }) {
  return (
    <View className="gap-3">
      {source
        .split("\n")
        .filter((line) => line.trim())
        .map((line, i) => {
          if (line.startsWith("# ")) {
            return (
              <Text key={i} accessibilityRole="header" className="text-[26px] font-extrabold text-ink">
                {line.slice(2)}
              </Text>
            );
          }
          if (line.startsWith("## ")) {
            return (
              <Text key={i} accessibilityRole="header" className="pt-3 text-lg font-extrabold text-ink">
                {line.slice(3)}
              </Text>
            );
          }
          const item = line.match(/^(- |\d+\. )(.*)$/);
          return item ? (
            <View key={i} className="flex-row gap-2 pl-1">
              <Text className="text-[15px] leading-6 text-ink">
                {item[1] === "- " ? "•" : item[1].trim()}
              </Text>
              <Inline text={item[2]} />
            </View>
          ) : (
            <Inline key={i} text={line} />
          );
        })}
    </View>
  );
}

function Inline({ text }: { text: string }) {
  return (
    <Text className="flex-1 text-[15px] leading-6 text-ink">
      {text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
        part.startsWith("**") ? (
          <Text key={i} className="font-bold">
            {part.slice(2, -2)}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}
