import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";

import { conditionLabel } from "@/features/listings/types";
import { ConditionChips, FieldError, PostFooter, Section } from "@/features/sell/form";
import { errorField, errorMessage } from "@/lib/errors";
import { formatPrice, parsePrice } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Header } from "@/ui/Header";
import { Screen } from "@/ui/Screen";

type Item = {
  id: string;
  position: number;
  name: string;
  price_cents: number;
  condition: string;
  status: "available" | "reserved" | "sold";
};
type Listing = {
  id: string;
  kind: "item" | "bundle" | "wanted";
  title: string;
  description: string;
  budget_cents: number | null;
  items: Item[];
};
type Draft = {
  title: string;
  description: string;
  budget: string;
  items: Record<string, { name: string; price: string; condition: string }>;
};

async function fetchListing(id: string): Promise<Listing | null> {
  const { data } = await supabase
    .from("listings")
    .select(
      "id, kind, title, description, budget_cents, items(id, position, name, price_cents, condition, status)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as Listing | null) ?? null;
}

const dollars = (cents: number) => (cents === 0 ? "0" : formatPrice(cents).replace("$", ""));

function draftOf(listing: Listing): Draft {
  return {
    title: listing.title,
    description: listing.description,
    budget: listing.budget_cents != null ? dollars(listing.budget_cents) : "",
    items: Object.fromEntries(
      listing.items.map((i) => [
        i.id,
        { name: i.name, price: dollars(i.price_cents), condition: i.condition },
      ]),
    ),
  };
}

// Edit a listing (APP-20, update_listing): title, description, budget, and the name, price and condition
// of items that are still available. Reserved and sold items stay as they are, so a trade's terms never
// shift (spec 4.7). ponytail: photos, category and trade options are edited by posting again for now.
export default function EditListing() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [listing, setListing] = useState<Listing | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; field: string | null } | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let alive = true;
    void fetchListing(id).then((next) => {
      if (!alive) return;
      setListing(next);
      if (next) setDraft(draftOf(next));
    });
    return () => {
      alive = false;
    };
  }, [id, reloads]);

  if (listing === undefined || (listing && !draft)) {
    return (
      <>
        <Header title="Edit listing" />
        <ActivityIndicator className="flex-1 bg-bg" />
      </>
    );
  }
  if (!listing || !draft) {
    return (
      <>
        <Header title="Edit listing" />
        <Text className="flex-1 bg-bg px-8 pt-16 text-center text-base text-muted">
          {"This listing isn't available."}
        </Text>
      </>
    );
  }

  const items = [...listing.items].sort((a, b) => a.position - b.position);
  const setItem = (itemId: string, patch: Partial<Draft["items"][string]>) =>
    setDraft({ ...draft, items: { ...draft.items, [itemId]: { ...draft.items[itemId], ...patch } } });

  const save = async () => {
    const changes: Record<string, unknown> = {};
    if (draft.title.trim() !== listing.title) changes.title = draft.title.trim();
    if (draft.description.trim() !== listing.description) changes.description = draft.description.trim();
    if (listing.kind === "wanted") {
      const budget = parsePrice(draft.budget);
      if (budget === null) return setError({ text: "Enter a budget like 60.", field: "budget_cents" });
      if (budget !== listing.budget_cents) changes.budget_cents = budget;
    }
    const itemChanges = [];
    for (const item of items.filter((i) => i.status === "available")) {
      const edit = draft.items[item.id];
      const price = parsePrice(edit.price);
      if (price === null)
        return setError({ text: `Enter a price for ${item.name}.`, field: "items.price_cents" });
      if (edit.name.trim() !== item.name || price !== item.price_cents || edit.condition !== item.condition) {
        itemChanges.push({
          position: item.position,
          name: edit.name.trim(),
          price_cents: price,
          condition: edit.condition,
        });
      }
    }
    if (itemChanges.length) changes.items = itemChanges;
    if (!Object.keys(changes).length) return router.back();

    setError(null);
    setStatus("Saving…");
    const { error: rpcError } = await supabase.rpc("update_listing", {
      p_listing_id: listing.id,
      p_changes: changes,
    });
    setStatus(null);
    if (rpcError) return setError({ text: errorMessage(rpcError), field: errorField(rpcError) });
    router.back();
  };

  const markSold = async (item: Item) => {
    const { error: rpcError } = await supabase.rpc("mark_sold_elsewhere", { p_item_ids: [item.id] });
    if (rpcError) return Alert.alert("Couldn't update", errorMessage(rpcError));
    setReloads((n) => n + 1);
  };

  const fieldError = (field: string) => (error?.field === field ? error.text : null);
  return (
    <>
      <Header title="Edit listing" />
      <Screen
        underHeader
        footer={
          <PostFooter
            status={status}
            error={
              error && !["title", "description", "budget_cents"].includes(error.field ?? "")
                ? error.text
                : null
            }
            onPost={() => void save()}
            label="Save"
          />
        }
      >
        <Field
          label="Title"
          value={draft.title}
          onChangeText={(title) => setDraft({ ...draft, title })}
          maxLength={80}
          error={fieldError("title")}
        />
        <Field
          label="Description"
          value={draft.description}
          onChangeText={(description) => setDraft({ ...draft, description })}
          multiline
          maxLength={4000}
          style={{ height: 112, paddingTop: 14, textAlignVertical: "top" }}
          error={fieldError("description")}
        />
        {listing.kind === "wanted" ? (
          <Field
            label="Budget"
            value={draft.budget}
            onChangeText={(budget) => setDraft({ ...draft, budget })}
            keyboardType="decimal-pad"
            error={fieldError("budget_cents")}
          />
        ) : (
          <Section title={listing.kind === "bundle" ? `Items (${items.length})` : "Item"}>
            {items.map((item) =>
              item.status === "available" ? (
                <View key={item.id} className="gap-3 rounded-2xl border border-line p-4">
                  {listing.kind === "bundle" ? (
                    <Field
                      label="Name"
                      value={draft.items[item.id].name}
                      onChangeText={(name) => setItem(item.id, { name })}
                      maxLength={80}
                    />
                  ) : null}
                  <Field
                    label="Price"
                    value={draft.items[item.id].price}
                    onChangeText={(price) => setItem(item.id, { price })}
                    keyboardType="decimal-pad"
                  />
                  <ConditionChips
                    value={draft.items[item.id].condition}
                    onChange={(condition) => setItem(item.id, { condition })}
                  />
                  {listing.kind === "bundle" ? (
                    <Button
                      variant="secondary"
                      label="Mark this item sold elsewhere"
                      onPress={() => void markSold(item)}
                    />
                  ) : null}
                </View>
              ) : (
                <View key={item.id} className="flex-row items-center gap-3 rounded-2xl bg-surface p-4">
                  <View className="flex-1">
                    <Text className="text-[15px] text-ink">{item.name}</Text>
                    <Text className="text-[13px] text-muted">
                      {formatPrice(item.price_cents)} · {conditionLabel(item.condition)}
                    </Text>
                  </View>
                  <Text className="text-[13px] font-extrabold text-muted">
                    {item.status === "reserved" ? "Reserved" : "Sold"}
                  </Text>
                </View>
              ),
            )}
            <FieldError
              text={fieldError("items.price_cents") || fieldError("items.name") || fieldError("items")}
            />
          </Section>
        )}
      </Screen>
    </>
  );
}
