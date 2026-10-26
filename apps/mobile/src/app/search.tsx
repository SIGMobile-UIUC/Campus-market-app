import { Search as SearchIcon } from "lucide-react-native";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { FilterSheet, NO_REFINE, refineCount, type Refine } from "@/features/listings/FilterSheet";
import { ResultsGrid } from "@/features/listings/ResultsGrid";
import { FilterButton, MarketChips, useScope } from "@/features/listings/Toolbar";
import { useListings } from "@/features/listings/useListings";
import { Header } from "@/ui/Header";
import { useTheme } from "@/ui/theme";

// Search from the home search bar (spec 3.3): typo-tolerant search in the current market with the
// filter sheet. Recent searches arrive with on-device history (DSC-5, P1).
export default function Search() {
  const { campus, colors } = useTheme();
  const scope = useScope();
  const [text, setText] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [refine, setRefine] = useState<Refine>(NO_REFINE);
  const [sheet, setSheet] = useState(false);
  const count = refineCount(refine);

  return (
    <>
      <Header title="Search" />
      <View className="gap-3 bg-bg px-5 pb-3 pt-2">
        <View className="h-12 flex-row items-center gap-2.5 rounded-xl bg-surface px-3.5">
          <SearchIcon size={20} color={colors.muted} />
          <TextInput
            accessibilityLabel="Search"
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => setQuery(text.trim() || null)}
            placeholder={
              scope === "campus" && campus ? `Search ${campus.name} market` : "Search the open market"
            }
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            autoFocus
            className="flex-1 text-[15px] text-ink"
          />
        </View>
        <View className="flex-row items-center gap-1.5">
          <MarketChips />
          <View className="flex-1" />
          <FilterButton label="Filters" count={count} onPress={() => setSheet(true)} />
        </View>
      </View>
      {query ? (
        <Results q={query} scope={scope} refine={refine} />
      ) : (
        <Text className="flex-1 bg-bg px-8 pt-10 text-center text-base text-muted">
          Search by item name, brand or course code.
        </Text>
      )}
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

function Results({ q, scope, refine }: { q: string; scope: "campus" | "open"; refine: Refine }) {
  const { sort, ...filters } = refine;
  const results = useListings({ q, scope, sort, filters });
  return <ResultsGrid results={results} empty={`No results for "${q}" in this market.`} />;
}
