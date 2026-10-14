import * as SecureStore from "expo-secure-store";

import { secureStorage } from "./secureStorage";

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    store,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void store.delete(key)),
  };
});

const store = (SecureStore as unknown as { store: Map<string, string> }).store;
const session = "x".repeat(5000);

beforeEach(() => store.clear());

test("splits a long value into chunks under the SecureStore limit and reads it back", async () => {
  await secureStorage.setItem("sb-auth", session);
  expect(store.get("sb-auth.n")).toBe("3");
  expect([...store.values()].every((value) => value.length <= 2048)).toBe(true);
  expect(await secureStorage.getItem("sb-auth")).toBe(session);
});

test("a shorter value leaves no stale chunks behind", async () => {
  await secureStorage.setItem("sb-auth", session);
  await secureStorage.setItem("sb-auth", "short");
  expect([...store.keys()].sort()).toEqual(["sb-auth.0", "sb-auth.n"]);
  expect(await secureStorage.getItem("sb-auth")).toBe("short");
});

test("remove clears every key and a missing value reads as null", async () => {
  await secureStorage.setItem("sb-auth", session);
  await secureStorage.removeItem("sb-auth");
  expect(store.size).toBe(0);
  expect(await secureStorage.getItem("sb-auth")).toBeNull();
});

test("a read issued during a write sees the whole new value, never part of it", async () => {
  await secureStorage.setItem("sb-auth", "old");
  const [, read] = await Promise.all([
    secureStorage.setItem("sb-auth", session),
    secureStorage.getItem("sb-auth"),
  ]);
  expect(read).toBe(session);
});

test("a missing chunk reads as no session instead of a corrupt one", async () => {
  await secureStorage.setItem("sb-auth", session);
  store.delete("sb-auth.1");
  expect(await secureStorage.getItem("sb-auth")).toBeNull();
});
