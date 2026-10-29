import { checkinState, localDate, nextTier, tierAtLeast } from "./points";

jest.mock("@/lib/supabase", () => ({ supabase: {} }));

// 04:30 UTC on Oct 29 is still Oct 28 in Chicago.
const now = new Date(Date.UTC(2026, 9, 29, 4, 30));
const timezone = "America/Chicago";

test("days count in the profile's time zone, not the device's", () => {
  expect(localDate(timezone, 0, now)).toBe("2026-10-28");
  expect(localDate(timezone, 1, now)).toBe("2026-10-27");
  expect(localDate("Asia/Seoul", 0, now)).toBe("2026-10-29");
});

test("a check-in today or yesterday keeps the streak; an older one resets it", () => {
  const at = (local_date: string, streak: number) => ({ timezone, lastCheckin: { local_date, streak } });
  expect(checkinState(at("2026-10-28", 3), now)).toEqual({ done: true, streak: 3 });
  expect(checkinState(at("2026-10-27", 6), now)).toEqual({ done: false, streak: 6 });
  expect(checkinState(at("2026-10-26", 6), now)).toEqual({ done: false, streak: 0 });
  expect(checkinState({ timezone, lastCheckin: null }, now)).toEqual({ done: false, streak: 0 });
});

test("grades step up in order and A+ is the top", () => {
  expect(nextTier("b")).toBe("b_plus");
  expect(nextTier("a_plus")).toBeNull();
  expect(tierAtLeast("a_minus", "b_plus")).toBe(true);
  expect(tierAtLeast("b", "b_plus")).toBe(false);
});
