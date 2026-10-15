import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { MODES } from "@/features/catalog/catalog";
import { useCategories } from "@/features/catalog/categories";
import { FilterSheet, NO_REFINE, refineCount, SORTS, type Refine } from "@/features/listings/FilterSheet";
import { ResultsGrid } from "@/features/listings/ResultsGrid";
import { FilterButton, MarketChips, useScope } from "@/features/listings/Toolbar";
import type { Filters } from "@/features/listings/types";
import { useListings } from "@/features/listings/useListings";
import { Chip } from "@/ui/Chip";
import { Header } from "@/ui/Header";

// Category results and shopping-mode feeds (spec 3.3, DSC-11, DSC-13): subcategory tabs, market,
// filters and sort over a two-column grid.
export default function Browse() {
  const params = useLocalSearchParams<{ mode?: Filters["mode"]; category?: string; subcategory?: string }>();
  const scope = useScope();
  const { categories } = useCategories();
  const category = categories.find((c) => c.id === params.category);
  const [subcategory, setSubcategory] = useState(params.subcategory ?? null);
  const [refine, setRefine] = useState<Refine>(NO_REFINE);
  const [sheet, setSheet] = useState(false);
  const { sort, ...narrow } = refine;

  const results = useListings({
    scope,
    sort,
    filters: {
      mode: params.mode,
      category: params.category,
      subcategory: subcategory ?? undefined,
      ...narrow,
    },
  });
  const title = category?.label ?? MODES.find((m) => m.id === params.mode)?.label ?? "Listings";
  const count = refineCount(refine);

  return (
    <>
      <Header title={title} />
      <ResultsGrid
        results={results}
        empty="Nothing here yet. Check back soon, or try the other market."
        header={
          <View className="gap-3 pb-4 pt-2">
            {category ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6, paddingHorizontal: 20 }}
              >
                <Chip label="All" selected={!subcategory} onPress={() => setSubcategory(null)} />
                {category.subcategories.map((s) => (
                  <Chip
                    key={s.id}
                    label={s.label}
                    selected={subcategory === s.id}
                    onPress={() => setSubcategory(s.id)}
                  />
                ))}
              </ScrollView>
            ) : null}
            <View className="flex-row items-center gap-1.5 px-5">
              <MarketChips />
              <View className="flex-1" />
              <FilterButton
                label={SORTS.find(([id]) => id === sort)?.[1] ?? "Sort"}
                count={count}
                onPress={() => setSheet(true)}
              />
            </View>
          </View>
        }
      />
      <FilterSheet
        visible={sheet}
        value={refine}
        campusScope={scope === "campus"}
        onApply={(next) => {
          setRefine(next);
          setSheet(false);
        }}
        onClose={() => setSheet(false)}
      />
    </>
  );
}
