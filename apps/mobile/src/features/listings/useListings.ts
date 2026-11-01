import { useCallback, useEffect, useState } from "react";

import { track } from "@/lib/analytics";
import { supabase } from "@/lib/supabase";

import type { FeedRow, Filters, Sort } from "./types";

export type ListingQuery = {
  q?: string | null;
  scope: "campus" | "open";
  filters?: Filters;
  sort?: Sort;
  limit?: number;
};

type Page = { rows: FeedRow[]; next_cursor: unknown };

async function fetchPage(query: ListingQuery, cursor: unknown): Promise<Page> {
  const { data, error } = await supabase.rpc("search_listings", {
    p_q: query.q ?? null,
    p_scope: query.scope,
    p_filters: query.filters ?? {},
    p_sort: query.sort ?? "newest",
    p_cursor: cursor ?? null,
    p_limit: query.limit ?? 20,
  });
  if (error) throw error;
  return data as Page;
}

type State = { key: string; rows: FeedRow[]; cursor: unknown; error: boolean };

// The list a query shows, for view_item_list and select_item (spec 4.17.5).
const listName = (query: ListingQuery) =>
  query.q ? "search" : (query.filters?.mode ?? (query.filters?.category ? "category" : "feed"));

// One impression event per loaded page, and the search itself with its first page.
function trackPage(query: ListingQuery, rows: FeedRow[], offset: number) {
  const props = {
    category: query.filters?.category ?? null,
    filters: query.filters ?? {},
    sort: query.sort ?? "newest",
  };
  if (query.q && offset === 0) {
    track("search", { ...props, term: query.q, scope: query.scope, result_count: rows.length });
  }
  track("view_item_list", {
    ...props,
    list: listName(query),
    page: Math.floor(offset / (query.limit ?? 20)) + 1,
    items: rows.slice(0, 40).map((row, i) => ({ listing_id: row.id, index: offset + i })),
  });
}

// One page at a time with the keyset cursor (spec 4.8). A bumped listing can show up again on a later
// page, so rows whose id is already shown are dropped. Results are kept per query, so switching back
// and forth never mixes two queries' rows.
export function useListings(query: ListingQuery) {
  const key = JSON.stringify(query);
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let alive = true;
    const query = JSON.parse(key) as ListingQuery;
    fetchPage(query, null).then(
      (page) => {
        if (!alive) return;
        setState({ key, rows: page.rows, cursor: page.next_cursor, error: false });
        trackPage(query, page.rows, 0);
      },
      () => alive && setState({ key, rows: [], cursor: null, error: true }),
    );
    return () => {
      alive = false;
    };
  }, [key]);

  const current = state?.key === key ? state : null;

  const loadMore = useCallback(async () => {
    if (!current?.cursor || busy) return;
    setBusy(true);
    try {
      const page = await fetchPage(JSON.parse(key) as ListingQuery, current.cursor);
      trackPage(JSON.parse(key) as ListingQuery, page.rows, current.rows.length);
      setState((s) => {
        if (!s || s.key !== key) return s;
        const seen = new Set(s.rows.map((row) => row.id));
        return {
          ...s,
          rows: [...s.rows, ...page.rows.filter((row) => !seen.has(row.id))],
          cursor: page.next_cursor,
        };
      });
    } finally {
      setBusy(false);
    }
  }, [busy, current?.cursor, current?.rows.length, key]);

  // Pull to refresh: the old rows stay on screen until the first page comes back.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const page = await fetchPage(JSON.parse(key) as ListingQuery, null);
      setState({ key, rows: page.rows, cursor: page.next_cursor, error: false });
    } catch {
      setState((s) => (s && s.key === key ? { ...s, error: true } : s));
    } finally {
      setRefreshing(false);
    }
  }, [key]);

  return {
    list: listName(JSON.parse(key) as ListingQuery),
    rows: current?.rows ?? [],
    loading: !current,
    error: current?.error ?? false,
    refreshing,
    loadMore,
    refresh,
  };
}
