import { router } from "expo-router";
import { Bell, Globe, Search } from "lucide-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MODES } from "@/features/catalog/catalog";
import { categoryIcon, useCategories } from "@/features/catalog/categories";
import { ResultsGrid } from "@/features/listings/ResultsGrid";
import { MarketChips, useScope } from "@/features/listings/Toolbar";
import { toCard, type Filters } from "@/features/listings/types";
import { useListings } from "@/features/listings/useListings";
import { ListingCard } from "@/ui/ListingCard";
import { CategoryTile, ModeTile } from "@/ui/Tiles";
import { useTheme } from "@/ui/theme";

// Home (spec 3.3, DSC-12): search, shopping modes, categories, move-out sales, wanted requests and the
// newest listings, all in the current market. Modules with nothing to show are hidden.
// ponytail: "Picked for you" needs viewing history (DSC-5, P1) and "Hot this week" needs engagement
// events (DB-15); until then the grid is the newest listings.
export default function Home() {
  const { campus, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const scope = useScope();
  const { categories } = useCategories();
  const newest = useListings({ scope });

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <ResultsGrid
        results={newest}
        empty="Nothing listed yet. Be the first: tap Sell."
        header={
          <View>
            <View className="flex-row items-center px-5 pb-1 pt-3">
              <View className="flex-row items-center gap-2">
                {scope === "campus" && campus ? (
                  <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: campus.accent }} />
                ) : (
                  <Globe size={18} color={colors.ink} />
                )}
                <Text accessibilityRole="header" className="text-xl font-extrabold text-ink">
                  {scope === "campus" && campus ? campus.name : "Open market"}
                </Text>
              </View>
              <View className="flex-1" />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Notifications"
                className="h-11 w-11 items-center justify-center"
              >
                <Bell size={23} color={colors.ink} />
              </Pressable>
            </View>

            <View className="flex-row gap-1.5 px-5 pb-3">
              <MarketChips />
            </View>

            <Pressable
              accessibilityRole="search"
              onPress={() => router.push("/search")}
              className="mx-5 mb-4 h-12 flex-row items-center gap-2.5 rounded-xl bg-surface px-3.5"
            >
              <Search size={20} color={colors.muted} />
              <Text className="text-[15px] text-muted">
                {scope === "campus" && campus ? `Search ${campus.name} market` : "Search the open market"}
              </Text>
            </Pressable>

            <View className="flex-row px-2.5 pb-5">
              {MODES.map((mode) => (
                <ModeTile
                  key={mode.id}
                  label={mode.label}
                  Icon={mode.Icon}
                  tint={mode.tint}
                  ink={mode.ink}
                  onPress={() => router.push({ pathname: "/browse", params: { mode: mode.id } })}
                />
              ))}
            </View>

            <View className="h-2 bg-surface" />

            <View className="flex-row items-baseline justify-between px-5 pb-2 pt-4">
              <Text accessibilityRole="header" className="text-lg font-extrabold text-ink">
                Shop by category
              </Text>
              <Pressable accessibilityRole="link" onPress={() => router.push("/categories")}>
                <Text className="text-[13px] text-ink">All categories</Text>
              </Pressable>
            </View>
            <View className="flex-row flex-wrap px-2">
              {categories.slice(0, 9).map((category) => (
                <CategoryTile
                  key={category.id}
                  label={category.label}
                  Icon={categoryIcon(category.icon)}
                  onPress={() => router.push({ pathname: "/browse", params: { category: category.id } })}
                />
              ))}
              {categories.length ? (
                <CategoryTile
                  label="More"
                  Icon={categoryIcon("ellipsis")}
                  onPress={() => router.push("/categories")}
                />
              ) : null}
            </View>

            <Module title="Move-out sales" scope={scope} filters={{ mode: "move_out" }} />
            <Module title="Students are looking for" scope={scope} filters={{ mode: "wanted" }} />

            <Text accessibilityRole="header" className="px-5 pb-3 pt-6 text-lg font-extrabold text-ink">
              Just listed
            </Text>
          </View>
        }
      />
    </View>
  );
}

// A horizontal row of up to six listings with "See all"; hidden when empty.
function Module({ title, scope, filters }: { title: string; scope: "campus" | "open"; filters: Filters }) {
  const { rows } = useListings({ scope, filters, limit: 6 });
  if (!rows.length) return null;
  return (
    <View className="pt-6">
      <View className="flex-row items-baseline justify-between px-5 pb-2">
        <Text accessibilityRole="header" className="text-lg font-extrabold text-ink">
          {title}
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push({ pathname: "/browse", params: { mode: filters.mode } })}
        >
          <Text className="text-[13px] text-ink">See all</Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 12, paddingHorizontal: 20 }}
      >
        {rows.map((row) => (
          <View key={row.id} style={{ width: 148 }}>
            <ListingCard
              variant="tile"
              card={toCard(row)}
              onPress={() => router.push({ pathname: "/listing/[id]", params: { id: row.id } })}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
