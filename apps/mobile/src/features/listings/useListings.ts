import { useCallback, useEffect, useState } from "react";

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
    fetchPage(JSON.parse(key) as ListingQuery, null).then(
      (page) => alive && setState({ key, rows: page.rows, cursor: page.next_cursor, error: false }),
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
  }, [busy, current?.cursor, key]);

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
    rows: current?.rows ?? [],
    loading: !current,
    error: current?.error ?? false,
    refreshing,
    loadMore,
    refresh,
  };
}
