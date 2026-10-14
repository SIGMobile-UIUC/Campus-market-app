import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

import type { Loadout } from "./Avatar";

export type StarterLook = { id: string; loadout: Loadout };

// The looks offered at onboarding: ids and item skus from app_config.starter_avatars, slots and asset keys
// from shop_items, so the database stays the only list of what each look contains. Null on failure.
async function fetchStarterLooks(): Promise<StarterLook[] | null> {
  const config = await supabase.from("app_config").select("value").eq("key", "starter_avatars").single();
  if (config.error) return null;
  const starters: { id: string; items: string[] }[] = config.data.value.starter_avatars ?? [];
  const items = await supabase
    .from("shop_items")
    .select("sku, slot, asset_key")
    .in(
      "sku",
      starters.flatMap((look) => look.items),
    );
  if (items.error) return null;

  const bySku = new Map(items.data.map((item) => [item.sku, item]));
  return starters.map((look) => ({
    id: look.id,
    loadout: Object.fromEntries(
      look.items.flatMap((sku) => {
        const item = bySku.get(sku);
        return item ? [[item.slot, item.asset_key]] : [];
      }),
    ),
  }));
}

export function useStarterLooks() {
  const [looks, setLooks] = useState<StarterLook[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    void fetchStarterLooks().then((result) => {
      setFailed(!result);
      if (result) setLooks(result);
    });
  }, [attempt]);

  return { looks, failed, retry: () => setAttempt((n) => n + 1) };
}
