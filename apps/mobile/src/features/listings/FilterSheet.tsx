import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAccount } from "@/features/account/account";
import { formatPrice, parsePrice } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { Field } from "@/ui/Field";
import { Toggle } from "@/ui/Toggle";

import { CONDITIONS, type Filters, type Sort } from "./types";

export const SORTS: [Sort, string][] = [
  ["newest", "Newest"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
];

// The filters a user sets in the sheet; mode, category and subcategory come from the screen.
export type Refine = Pick<Filters, "condition" | "zone_id" | "price_min" | "price_max" | "free_only"> & {
  sort: Sort;
};

export const NO_REFINE: Refine = { sort: "newest" };

export function refineCount(refine: Refine) {
  return ["condition", "zone_id", "price_min", "price_max", "free_only"].filter(
    (key) => refine[key as keyof Refine] != null && refine[key as keyof Refine] !== false,
  ).length;
}

// Spec DSC-2 and 3.3: price range, condition, pickup zone (campus market), free only, sort.
export function FilterSheet({
  visible,
  value,
  campusScope,
  onApply,
  onClose,
}: {
  visible: boolean;
  value: Refine;
  campusScope: boolean;
  onApply: (value: Refine) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { account } = useAccount();
  const [draft, setDraft] = useState(value);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [zones, setZones] = useState<{ id: string; name: string }[]>([]);
  const campusId = campusScope ? account?.campus?.id : undefined;

  useEffect(() => {
    if (!campusId) return;
    void supabase
      .from("campus_zones")
      .select("id, name")
      .eq("campus_id", campusId)
      .order("sort_order")
      .then(({ data }) => setZones(data ?? []));
  }, [campusId]);

  const set = (patch: Partial<Refine>) => setDraft((d) => ({ ...d, ...patch }));
  const reset = () => {
    setDraft(NO_REFINE);
    setMin("");
    setMax("");
  };
  const apply = () => {
    const priceMin = parsePrice(min);
    const priceMax = parsePrice(max);
    onApply({ ...draft, price_min: priceMin ?? undefined, price_max: priceMax ?? undefined });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => {
        setDraft(value);
        setMin(value.price_min != null ? formatPrice(value.price_min).replace("Free", "0") : "");
        setMax(value.price_max != null ? formatPrice(value.price_max).replace("Free", "0") : "");
      }}
    >
      <Pressable accessibilityLabel="Close filters" className="flex-1 bg-black/40" onPress={onClose} />
      <View className="max-h-[85%] rounded-t-3xl bg-bg" style={{ paddingBottom: insets.bottom + 12 }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" className="text-xl font-extrabold text-ink">
            Filters
          </Text>
          <Group title="Sort">
            {SORTS.map(([id, label]) => (
              <Chip key={id} label={label} selected={draft.sort === id} onPress={() => set({ sort: id })} />
            ))}
          </Group>
          <Group title="Condition">
            {CONDITIONS.map(([id, label]) => (
              <Chip
                key={id}
                label={label}
                selected={draft.condition === id}
                onPress={() => set({ condition: draft.condition === id ? undefined : id })}
              />
            ))}
          </Group>
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Field
                label="Min price"
                value={min}
                onChangeText={setMin}
                placeholder="$0"
                keyboardType="decimal-pad"
              />
            </View>
            <View className="flex-1">
              <Field
                label="Max price"
                value={max}
                onChangeText={setMax}
                placeholder="Any"
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          <Toggle
            label="Free only"
            value={!!draft.free_only}
            onChange={(on) => set({ free_only: on || undefined })}
          />
          {zones.length ? (
            <Group title="Pickup zone">
              {zones.map((zone) => (
                <Chip
                  key={zone.id}
                  label={zone.name}
                  selected={draft.zone_id === zone.id}
                  onPress={() => set({ zone_id: draft.zone_id === zone.id ? undefined : zone.id })}
                />
              ))}
            </Group>
          ) : null}
        </ScrollView>
        <View className="flex-row gap-3 px-6">
          <View className="flex-1">
            <Button variant="secondary" label="Reset" onPress={reset} />
          </View>
          <View className="flex-1">
            <Button label="Show results" onPress={apply} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-bold text-ink">{title}</Text>
      <View className="flex-row flex-wrap gap-2">{children}</View>
    </View>
  );
}
