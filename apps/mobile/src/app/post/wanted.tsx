import { Stack } from "expo-router";
import { useState } from "react";

import { CategoryField, type CategoryValue } from "@/features/sell/CategoryField";
import { Preview, PostFooter, Section, usePost } from "@/features/sell/form";
import { NO_TRADE_OPTIONS, TradeOptions, tradeFields } from "@/features/sell/TradeOptions";
import { parsePrice } from "@/lib/format";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";
import { useTheme } from "@/ui/theme";

// Wanted request: what you are looking for and a budget; sellers answer in chat (LST-3).
export default function PostWanted() {
  const live = useTheme().campus !== null;
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<CategoryValue | null>(null);
  const [budget, setBudget] = useState("");
  const [description, setDescription] = useState("");
  const [trade, setTrade] = useState(NO_TRADE_OPTIONS);
  const [checked, setChecked] = useState(false);
  const { post, status, error } = usePost();

  const cents = parsePrice(budget);
  const problems: Record<string, string | false> = {
    title: title.trim().length < 3 && "Use at least 3 characters.",
    category: !category && "Choose a category.",
    budget_cents: cents === null && "Enter a budget like 60.",
  };
  const show = (field: string) =>
    (checked && problems[field]) || (error?.field === field ? error.text : null);

  const submit = () => {
    setChecked(true);
    if (Object.values(problems).some(Boolean) || !category || cents === null) return;
    void post({
      kind: "wanted",
      fields: {
        title: title.trim(),
        description: description.trim(),
        category: category.category,
        subcategory: category.subcategory,
        budget_cents: cents,
        ...tradeFields(trade, live),
      },
      items: [],
    });
  };

  return (
    <>
      <Stack.Screen options={{ title: "Wanted request" }} />
      <Screen
        underHeader
        footer={
          <PostFooter
            status={status}
            error={
              error && !["title", "category", "budget_cents"].includes(error.field ?? "") ? error.text : null
            }
            onPost={submit}
          />
        }
      >
        <Section title="What are you looking for?">
          <Field
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Mini fridge for a dorm"
            maxLength={80}
            error={show("title") || null}
          />
          <CategoryField value={category} onChange={setCategory} error={show("category") || null} />
          <Field
            label="Budget"
            value={budget}
            onChangeText={setBudget}
            placeholder="e.g. 60"
            keyboardType="decimal-pad"
            error={show("budget_cents") || null}
          />
          <Field
            label="Details (optional)"
            value={description}
            onChangeText={setDescription}
            placeholder="Size, condition you'd accept, when you need it"
            multiline
            maxLength={4000}
            style={{ height: 96, paddingTop: 14, textAlignVertical: "top" }}
          />
        </Section>
        <Section title="Trade options">
          <TradeOptions value={trade} onChange={setTrade} />
        </Section>
        <Preview
          card={{
            kind: "wanted",
            title: title.trim(),
            priceCents: cents ?? 0,
            itemCount: 0,
            campusOnly: live && !trade.alsoOpen,
            image: null,
          }}
        />
      </Screen>
    </>
  );
}
