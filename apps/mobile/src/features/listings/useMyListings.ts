import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

import { OWN_LISTING_SELECT, type OwnListingRow } from "./types";

export type MyListing = OwnListingRow & { saves: number };

// ponytail: the newest 100; paging when a seller has more.
async function fetchMine(userId: string): Promise<MyListing[]> {
  const { data, error } = await supabase
    .from("listings")
    .select(OWN_LISTING_SELECT)
    .eq("owner_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  const rows = data as unknown as OwnListingRow[];
  const counts = rows.length
    ? await supabase.rpc("favorite_counts", { p_listing_ids: rows.map((r) => r.id) })
    : { data: [] };
  const saves = new Map(
    ((counts.data ?? []) as { listing_id: string; saves: number }[]).map((c) => [c.listing_id, c.saves]),
  );
  return rows.map((row) => ({ ...row, saves: saves.get(row.id) ?? 0 }));
}

// The seller's own listings for the Me tab (APP-20), with save counts (DSC-4).
export function useMyListings(userId: string | undefined) {
  const [listings, setListings] = useState<MyListing[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    fetchMine(userId).then(
      (rows) => {
        if (!alive) return;
        setListings(rows);
        setFailed(false);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [userId, reloads]);

  const reload = useCallback(() => setReloads((n) => n + 1), []);
  return { listings, failed, reload };
}
