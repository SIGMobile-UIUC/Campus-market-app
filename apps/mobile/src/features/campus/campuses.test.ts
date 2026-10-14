import { readableOn } from "@/ui/color";

import { toCampus, type CampusRow } from "./campuses";

const illinois: CampusRow = {
  id: "1",
  slug: "illinois",
  name: "University of Illinois Urbana-Champaign",
  short_name: "UIUC",
  status: "live",
  primary_color: "#13294B",
  accent_color: "#FF5F05",
};

test("text on campus colors is black or white by contrast (spec 3.6.1)", () => {
  expect(readableOn("#13294B")).toBe("#FFFFFF");
  expect(readableOn("#FF5F05")).toBe("#000000");
  expect(readableOn("#CFB991")).toBe("#000000");
  expect(readableOn("#000000")).toBe("#FFFFFF");
  expect(readableOn("#FFFFFF")).toBe("#000000");
});

test("a live campus becomes a theme with its short name", () => {
  expect(toCampus(illinois)).toEqual({
    name: "UIUC",
    primary: "#13294B",
    onPrimary: "#FFFFFF",
    accent: "#FF5F05",
    onAccent: "#000000",
  });
  expect(toCampus({ ...illinois, short_name: null })?.name).toBe(illinois.name);
});

test("waitlist schools, missing colors and general users have no campus market", () => {
  expect(toCampus({ ...illinois, status: "waitlist" })).toBeNull();
  expect(toCampus({ ...illinois, accent_color: null })).toBeNull();
  expect(toCampus(null)).toBeNull();
});
