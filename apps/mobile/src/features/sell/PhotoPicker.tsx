import { Image } from "expo-image";
import { Camera, ImagePlus, X } from "lucide-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";

import { pickPhotos } from "@/lib/media";
import { useTheme } from "@/ui/theme";

// Local photos before upload. The first is the cover; tapping another makes it the cover (spec 3.3:
// camera and library, reorder, up to 10 per item).
export function PhotoPicker({
  uris,
  onChange,
  max = 10,
}: {
  uris: string[];
  onChange: (uris: string[]) => void;
  max?: number;
}) {
  const { colors } = useTheme();
  const add = async (source: "library" | "camera") => {
    const picked = await pickPhotos(source, max - uris.length);
    onChange([...uris, ...picked].slice(0, max));
  };

  return (
    <View className="gap-2">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {uris.length < max ? (
          <>
            <AddTile label={`${uris.length}/${max}`} onPress={() => void add("library")}>
              <ImagePlus size={24} color={colors.ink} />
            </AddTile>
            <AddTile label="Camera" onPress={() => void add("camera")}>
              <Camera size={24} color={colors.ink} />
            </AddTile>
          </>
        ) : null}
        {uris.map((uri, index) => (
          <Pressable
            key={uri}
            accessibilityRole="button"
            accessibilityLabel={index === 0 ? "Cover photo" : `Photo ${index + 1}, make cover`}
            onPress={() => index > 0 && onChange([uri, ...uris.filter((u) => u !== uri)])}
          >
            <Image source={{ uri }} style={{ width: 80, height: 80, borderRadius: 12 }} contentFit="cover" />
            {index === 0 ? (
              <View className="absolute bottom-0 left-0 right-0 items-center rounded-b-xl bg-black/60 py-0.5">
                <Text className="text-[11px] font-bold text-white">Cover</Text>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove photo ${index + 1}`}
              hitSlop={8}
              onPress={() => onChange(uris.filter((u) => u !== uri))}
              className="absolute right-1 top-1 h-6 w-6 items-center justify-center rounded-full bg-black/60"
            >
              <X size={14} color="#FFFFFF" />
            </Pressable>
          </Pressable>
        ))}
      </ScrollView>
      {uris.length > 1 ? (
        <Text className="text-[13px] text-muted">Tap a photo to make it the cover.</Text>
      ) : null}
    </View>
  );
}

function AddTile({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label === "Camera" ? "Take a photo" : "Add photos"}
      onPress={onPress}
      className="h-20 w-20 items-center justify-center gap-1 rounded-xl border border-dashed border-line"
    >
      {children}
      <Text className="text-[11px] text-muted">{label}</Text>
    </Pressable>
  );
}
