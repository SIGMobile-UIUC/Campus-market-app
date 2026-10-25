import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";

import { supabase } from "@/lib/supabase";
import { Chip } from "@/ui/Chip";
import { Field } from "@/ui/Field";

// When and where for a proposal or offer (TRD-1): a day in the next 7, a time on the half hour from
// 8 AM to 9:30 PM, and a campus spot or a typed place.
export type Meetup = { day: number | null; time: number | null; spot: string | null; place: string };
export const NO_MEETUP: Meetup = { day: null, time: null, spot: null, place: "" };

const TIMES = Array.from({ length: 28 }, (_, i) => 8 * 60 + i * 30);
function dayStart(offset: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}
const dayLabel = (offset: number) =>
  offset === 0
    ? "Today"
    : offset === 1
      ? "Tomorrow"
      : dayStart(offset).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const timeLabel = (minutes: number) =>
  new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

// The proposal fields for propose_trade, or null until a time and a place are chosen.
export function meetupPayload(m: Meetup) {
  if (m.day === null || m.time === null || (m.spot === null && !m.place.trim())) return null;
  return {
    meet_at: new Date(dayStart(m.day).getTime() + m.time * 60_000).toISOString(),
    spot_id: m.spot,
    place_text: m.spot ? null : m.place.trim(),
  };
}

export function MeetupFields({
  spots,
  value,
  onChange,
}: {
  spots: { id: string; name: string }[];
  value: Meetup;
  onChange: (next: Meetup) => void;
}) {
  const set = (changes: Partial<Meetup>) => onChange({ ...value, ...changes });
  const now = new Date();
  // Today offers only times at least 15 minutes ahead.
  const times = TIMES.filter((m) => value.day !== 0 || m > now.getHours() * 60 + now.getMinutes() + 15);
  return (
    <>
      <Section label="When">
        <ChipRow>
          {Array.from({ length: 7 }, (_, offset) => (
            <Chip
              key={offset}
              label={dayLabel(offset)}
              selected={value.day === offset}
              onPress={() => set({ day: offset, time: null })}
            />
          ))}
        </ChipRow>
        {value.day !== null && !times.length ? (
          <Text className="text-[13px] text-muted">No meetup times left today. Pick another day.</Text>
        ) : null}
        {value.day !== null && times.length ? (
          <ChipRow>
            {times.map((m) => (
              <Chip
                key={m}
                label={timeLabel(m)}
                selected={value.time === m}
                onPress={() => set({ time: m })}
              />
            ))}
          </ChipRow>
        ) : null}
      </Section>

      <Section label="Where">
        {spots.length ? (
          <View className="flex-row flex-wrap gap-2">
            {spots.map((s) => (
              <Chip
                key={s.id}
                label={s.name}
                selected={value.spot === s.id}
                onPress={() => set({ spot: value.spot === s.id ? null : s.id })}
              />
            ))}
          </View>
        ) : null}
        <Field
          label={spots.length ? "Or type a place" : "Place"}
          value={value.place}
          onChangeText={(place) => set({ place, spot: place ? null : value.spot })}
          placeholder="A busy public place"
          maxLength={120}
        />
      </Section>
    </>
  );
}

export function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-bold text-ink">{label}</Text>
      {children}
    </View>
  );
}

function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {children}
    </ScrollView>
  );
}

// The campus's meetup spots, or none for an open-market listing without a campus.
export async function loadSpots(campusId: string | null): Promise<{ id: string; name: string }[]> {
  if (!campusId) return [];
  const { data } = await supabase
    .from("meetup_spots")
    .select("id, name")
    .eq("campus_id", campusId)
    .order("name");
  return data ?? [];
}
