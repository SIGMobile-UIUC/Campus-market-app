import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useColorScheme, View } from "react-native";
import { vars } from "nativewind";

export type Campus = {
  name: string;
  primary: string;
  onPrimary: string;
  accent: string;
  onAccent: string;
};

export type Market = "campus" | "open";

// The open market wears a neutral slate instead of school colors (spec 3.1, 3.6.1).
const OPEN_MARKET_COLORS = {
  primary: "#334155",
  onPrimary: "#FFFFFF",
  accent: "#334155",
  onAccent: "#FFFFFF",
};

const NEUTRALS = {
  light: {
    bg: "#FFFFFF",
    surface: "#F1F2F4",
    ink: "#17181A",
    muted: "#5E6168",
    line: "#E7E8EB",
    danger: "#B42318",
  },
  dark: {
    bg: "#0F0F10",
    surface: "#1B1B1E",
    ink: "#F2F2F2",
    muted: "#A6A6AB",
    line: "#2A2A2D",
    danger: "#F97066",
  },
};

type Theme = {
  // Null for general users and students whose school has no live market: they see the open market only.
  campus: Campus | null;
  market: Market;
  setMarket: (market: Market) => void;
  // Resolved colors for places that need a value rather than a class name, such as icons.
  colors: typeof NEUTRALS.light & typeof OPEN_MARKET_COLORS;
};

const ThemeContext = createContext<Theme | null>(null);

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useTheme must be used inside ThemeProvider");
  return theme;
}

export function ThemeProvider({ campus, children }: { campus: Campus | null; children: ReactNode }) {
  const scheme = useColorScheme();
  const [selected, setMarket] = useState<Market>("campus");
  const market = campus ? selected : "open";

  const theme = useMemo<Theme>(() => {
    const neutrals = NEUTRALS[scheme === "dark" ? "dark" : "light"];
    const brand = campus && market === "campus" ? campus : OPEN_MARKET_COLORS;
    return {
      campus,
      market,
      setMarket,
      colors: {
        ...neutrals,
        primary: brand.primary,
        onPrimary: brand.onPrimary,
        accent: brand.accent,
        onAccent: brand.onAccent,
      },
    };
  }, [campus, market, scheme]);

  const { colors } = theme;
  return (
    <ThemeContext.Provider value={theme}>
      <View
        className="flex-1 bg-bg"
        style={vars({
          "--color-bg": colors.bg,
          "--color-surface": colors.surface,
          "--color-ink": colors.ink,
          "--color-muted": colors.muted,
          "--color-line": colors.line,
          "--color-danger": colors.danger,
          "--color-primary": colors.primary,
          "--color-on-primary": colors.onPrimary,
          "--color-accent": colors.accent,
          "--color-on-accent": colors.onAccent,
        })}
      >
        {children}
      </View>
    </ThemeContext.Provider>
  );
}
