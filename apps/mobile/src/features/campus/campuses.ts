import { readableOn } from "@/ui/color";
import type { Campus } from "@/ui/theme";

export type CampusRow = {
  id: string;
  slug: string;
  name: string;
  short_name: string | null;
  status: "live" | "waitlist";
  primary_color: string | null;
  accent_color: string | null;
};

// Only a live campus has a market and colors; a waitlist school leaves the user in the open market.
export function toCampus(row: CampusRow | null | undefined): Campus | null {
  if (!row || row.status !== "live" || !row.primary_color || !row.accent_color) return null;
  return {
    name: row.short_name ?? row.name,
    primary: row.primary_color,
    onPrimary: readableOn(row.primary_color),
    accent: row.accent_color,
    onAccent: readableOn(row.accent_color),
  };
}
