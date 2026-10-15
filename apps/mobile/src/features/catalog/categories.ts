import {
  BedDouble,
  Bike,
  BookOpen,
  CookingPot,
  Dumbbell,
  Ellipsis,
  Gamepad2,
  Guitar,
  Handbag,
  Lamp,
  Laptop,
  PawPrint,
  PencilRuler,
  Puzzle,
  Refrigerator,
  Shirt,
  Sofa,
  Sparkles,
  Sprout,
  Trophy,
  type LucideIcon,
} from "lucide-react-native";
import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

// Item categories live in app_config.categories (spec 1.7.5) so they change without a release.
export type Subcategory = { id: string; label: string };
export type CategoryDef = { id: string; label: string; icon: string; subcategories: Subcategory[] };

// The lucide names app_config uses; a new name needs a line here, and falls back to the dots icon.
const ICONS: Record<string, LucideIcon> = {
  sofa: Sofa,
  refrigerator: Refrigerator,
  "cooking-pot": CookingPot,
  "bed-double": BedDouble,
  lamp: Lamp,
  laptop: Laptop,
  "gamepad-2": Gamepad2,
  "book-open": BookOpen,
  "pencil-ruler": PencilRuler,
  shirt: Shirt,
  handbag: Handbag,
  trophy: Trophy,
  bike: Bike,
  dumbbell: Dumbbell,
  guitar: Guitar,
  puzzle: Puzzle,
  sparkles: Sparkles,
  "paw-print": PawPrint,
  sprout: Sprout,
  ellipsis: Ellipsis,
};

export const categoryIcon = (name: string): LucideIcon => ICONS[name] ?? Ellipsis;

let loading: Promise<CategoryDef[]> | null = null;

// Loaded once per app run; a failure is retried on the next call.
export function loadCategories(): Promise<CategoryDef[]> {
  loading ??= Promise.resolve(
    supabase.from("app_config").select("value").eq("key", "categories").single(),
  ).then(({ data, error }) => {
    if (error) {
      loading = null;
      throw error;
    }
    return data.value.categories as CategoryDef[];
  });
  return loading;
}

export function useCategories() {
  const [categories, setCategories] = useState<CategoryDef[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    loadCategories().then(setCategories, () => setFailed(true));
  }, []);
  return { categories, failed };
}
