import { FunctionsHttpError } from "@supabase/supabase-js";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Check, ChevronRight, Heart, Share2 } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
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
import { QrSheet, reopenAfterSignIn, shareLink } from "@/features/listings/share";
import { conditionLabel, hiddenNote, paymentLabel } from "@/features/listings/types";
import { confirmBlock, ReportMenu, type ReportTarget } from "@/features/moderation/moderation";
import { fetchProfile, replyLabel, tradesLabel, type PublicProfile } from "@/features/profile/profile";
import { priceBucket, track } from "@/lib/analytics";
import { errorMessage } from "@/lib/errors";
import { formatAgo, formatPrice } from "@/lib/format";
import { openInMaps } from "@/lib/maps";
import { supabase } from "@/lib/supabase";
import { Button } from "@/ui/Button";
import { GradeBadge } from "@/ui/GradeBadge";
import { Header } from "@/ui/Header";
import { Menu, MenuButton } from "@/ui/Menu";
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
  hidden: boolean;
  hidden_reason: string | null;
  category: string;
  created_at: string;
  bumped_at: string;
  zone: { name: string } | null;
  meet_place: string | null;
  items: Item[];
  listing_photos: PhotoRow[];
  owner: {
    display_name: string;
    tier: string;
    campus: { short_name: string | null; name: string } | null;
    avatar_loadout: { slot: string; shop_items: { asset_key: string } | null }[];
  } | null;
  share_code: string;
  // Set on a shared preview: the listing's campus, for the campus-only note.
  preview?: { campus: string | null };
};

// listing-preview (LST-11): public fields only, with signed photo URLs in place of paths.
type Preview = Pick<
  Listing,
  | "kind"
  | "title"
  | "description"
  | "visibility"
  | "area_label"
  | "payment_methods"
  | "budget_cents"
  | "status"
> & {
  created_at: string;
  zone: string | null;
  campus: { name: string; short_name: string | null } | null;
  items: Omit<Item, "id">[];
  photos: { url: string | null; thumb_url: string | null; blurhash: string; item: number | null }[];
};

// Readable through the listings policy only, so a listing the caller may not see comes back empty.
const SELECT = `id, owner_id, kind, title, description, visibility, area_label, payment_methods, budget_cents, status,
  hidden, hidden_reason, category, created_at, share_code,
  bumped_at, zone:campus_zones(name), meet_place, items(id, position, name, price_cents, negotiable, condition, status),
  listing_photos(id, path, thumb_path, blurhash, position, item_id),
  owner:profiles!listings_owner_id_fkey(display_name, tier, campus:campuses!profiles_campus_id_fkey(short_name, name),
    avatar_loadout(slot, shop_items(asset_key)))`;
// Named foreign keys: profiles also reach listings through favorites, and campuses reach profiles
// through user_roles, so PostgREST cannot pick the relationship on its own.

// null: not found or not visible to the caller; "failed": the request itself failed. A share code finds
// the listing the same way, and falls back to the public preview when the caller may not see it.
async function fetchListing(
  by: { id: string } | { code: string },
  signedIn: boolean,
): Promise<{ listing: Listing | null | "failed"; saved: boolean }> {
  if ("code" in by && !signedIn) return { listing: await fetchPreview(by.code), saved: false };
  const query = supabase.from("listings").select(`${SELECT}, favorites(user_id)`).is("deleted_at", null);
  const { data, error } = await (
    "id" in by ? query.eq("id", by.id) : query.eq("share_code", by.code)
  ).maybeSingle();
  if (error) return { listing: "failed", saved: false };
  if (!data && "code" in by) return { listing: await fetchPreview(by.code), saved: false };
  // Favorites are readable only by their owner, so any row here is the caller's.
  return { listing: (data as unknown as Listing) ?? null, saved: !!data?.favorites.length };
}

async function fetchPreview(code: string): Promise<Listing | null | "failed"> {
  const { data, error } = await supabase.functions.invoke<Preview>(`listing-preview?code=${code}`, {
    method: "GET",
  });
  if (error || !data) {
    return error instanceof FunctionsHttpError && (error.context as Response).status === 404
      ? null
      : "failed";
  }
  return {
    ...data,
    id: "",
    owner_id: "",
    hidden: false,
    hidden_reason: null,
    category: "",
    bumped_at: data.created_at,
    zone: data.zone ? { name: data.zone } : null,
    meet_place: null,
    items: data.items.map((item) => ({ ...item, id: String(item.position) })),
    listing_photos: data.photos.map((photo, n) => ({
      id: String(n),
      path: photo.url,
      thumb_path: photo.thumb_url ?? "",
      blurhash: photo.blurhash,
      position: n,
      item_id: photo.item === null ? null : String(photo.item),
    })),
    owner: null,
    share_code: code,
    preview: { campus: data.campus ? (data.campus.short_name ?? data.campus.name) : null },
  };
}

// Listing page (spec 3.3), also opened by share links at /l/<code> (LST-11): a listing the viewer may
// not see, or any listing while signed out, shows read-only from its public preview. The seller row
// shows their trade count and reply time and opens their profile (APP-21); the meetup map and similar
// items (DSC-6) are P1.
export default function ListingPage() {
  const { id, code } = useLocalSearchParams<{ id?: string; code?: string }>();
  const { session } = useAccount();
  const insets = useSafeAreaInsets();
  const [listing, setListing] = useState<Listing | null | "failed" | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [opening, setOpening] = useState(false);
  // Items picked on a move-out sale carry over to the proposal sheet (APP-10).
  const [picked, setPicked] = useState<string[]>([]);
  const [menu, setMenu] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [qr, setQr] = useState(false);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const { colors } = useTheme();
  const signedIn = !!session;
  const loaded = listing && listing !== "failed" ? listing : null;

  // view_item when the page opens and item_engagement with the time spent when it closes (4.17.5).
  useEffect(() => {
    if (!loaded || loaded.preview) return;
    const opened = Date.now();
    track("view_item", {
      listing_id: loaded.id,
      kind: loaded.kind,
      category: loaded.category,
      price_bucket: priceBucket(
        loaded.kind === "wanted" ? (loaded.budget_cents ?? 0) : (loaded.items[0]?.price_cents ?? 0),
      ),
      condition: loaded.kind === "item" ? (loaded.items[0]?.condition ?? null) : null,
      photo_count: loaded.listing_photos.length,
      listing_age_hours: Math.floor((opened - new Date(loaded.created_at).getTime()) / 3_600_000),
      source: code ? "share_link" : null,
    });
    return () => {
      const seconds = (Date.now() - opened) / 1000;
      track("item_engagement", {
        listing_id: loaded.id,
        seconds_bucket:
          seconds < 10 ? "under_10" : seconds < 30 ? "10_30" : seconds < 120 ? "30_120" : "120_plus",
      });
    };
  }, [loaded?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // On focus, so coming back from the editor shows the saved changes.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void fetchListing(code ? { code } : { id: id! }, signedIn).then((result) => {
        if (!alive) return;
        setListing(result.listing);
        setSaved(result.saved);
      });
      return () => {
        alive = false;
      };
    }, [id, code, signedIn]),
  );

  const reload = () =>
    void fetchListing(code ? { code } : { id: id! }, signedIn).then((result) => {
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
  const ownerName = listing.owner?.display_name ?? "this seller";
  const toggleSave = async () => {
    const next = !saved;
    setSaved(next);
    track(next ? "add_to_wishlist" : "remove_from_wishlist", {
      listing_id: listing.id,
      category: listing.category,
      price_bucket: priceBucket(listing.items[0]?.price_cents ?? listing.budget_cents ?? 0),
    });
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
      <Header
        title=""
        right={
          listing.preview
            ? undefined
            : () => (
                <View className="flex-row items-center gap-5">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Share listing"
                    onPress={() => setSharing(true)}
                    hitSlop={12}
                  >
                    <Share2 size={22} color={colors.ink} />
                  </Pressable>
                  {mine ? null : <MenuButton label="Listing options" onPress={() => setMenu(true)} />}
                </View>
              )
        }
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <Carousel photos={listing.listing_photos} />
        <View className="gap-5 px-5 pt-4">
          {mine && listing.hidden ? (
            <Text className="rounded-2xl border border-danger p-3 text-[13px] text-danger">
              {hiddenNote(listing.hidden_reason)}. Questions? Use the contact address in Settings.
            </Text>
          ) : null}
          {listing.preview ? (
            listing.visibility === "campus" && listing.preview.campus ? (
              <Text className="rounded-2xl bg-surface p-3 text-[13px] text-ink">
                For {listing.preview.campus} students only. You can see it because someone shared the link.
              </Text>
            ) : null
          ) : (
            <Seller listing={listing} />
          )}
          <Summary listing={listing} />
          {listing.kind === "bundle" ? (
            <SaleItems
              listing={listing}
              picked={mine || listing.preview ? null : picked}
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
            {listing.meet_place ? <Text className="text-[15px] text-ink">{listing.meet_place}</Text> : null}
            <View className="items-start">
              <TextLink
                label="Open in Maps"
                onPress={() =>
                  openInMaps(
                    [listing.meet_place, listing.zone?.name, listing.area_label].filter(Boolean).join(", "),
                  )
                }
              />
            </View>
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
        {listing.preview ? (
          signedIn ? (
            <Text className="flex-1 py-3 text-center text-[13px] text-muted">
              {listing.visibility === "campus" && listing.preview.campus
                ? `Only ${listing.preview.campus} students can chat about this listing.`
                : "You can't chat about this listing."}
            </Text>
          ) : (
            <View className="flex-1">
              <Button
                label="Sign in to chat"
                onPress={() => {
                  reopenAfterSignIn(listing.share_code);
                  router.push("/welcome");
                }}
              />
            </View>
          )
        ) : mine ? (
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
                  if (listing.kind === "wanted") {
                    router.push({ pathname: "/offer/[listingId]", params: { listingId: listing.id } });
                    return;
                  }
                  setOpening(true);
                  void openChat(listing.id, picked).finally(() => setOpening(false));
                }}
              />
            </View>
          </>
        )}
      </View>
      <Menu
        visible={menu}
        onClose={() => setMenu(false)}
        options={[
          {
            label: "Report listing",
            onPress: () => setReporting({ type: "listing", ref: listing.id, label: "this listing" }),
          },
          {
            label: `Block ${ownerName}`,
            destructive: true,
            onPress: () => confirmBlock(listing.owner_id, ownerName, () => router.back()),
          },
        ]}
      />
      <ReportMenu target={reporting} onClose={() => setReporting(null)} />
      <Menu
        visible={sharing}
        onClose={() => setSharing(false)}
        options={[
          { label: "Share link", onPress: () => shareLink(listing) },
          {
            label: "Show QR code",
            onPress: () => {
              track("share", { listing_id: listing.id, method: "qr" });
              setQr(true);
            },
          },
        ]}
      />
      <QrSheet listing={qr ? listing : null} subtitle={priceLabel(listing)} onClose={() => setQr(false)} />
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
  const { colors } = useTheme();
  const [stats, setStats] = useState<PublicProfile | null>(null);
  useEffect(() => {
    void fetchProfile(listing.owner_id).then(setStats);
  }, [listing.owner_id]);
  const loadout = Object.fromEntries(
    (owner?.avatar_loadout ?? []).map((l) => [l.slot, l.shop_items?.asset_key]),
  ) as Loadout;
  return (
    <Pressable
      accessibilityRole="link"
      disabled={!owner}
      onPress={() => router.push({ pathname: "/profile/[id]", params: { id: listing.owner_id } })}
      className="flex-row items-center gap-3"
    >
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
        {stats ? (
          <Text className="text-[13px] text-ink">
            {[tradesLabel(stats.trades), replyLabel(stats.reply_minutes)].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
      </View>
      {owner ? <ChevronRight size={18} color={colors.muted} /> : null}
    </Pressable>
  );
}

function priceLabel(listing: Listing) {
  const available = listing.items.filter((i) => i.status === "available");
  return listing.kind === "wanted"
    ? `Budget ${formatPrice(listing.budget_cents ?? 0)}`
    : listing.kind === "item"
      ? formatPrice(listing.items[0].price_cents)
      : `From ${formatPrice(Math.min(...(available.length ? available : listing.items).map((i) => i.price_cents)))}`;
}

function Summary({ listing }: { listing: Listing }) {
  const item = listing.kind === "item" ? listing.items[0] : null;
  const price = priceLabel(listing);
  const chips = [
    item ? conditionLabel(item.condition) : null,
    item?.negotiable ? "Open to offers" : null,
    ...listing.payment_methods.map(paymentLabel),
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

// Buyers tick available items to ask about them together; picked is null for the owner and on a shared
// preview.
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
