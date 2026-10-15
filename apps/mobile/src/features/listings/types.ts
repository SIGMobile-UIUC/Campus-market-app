import type { ListingCardData } from "@/ui/ListingCard";

// A row of feed and search_listings (spec 6.4).
export type FeedRow = {
  id: string;
  kind: "item" | "bundle" | "wanted";
  title: string;
  price_cents: number;
  item_count: number;
  status: "active" | "sold_out" | "closed";
  campus_only: boolean;
  thumb_path: string | null;
  blurhash: string | null;
  owner: { display_name: string; tier: string; campus_slug: string | null };
  zone: string | null;
  area_label: string;
  bumped_at: string;
};

export function toCard(row: FeedRow): ListingCardData {
  return {
    kind: row.kind,
    title: row.title,
    priceCents: row.price_cents,
    itemCount: row.item_count,
    areaLabel: row.zone ? `${row.area_label} · ${row.zone}` : row.area_label,
    campusOnly: row.campus_only,
    bumpedAt: row.bumped_at,
    image: row.thumb_path ? { path: row.thumb_path, blurhash: row.blurhash } : null,
  };
}

export const CONDITIONS = [
  ["new", "New"],
  ["like_new", "Like new"],
  ["good", "Good"],
  ["fair", "Fair"],
  ["poor", "Poor"],
] as const;

export const conditionLabel = (id: string) => CONDITIONS.find(([key]) => key === id)?.[1] ?? id;

export type Sort = "newest" | "price_asc" | "price_desc";

// search_listings filters (spec 6.4); empty values are left out of the request.
export type Filters = {
  mode?: "free" | "move_out" | "wanted" | "under_10" | "course";
  category?: string;
  subcategory?: string;
  condition?: string;
  zone_id?: string;
  price_min?: number;
  price_max?: number;
  free_only?: boolean;
};

// A listing read straight from the listings table with its items and photos (My listings, Favorites).
export type OwnListingRow = {
  id: string;
  kind: "item" | "bundle" | "wanted";
  title: string;
  status: "active" | "sold_out" | "closed";
  visibility: "campus" | "open";
  area_label: string;
  bumped_at: string;
  budget_cents: number | null;
  items: { id: string; price_cents: number; status: "available" | "reserved" | "sold" }[];
  listing_photos: { thumb_path: string; blurhash: string; position: number }[];
};

export const OWN_LISTING_SELECT =
  "id, kind, title, status, visibility, area_label, bumped_at, budget_cents, items(id, price_cents, status), listing_photos(thumb_path, blurhash, position)";

export function rowToCard(row: OwnListingRow): ListingCardData {
  const available = row.items.filter((i) => i.status === "available");
  const prices = (available.length ? available : row.items).map((i) => i.price_cents);
  const cover = [...row.listing_photos].sort((a, b) => a.position - b.position)[0];
  return {
    kind: row.kind,
    title: row.title,
    priceCents: row.kind === "wanted" ? (row.budget_cents ?? 0) : prices.length ? Math.min(...prices) : 0,
    itemCount: row.items.length,
    areaLabel: row.area_label,
    campusOnly: row.visibility === "campus",
    bumpedAt: row.bumped_at,
    image: cover ? { path: cover.thumb_path, blurhash: cover.blurhash } : null,
  };
}
