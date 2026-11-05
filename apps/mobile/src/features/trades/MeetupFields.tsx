import { useRef, useState, type ReactNode } from "react";
import { ScrollView, Text, View, type LayoutChangeEvent } from "react-native";

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
// Today offers only times at least 15 minutes ahead.
function timesFor(day: number) {
  const now = new Date();
  return TIMES.filter((m) => day !== 0 || m > now.getHours() * 60 + now.getMinutes() + 15);
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
  if (meetupMissing(m)) return null;
  return {
    meet_at: new Date(dayStart(m.day!).getTime() + m.time! * 60_000).toISOString(),
    spot_id: m.spot,
    place_text: m.spot ? null : m.place.trim(),
  };
}

// A meetup from an earlier proposal, when its time still fits the choices (a counter offer).
export function meetupFrom(meetAt: string, spot: string | null, place: string | null): Meetup {
  const at = new Date(meetAt);
  const day = Math.round((new Date(at).setHours(0, 0, 0, 0) - dayStart(0).getTime()) / 86_400_000);
  const time = at.getHours() * 60 + at.getMinutes();
  const fits = day >= 0 && day < 7 && timesFor(day).includes(time);
  return { day: fits ? day : null, time: fits ? time : null, spot, place: spot ? "" : (place ?? "") };
}

export type MeetupStep = "day" | "time" | "place";
export function meetupMissing(m: Meetup): MeetupStep | null {
  return m.day === null
    ? "day"
    : m.time === null
      ? "time"
      : m.spot === null && !m.place.trim()
        ? "place"
        : null;
}
export const MEETUP_STEPS: Record<MeetupStep, [button: string, hint: string]> = {
  day: ["Pick a day", "Pick the day you'll meet."],
  time: ["Pick a time", "Pick a time on that day."],
  place: ["Pick a place", "Pick a spot or type a busy public place."],
};

// A send button that names the first missing step; pressed, it scrolls to that step and says what to do.
export function useMissingGuide<K extends string>() {
  const scroll = useRef<ScrollView>(null);
  const positions = useRef<Partial<Record<K, number>>>({});
  const [shown, setShown] = useState<K | null>(null);
  return {
    scroll,
    shown,
    at: (key: K) => (e: LayoutChangeEvent) => {
      positions.current[key] = e.nativeEvent.layout.y;
    },
    show: (key: K) => {
      setShown(key);
      scroll.current?.scrollTo({ y: Math.max(0, (positions.current[key] ?? 0) - 12), animated: true });
    },
  };
}

export function MeetupFields({
  spots,
  value,
  onChange,
  hint = null,
  onLayout,
}: {
  spots: { id: string; name: string }[];
  value: Meetup;
  onChange: (next: Meetup) => void;
  // The step to explain, after a press on a send button that named it.
  hint?: MeetupStep | null;
  onLayout?: (step: MeetupStep) => (e: LayoutChangeEvent) => void;
}) {
  const set = (changes: Partial<Meetup>) => onChange({ ...value, ...changes });
  const times = value.day === null ? [] : timesFor(value.day);
  return (
    <>
      <Section label="Day" hint={hint === "day" ? MEETUP_STEPS.day[1] : null} onLayout={onLayout?.("day")}>
        <ChipRow>
          {Array.from({ length: 7 }, (_, offset) => (
            <Chip
              key={offset}
              label={dayLabel(offset)}
              selected={value.day === offset}
              // The chosen time stays when the new day still offers it.
              onPress={() =>
                set({
                  day: offset,
                  time: value.time !== null && timesFor(offset).includes(value.time) ? value.time : null,
                })
              }
            />
          ))}
        </ChipRow>
      </Section>

      <Section
        label="Time"
        hint={hint === "time" ? MEETUP_STEPS.time[1] : null}
        onLayout={onLayout?.("time")}
      >
        {value.day === null ? (
          <Text className="text-[13px] text-muted">Pick a day first.</Text>
        ) : times.length ? (
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
        ) : (
          <Text className="text-[13px] text-muted">No meetup times left today. Pick another day.</Text>
        )}
      </Section>

      <Section
        label="Where"
        hint={hint === "place" ? MEETUP_STEPS.place[1] : null}
        onLayout={onLayout?.("place")}
      >
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

export function Section({
  label,
  hint = null,
  onLayout,
  children,
}: {
  label: string;
  // What to do here, shown in the warning color after a send button pointed at this step.
  hint?: string | null;
  onLayout?: (e: LayoutChangeEvent) => void;
  children: ReactNode;
}) {
  return (
    <View className="gap-2" onLayout={onLayout}>
      <Text className="text-sm font-bold text-ink">{label}</Text>
      {hint ? <Text className="text-[13px] font-bold text-warning">{hint}</Text> : null}
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
