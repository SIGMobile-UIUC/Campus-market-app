// Prices are integer cents everywhere (spec 6.1); these convert at the edges of the UI.

// "40", "$40", "40.5" or "40.50" to cents; null for anything else or over the $100,000 item limit.
export function parsePrice(text: string): number | null {
  const match = text
    .trim()
    .replace(/^\$/, "")
    .replace(/,/g, "")
    .match(/^(\d{1,6})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return cents <= 10_000_000 ? cents : null;
}

// 0 shows as Free (LST-4); whole dollars drop the cents.
export function formatPrice(cents: number): string {
  if (cents === 0) return "Free";
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

// "now", "5m", "3h", "2d", then the date.
export function formatAgo(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
