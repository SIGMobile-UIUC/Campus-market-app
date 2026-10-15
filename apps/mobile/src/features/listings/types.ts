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
