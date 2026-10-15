import { Stack } from "expo-router";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { CategoryField, type CategoryValue } from "@/features/sell/CategoryField";
import { ConditionChips, FieldError, Preview, PostFooter, Section, usePost } from "@/features/sell/form";
import { PhotoPicker } from "@/features/sell/PhotoPicker";
import { NO_TRADE_OPTIONS, TradeOptions, tradeFields } from "@/features/sell/TradeOptions";
import { parsePrice } from "@/lib/format";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";
import { useTheme } from "@/ui/theme";

type SaleItem = { key: number; name: string; price: string; condition: string | null; photos: string[] };

const MAX_ITEMS = 30;
let nextKey = 0;
const blankItem = (): SaleItem => ({ key: nextKey++, name: "", price: "", condition: null, photos: [] });

// Move-out sale: 2 to 30 items in one post, each with its own name, price, condition and photos; each
// sells separately (LST-2, spec 3.3 Bundle items).
export default function PostSale() {
  const { colors } = useTheme();
  const live = useTheme().campus !== null;
  const [title, setTitle] = useState("Move-out sale");
  const [category, setCategory] = useState<CategoryValue | null>({
    category: "other",
    subcategory: "everything_else",
  });
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<SaleItem[]>(() => [blankItem(), blankItem()]);
  const [trade, setTrade] = useState(NO_TRADE_OPTIONS);
  const [checked, setChecked] = useState(false);
  const { post, status, error } = usePost();

  const itemProblem = (item: SaleItem) =>
    !item.name.trim()
      ? "Name the item."
      : parsePrice(item.price) === null
        ? "Enter a price like 15, or 0 for free."
        : !item.condition
          ? "Choose a condition."
          : item.photos.length === 0
            ? "Add at least one photo."
            : null;
  const titleProblem = title.trim().length < 3 && "Use at least 3 characters.";
  const valid = !titleProblem && !!category && items.every((item) => !itemProblem(item));

  const update = (key: number, patch: Partial<SaleItem>) =>
    setItems((list) => list.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  const move = (index: number, by: number) =>
    setItems((list) => {
      const next = [...list];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });

  const submit = () => {
    setChecked(true);
    if (!valid || !category) return;
    void post({
      kind: "bundle",
      fields: {
        title: title.trim(),
        description: description.trim(),
        category: category.category,
        subcategory: category.subcategory,
        ...tradeFields(trade, live),
      },
      items: items.map((item) => ({
        name: item.name.trim(),
        priceCents: parsePrice(item.price)!,
        negotiable: false,
        condition: item.condition!,
        photos: item.photos,
      })),
    });
  };

  const prices = items.map((item) => parsePrice(item.price)).filter((p): p is number => p !== null);
  return (
    <>
      <Stack.Screen options={{ title: "Move-out sale" }} />
      <Screen
        underHeader
        footer={
          <PostFooter
            status={status}
            error={error?.text ?? (checked && !valid ? "Check the highlighted fields." : null)}
            onPost={submit}
          />
        }
      >
        <Section title="Sale">
          <Field
            label="Title"
            value={title}
            onChangeText={setTitle}
            maxLength={80}
            error={(checked && titleProblem) || null}
          />
          <CategoryField value={category} onChange={setCategory} />
          <Field
            label="Description (optional)"
            value={description}
            onChangeText={setDescription}
            placeholder="Pickup window, building, anything buyers should know"
            multiline
            maxLength={4000}
            style={{ height: 96, paddingTop: 14, textAlignVertical: "top" }}
          />
        </Section>

        <Section title={`Items (${items.length})`}>
          {items.map((item, index) => (
            <View key={item.key} className="gap-3 rounded-2xl border border-line p-4">
              <View className="flex-row items-center">
                <Text className="flex-1 text-base font-extrabold text-ink">Item {index + 1}</Text>
                <IconButton label="Move up" disabled={index === 0} onPress={() => move(index, -1)}>
                  <ArrowUp size={18} color={colors.ink} />
                </IconButton>
                <IconButton
                  label="Move down"
                  disabled={index === items.length - 1}
                  onPress={() => move(index, 1)}
                >
                  <ArrowDown size={18} color={colors.ink} />
                </IconButton>
                <IconButton
                  label="Remove item"
                  disabled={items.length <= 2}
                  onPress={() => setItems((list) => list.filter((i) => i.key !== item.key))}
                >
                  <Trash2 size={18} color={colors.ink} />
                </IconButton>
              </View>
              <PhotoPicker uris={item.photos} onChange={(photos) => update(item.key, { photos })} />
              <Field
                label="Name"
                value={item.name}
                onChangeText={(name) => update(item.key, { name })}
                placeholder="e.g. Desk lamp"
                maxLength={80}
              />
              <Field
                label="Price"
                value={item.price}
                onChangeText={(price) => update(item.key, { price })}
                placeholder="0 for free"
                keyboardType="decimal-pad"
              />
              <ConditionChips
                value={item.condition}
                onChange={(condition) => update(item.key, { condition })}
              />
              <FieldError text={checked && itemProblem(item)} />
            </View>
          ))}
          {items.length < MAX_ITEMS ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setItems((list) => [...list, blankItem()])}
              className="h-12 flex-row items-center justify-center gap-2 rounded-2xl border border-dashed border-line"
            >
              <Plus size={18} color={colors.ink} />
              <Text className="text-base font-bold text-ink">Add an item</Text>
            </Pressable>
          ) : null}
        </Section>

        <Section title="Trade options">
          <TradeOptions value={trade} onChange={setTrade} />
        </Section>

        <Preview
          card={{
            kind: "bundle",
            title: title.trim(),
            priceCents: prices.length ? Math.min(...prices) : 0,
            itemCount: items.length,
            campusOnly: live && !trade.alsoOpen,
            image: items[0]?.photos[0] ? { uri: items[0].photos[0] } : null,
          }}
        />
      </Screen>
    </>
  );
}

function IconButton({
  label,
  disabled,
  onPress,
  children,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`h-11 w-11 items-center justify-center ${disabled ? "opacity-30" : ""}`}
    >
      {children}
    </Pressable>
  );
}
