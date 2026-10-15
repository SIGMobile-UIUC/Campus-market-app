import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";

import { CategoryField, type CategoryValue } from "@/features/sell/CategoryField";
import {
  COURSE_CODE,
  ConditionChips,
  FieldError,
  Preview,
  PostFooter,
  Section,
  usePost,
} from "@/features/sell/form";
import { PhotoPicker } from "@/features/sell/PhotoPicker";
import { NO_TRADE_OPTIONS, TradeOptions, tradeFields } from "@/features/sell/TradeOptions";
import { parsePrice } from "@/lib/format";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";
import { useTheme } from "@/ui/theme";
import { Toggle } from "@/ui/Toggle";

// One item, or Give it away with the price fixed at Free (spec 3.3: photos, details, price, trade
// options, preview and post).
export default function PostItem() {
  const { free } = useLocalSearchParams<{ free?: string }>();
  const giveaway = free === "1";
  const live = useTheme().campus !== null;
  const [photos, setPhotos] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<CategoryValue | null>(null);
  const [condition, setCondition] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [negotiable, setNegotiable] = useState(false);
  const [description, setDescription] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [trade, setTrade] = useState(NO_TRADE_OPTIONS);
  const [checked, setChecked] = useState(false);
  const { post, status, error } = usePost();

  const cents = giveaway ? 0 : parsePrice(price);
  const code = courseCode.trim().toUpperCase();
  const problems: Record<string, string | false> = {
    photos: photos.length === 0 && "Add at least one photo.",
    title: title.trim().length < 3 && "Use at least 3 characters.",
    category: !category && "Choose a category.",
    condition: !condition && "Choose a condition.",
    price: cents === null && "Enter a price like 40 or 12.50.",
    course_code: !!code && !COURSE_CODE.test(code) && "Use a course code like CS 124.",
  };
  // Client checks after the first Post tap; server errors for the field otherwise.
  const show = (field: string) =>
    (checked && problems[field]) ||
    (error?.field === field || (field === "title" && error?.field === "items.name") ? error.text : null);
  const shownFields = ["photos", "title", "category", "condition", "price", "course_code", "description"];

  const submit = () => {
    setChecked(true);
    if (Object.values(problems).some(Boolean) || !category || !condition || cents === null) return;
    void post({
      kind: "item",
      fields: {
        title: title.trim(),
        description: description.trim(),
        category: category.category,
        subcategory: category.subcategory,
        course_code: code || null,
        ...tradeFields(trade, live),
      },
      items: [{ name: title.trim(), priceCents: cents, negotiable, condition, photos }],
    });
  };

  return (
    <>
      <Stack.Screen options={{ title: giveaway ? "Give it away" : "Sell an item" }} />
      <Screen
        underHeader
        footer={
          <PostFooter
            status={status}
            error={error && !shownFields.includes(error.field ?? "") ? error.text : null}
            onPost={submit}
          />
        }
      >
        <PhotoPicker uris={photos} onChange={setPhotos} />
        <FieldError text={show("photos")} />

        <Section title="Details">
          <Field
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. IKEA desk, white"
            maxLength={80}
            error={show("title") || null}
          />
          <CategoryField value={category} onChange={setCategory} error={show("category") || null} />
          <ConditionChips value={condition} onChange={setCondition} error={show("condition") || null} />
          {category?.category === "textbooks" ? (
            <Field
              label="Course code (optional)"
              value={courseCode}
              onChangeText={setCourseCode}
              placeholder="e.g. CS 124"
              autoCapitalize="characters"
              error={show("course_code") || null}
            />
          ) : null}
          <Field
            label="Description (optional)"
            value={description}
            onChangeText={setDescription}
            placeholder="Size, age, flaws, pickup notes"
            multiline
            maxLength={4000}
            style={{ height: 112, paddingTop: 14, textAlignVertical: "top" }}
            error={show("description") || null}
          />
        </Section>

        {giveaway ? null : (
          <Section title="Price">
            <Field
              label="Price"
              value={price}
              onChangeText={setPrice}
              placeholder="$0 for free"
              keyboardType="decimal-pad"
              error={show("price") || null}
            />
            <Toggle label="Open to offers" value={negotiable} onChange={setNegotiable} />
          </Section>
        )}

        <Section title="Trade options">
          <TradeOptions value={trade} onChange={setTrade} />
        </Section>

        <Preview
          card={{
            kind: "item",
            title: title.trim(),
            priceCents: cents ?? 0,
            itemCount: 1,
            campusOnly: live && !trade.alsoOpen,
            image: photos[0] ? { uri: photos[0] } : null,
          }}
        />
      </Screen>
    </>
  );
}
