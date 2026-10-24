import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Check, Heart } from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAccount } from "@/features/account/account";
import { openChat } from "@/features/chat/api";
import { Avatar, type Loadout } from "@/features/avatar/Avatar";
import { conditionLabel } from "@/features/listings/types";
import { errorMessage } from "@/lib/errors";
import { formatAgo, formatPrice } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { GradeBadge } from "@/ui/GradeBadge";
import { Header } from "@/ui/Header";
import { Photo } from "@/ui/Photo";
import { TextLink } from "@/ui/TextLink";
import { useTheme } from "@/ui/theme";

type Item = {
  id: string;
  position: number;
  name: string;
  price_cents: number;
  negotiable: boolean;
  condition: string;
  status: "available" | "reserved" | "sold";
};
type PhotoRow = {
  id: string;
  path: string | null;
  thumb_path: string;
  blurhash: string;
  position: number;
  item_id: string | null;
};
type Listing = {
  id: string;
  owner_id: string;
  kind: "item" | "bundle" | "wanted";
  title: string;
  description: string;
  visibility: "campus" | "open";
  area_label: string;
  payment_methods: string[];
  budget_cents: number | null;
  status: "active" | "sold_out" | "closed";
  bumped_at: string;
  zone: { name: string } | null;
  items: Item[];
  listing_photos: PhotoRow[];
  owner: {
    display_name: string;
    tier: string;
    campus: { short_name: string | null; name: string } | null;
    avatar_loadout: { slot: string; shop_items: { asset_key: string } | null }[];
  } | null;
};

// Readable through the listings policy only, so a listing the caller may not see comes back empty.
const SELECT = `id, owner_id, kind, title, description, visibility, area_label, payment_methods, budget_cents, status,
  bumped_at, zone:campus_zones(name), items(id, position, name, price_cents, negotiable, condition, status),
  listing_photos(id, path, thumb_path, blurhash, position, item_id),
  owner:profiles!listings_owner_id_fkey(display_name, tier, campus:campuses!profiles_campus_id_fkey(short_name, name),
    avatar_loadout(slot, shop_items(asset_key)))`;
// Named foreign keys: profiles also reach listings through favorites, and campuses reach profiles
// through user_roles, so PostgREST cannot pick the relationship on its own.

// null: not found or not visible to the caller; "failed": the request itself failed.
async function fetchListing(id: string): Promise<{ listing: Listing | null | "failed"; saved: boolean }> {
  const [{ data, error }, favorite] = await Promise.all([
    supabase.from("listings").select(SELECT).eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("favorites").select("listing_id").eq("listing_id", id).maybeSingle(),
  ]);
  if (error) return { listing: "failed", saved: false };
  return { listing: (data as unknown as Listing) ?? null, saved: !!favorite.data };
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Cash",
  venmo: "Venmo",
  zelle: "Zelle",
  paypal: "PayPal",
  apple_pay: "Apple Pay",
  cash_app: "Cash App",
};

// Listing page (spec 3.3). ponytail: trade count and reply time come with trades and chat (M3), the
// meetup map and similar items (DSC-6, P1) later; saves count for sellers comes with My listings (APP-20).
export default function ListingPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAccount();
  const insets = useSafeAreaInsets();
  const [listing, setListing] = useState<Listing | null | "failed" | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [opening, setOpening] = useState(false);
  // Items picked on a move-out sale carry over to the proposal sheet (APP-10).
  const [picked, setPicked] = useState<string[]>([]);

  // On focus, so coming back from the editor shows the saved changes.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void fetchListing(id).then((result) => {
        if (!alive) return;
        setListing(result.listing);
        setSaved(result.saved);
      });
      return () => {
        alive = false;
      };
    }, [id]),
  );

  const reload = () =>
    void fetchListing(id).then((result) => {
      setListing(result.listing);
      setSaved(result.saved);
    });

  if (listing === undefined) {
    return (
      <>
        <Header title="" />
        <ActivityIndicator className="flex-1 bg-bg" />
      </>
    );
  }
  if (listing === "failed") {
    return (
      <>
        <Header title="" />
        <View className="flex-1 items-center gap-2 bg-bg px-8 pt-16">
          <Text className="text-center text-base text-muted">{"We couldn't load this listing."}</Text>
          <TextLink label="Try again" onPress={reload} />
        </View>
      </>
    );
  }
  if (!listing) {
    return (
      <>
        <Header title="" />
        <Text className="flex-1 bg-bg px-8 pt-16 text-center text-base text-muted">
          {"This listing isn't available. It may have been removed, or it's only for another campus."}
        </Text>
      </>
    );
  }

  const mine = listing.owner_id === session?.user.id;
  const toggleSave = async () => {
    const next = !saved;
    setSaved(next);
    const { error } = next
      ? await supabase.from("favorites").insert({ user_id: session?.user.id, listing_id: listing.id })
      : await supabase
          .from("favorites")
          .delete()
          .eq("listing_id", listing.id)
          .eq("user_id", session?.user.id ?? "");
    if (error) setSaved(!next);
  };

  return (
    <View className="flex-1 bg-bg">
      <Header title="" />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <Carousel photos={listing.listing_photos} />
        <View className="gap-5 px-5 pt-4">
          <Seller listing={listing} />
          <Summary listing={listing} />
          {listing.kind === "bundle" ? (
            <SaleItems
              listing={listing}
              picked={mine ? null : picked}
              onToggle={(itemId) =>
                setPicked((current) =>
                  current.includes(itemId) ? current.filter((i) => i !== itemId) : [...current, itemId],
                )
              }
            />
          ) : null}
          {listing.description ? (
            <Text className="text-base leading-6 text-ink">{listing.description}</Text>
          ) : null}
          <View className="gap-1 rounded-2xl bg-surface p-4">
            <Text className="text-sm font-bold text-ink">Meetup</Text>
            <Text className="text-[15px] text-ink">
              {listing.zone ? `${listing.zone.name} · ${listing.area_label}` : listing.area_label}
            </Text>
            <Text className="text-[13px] text-muted">
              Meet in a public place and check the item before you pay.
            </Text>
          </View>
        </View>
      </ScrollView>
      <View
        className="flex-row items-center gap-3 border-t border-line px-5 pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      >
        {mine ? (
          <OwnerActions listing={listing} onChanged={reload} />
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={saved ? "Remove from favorites" : "Save to favorites"}
              accessibilityState={{ selected: saved }}
              onPress={() => void toggleSave()}
              className="h-12 w-12 items-center justify-center rounded-2xl border border-line"
            >
              <SaveIcon saved={saved} />
            </Pressable>
            <View className="flex-1">
              {/* ponytail: "I have this" opens the chat until the offer sheet of APP-18. */}
              <Button
                label={
                  listing.kind === "wanted"
                    ? "I have this"
                    : picked.length
                      ? `Ask about ${picked.length} ${picked.length === 1 ? "item" : "items"}`
                      : "Chat with seller"
                }
                disabled={opening}
                onPress={() => {
                  setOpening(true);
                  void openChat(listing.id, picked).finally(() => setOpening(false));
                }}
              />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function SaveIcon({ saved }: { saved: boolean }) {
  const { colors } = useTheme();
  return (
    <Heart
      size={22}
      color={saved ? colors.danger : colors.ink}
      fill={saved ? colors.danger : "transparent"}
    />
  );
}

function Carousel({ photos }: { photos: PhotoRow[] }) {
  const width = useWindowDimensions().width;
  const [index, setIndex] = useState(0);
  const sorted = [...photos].sort((a, b) => a.position - b.position);
  if (!sorted.length) return null;
  return (
    <View>
      <FlatList
        data={sorted}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(photo) => photo.id}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index: n }) => (
          <Photo
            path={item.path ?? item.thumb_path}
            blurhash={item.blurhash}
            style={{ width, height: width * 0.8 }}
            accessibilityLabel={`Photo ${n + 1} of ${sorted.length}`}
          />
        )}
      />
      {sorted.length > 1 ? (
        <View className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1">
          <Text className="text-xs font-bold text-white">
            {index + 1}/{sorted.length}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Seller({ listing }: { listing: Listing }) {
  const owner = listing.owner;
  const loadout = Object.fromEntries(
    (owner?.avatar_loadout ?? []).map((l) => [l.slot, l.shop_items?.asset_key]),
  ) as Loadout;
  return (
    <View className="flex-row items-center gap-3">
      <Avatar loadout={loadout} size={44} />
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className="text-base font-extrabold text-ink">{owner?.display_name ?? "Deleted user"}</Text>
          {owner ? <GradeBadge tier={owner.tier} /> : null}
        </View>
        <Text className="text-[13px] text-muted">
          {owner?.campus
            ? `Verified ${owner.campus.short_name ?? owner.campus.name} student`
            : "Open market member"}
        </Text>
      </View>
    </View>
  );
}

function Summary({ listing }: { listing: Listing }) {
  const item = listing.kind === "item" ? listing.items[0] : null;
  const available = listing.items.filter((i) => i.status === "available");
  const price =
    listing.kind === "wanted"
      ? `Budget ${formatPrice(listing.budget_cents ?? 0)}`
      : item
        ? formatPrice(item.price_cents)
        : `From ${formatPrice(Math.min(...(available.length ? available : listing.items).map((i) => i.price_cents)))}`;
  const chips = [
    item ? conditionLabel(item.condition) : null,
    item?.negotiable ? "Open to offers" : null,
    ...listing.payment_methods.map((p) => PAYMENT_LABELS[p] ?? p),
  ].filter(Boolean) as string[];
  const status =
    listing.status === "sold_out"
      ? "Sold"
      : listing.status === "closed"
        ? "Closed"
        : item?.status === "reserved"
          ? "Reserved"
          : null;

  return (
    <View className="gap-2">
      <Text accessibilityRole="header" className="text-[22px] font-extrabold text-ink">
        {listing.title}
      </Text>
      <View className="flex-row items-center gap-2">
        <Text className="text-xl font-extrabold text-ink">{price}</Text>
        {status ? <StatusBadge label={status} /> : null}
      </View>
      {chips.length ? (
        <View className="flex-row flex-wrap gap-1.5">
          {chips.map((chip) => (
            <View key={chip} className="rounded-full bg-surface px-3 py-1">
              <Text className="text-[13px] text-ink">{chip}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text className="text-[13px] text-muted">
        {[formatAgo(listing.bumped_at), listing.visibility === "campus" ? "Campus only" : "Open market"].join(
          " · ",
        )}
      </Text>
    </View>
  );
}

// Spec 3.6.1 badges: Reserved warning, Sold and Closed muted; the word always says it.
function StatusBadge({ label }: { label: string }) {
  const warning = label === "Reserved";
  return (
    <View className={`rounded-md px-2 py-0.5 ${warning ? "bg-warning" : "bg-surface"}`}>
      <Text className={`text-xs font-extrabold ${warning ? "text-bg" : "text-muted"}`}>{label}</Text>
    </View>
  );
}

// Buyers tick available items to ask about them together; picked is null for the owner.
function SaleItems({
  listing,
  picked,
  onToggle,
}: {
  listing: Listing;
  picked: string[] | null;
  onToggle: (itemId: string) => void;
}) {
  const { colors } = useTheme();
  const items = [...listing.items].sort((a, b) => a.position - b.position);
  return (
    <View className="gap-1">
      <Text accessibilityRole="header" className="pb-1 text-lg font-extrabold text-ink">
        {items.length} items
      </Text>
      {items.map((item) => {
        const cover = listing.listing_photos
          .filter((p) => p.item_id === item.id)
          .sort((a, b) => a.position - b.position)[0];
        const selectable = picked !== null && item.status === "available";
        const checked = !!picked?.includes(item.id);
        return (
          <Pressable
            key={item.id}
            accessibilityRole={selectable ? "checkbox" : undefined}
            accessibilityState={selectable ? { checked } : undefined}
            disabled={!selectable}
            onPress={() => onToggle(item.id)}
            className={`flex-row items-center gap-3 py-2 ${item.status === "available" ? "" : "opacity-50"}`}
          >
            {selectable ? (
              <View
                className={`h-6 w-6 items-center justify-center rounded-md ${checked ? "bg-ink" : "border border-line"}`}
              >
                {checked ? <Check size={16} color={colors.bg} strokeWidth={3} /> : null}
              </View>
            ) : null}
            {cover ? (
              <Photo
                path={cover.thumb_path}
                blurhash={cover.blurhash}
                style={{ width: 56, height: 56, borderRadius: 10 }}
              />
            ) : (
              <View className="h-14 w-14 rounded-[10px] bg-surface" />
            )}
            <View className="flex-1">
              <Text className="text-[15px] text-ink">{item.name}</Text>
              <Text className="text-[13px] text-muted">{conditionLabel(item.condition)}</Text>
            </View>
            {item.status === "available" ? (
              <Text className="text-[15px] font-extrabold text-ink">{formatPrice(item.price_cents)}</Text>
            ) : (
              <StatusBadge label={item.status === "reserved" ? "Reserved" : "Sold"} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function OwnerActions({ listing, onChanged }: { listing: Listing; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: "close_listing" | "reopen_listing") => {
    setBusy(true);
    const { error } = await supabase.rpc(fn, { p_listing_id: listing.id });
    setBusy(false);
    if (error) return Alert.alert("Couldn't update", errorMessage(error));
    onChanged();
  };
  return (
    <View className="flex-1 gap-1">
      <Text className="text-center text-[13px] text-muted">This is your listing.</Text>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Button
            variant="secondary"
            label="Edit"
            onPress={() => router.push({ pathname: "/edit/[id]", params: { id: listing.id } })}
          />
        </View>
        <View className="flex-1">
          {listing.status === "closed" ? (
            <Button label="Reopen" onPress={() => void run("reopen_listing")} disabled={busy} />
          ) : (
            <Button
              variant="secondary"
              label="Close"
              onPress={() => void run("close_listing")}
              disabled={busy || listing.status !== "active"}
            />
          )}
        </View>
      </View>
    </View>
  );
}
