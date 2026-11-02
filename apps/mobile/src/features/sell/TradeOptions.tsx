import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { useAccount } from "@/features/account/account";
import { PAYMENTS } from "@/features/listings/types";
import { supabase } from "@/lib/supabase";
import { Chip } from "@/ui/Chip";
import { Field } from "@/ui/Field";
import { Toggle } from "@/ui/Toggle";

export type TradeOptionsValue = {
  zoneId: string | null;
  meetPlace: string;
  paymentMethods: string[];
  alsoOpen: boolean;
  zip: string;
};

export const NO_TRADE_OPTIONS: TradeOptionsValue = {
  zoneId: null,
  meetPlace: "",
  paymentMethods: [],
  alsoOpen: false,
  zip: "",
};

// Spec 3.3 Trade options: a meetup zone when the campus has zones, a place the seller may type (zones
// cannot cover every street a campus blends into), ZIP code for general users, payment methods, and
// "Also show in the open market" (students, off by default).
export function TradeOptions({
  value,
  onChange,
}: {
  value: TradeOptionsValue;
  onChange: (value: TradeOptionsValue) => void;
}) {
  const { account } = useAccount();
  const campus = account?.campus;
  const live = campus?.status === "live";
  const [zones, setZones] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!live || !campus) return;
    void supabase
      .from("campus_zones")
      .select("id, name")
      .eq("campus_id", campus.id)
      .order("sort_order")
      .then(({ data }) => setZones(data ?? []));
  }, [live, campus]);

  const set = (patch: Partial<TradeOptionsValue>) => onChange({ ...value, ...patch });
  const togglePayment = (id: string) =>
    set({
      paymentMethods: value.paymentMethods.includes(id)
        ? value.paymentMethods.filter((p) => p !== id)
        : [...value.paymentMethods, id],
    });

  return (
    <View className="gap-4">
      {live && zones.length ? (
        <View className="gap-2">
          <Text className="text-sm font-bold text-ink">Meetup zone</Text>
          <View className="flex-row flex-wrap gap-2">
            {zones.map((zone) => (
              <Chip
                key={zone.id}
                label={zone.name}
                selected={value.zoneId === zone.id}
                onPress={() => set({ zoneId: value.zoneId === zone.id ? null : zone.id })}
              />
            ))}
          </View>
        </View>
      ) : null}
      <Field
        label="Meetup place (optional)"
        value={value.meetPlace}
        onChangeText={(meetPlace) => set({ meetPlace })}
        placeholder="e.g. Illini Union, Green St & 6th"
        hint="A public spot or cross streets, not your home address. Buyers can open it in their maps app."
        maxLength={80}
      />
      {!campus ? (
        <Field
          label="ZIP code"
          value={value.zip}
          onChangeText={(text) => set({ zip: text.replace(/\D/g, "").slice(0, 5) })}
          placeholder="Your ZIP code"
          hint="Leave empty to use the ZIP code from your profile."
          keyboardType="number-pad"
          maxLength={5}
        />
      ) : null}
      <View className="gap-2">
        <Text className="text-sm font-bold text-ink">Payment</Text>
        <View className="flex-row flex-wrap gap-2">
          {PAYMENTS.map(([id, label]) => (
            <Chip
              key={id}
              label={label}
              selected={value.paymentMethods.includes(id)}
              onPress={() => togglePayment(id)}
            />
          ))}
        </View>
      </View>
      {live ? (
        <Toggle
          label="Also show in the open market"
          detail={`Off: only verified ${campus.short_name ?? campus.name} students see it.`}
          value={value.alsoOpen}
          onChange={(alsoOpen) => set({ alsoOpen })}
        />
      ) : (
        <Text className="text-[13px] text-muted">This posts to the open market.</Text>
      )}
    </View>
  );
}

// Listing fields for create_listing from the trade options.
export function tradeFields(value: TradeOptionsValue, live: boolean) {
  return {
    zone_id: value.zoneId,
    ...(value.meetPlace.trim() ? { meet_place: value.meetPlace.trim() } : {}),
    payment_methods: value.paymentMethods,
    visibility: live && !value.alsoOpen ? "campus" : "open",
    ...(value.zip ? { zip: value.zip } : {}),
  };
}
