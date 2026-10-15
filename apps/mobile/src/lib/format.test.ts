import { formatAgo, formatPrice, parsePrice } from "./format";

test.each([
  ["40", 4000],
  ["$40", 4000],
  ["40.5", 4050],
  ["40.50", 4050],
  ["1,200", 120000],
  ["0", 0],
  [" 7 ", 700],
])("parsePrice(%p) is %p cents", (text, cents) => {
  expect(parsePrice(text)).toBe(cents);
});

test.each(["", "abc", "4.567", "-5", "1000001", "12.3.4"])("parsePrice(%p) is invalid", (text) => {
  expect(parsePrice(text)).toBeNull();
});

test("formatPrice shows Free, whole dollars and cents", () => {
  expect(formatPrice(0)).toBe("Free");
  expect(formatPrice(4000)).toBe("$40");
  expect(formatPrice(4050)).toBe("$40.50");
  expect(formatPrice(120000)).toBe("$1,200");
});

test("formatAgo counts minutes, hours and days", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  expect(formatAgo("2026-10-15T11:59:30Z", now)).toBe("now");
  expect(formatAgo("2026-10-15T11:55:00Z", now)).toBe("5m");
  expect(formatAgo("2026-10-15T09:00:00Z", now)).toBe("3h");
  expect(formatAgo("2026-10-13T12:00:00Z", now)).toBe("2d");
  expect(formatAgo("2026-09-01T12:00:00Z", now)).toBe("Sep 1");
});
