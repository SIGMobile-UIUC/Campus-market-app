import * as SecureStore from "expo-secure-store";

// SecureStore warns above 2048 bytes per value and a session can be larger, so it is split
// across numbered keys (spec 4.6.2: the session lives in SecureStore).
const CHUNK = 1800;

// Supabase may read and write the session concurrently (lockless since auth-js 2.107), and a chunked
// value spans several keys, so storage calls run one at a time and never see a half-written session.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function remove(name: string) {
  const count = Number(await SecureStore.getItemAsync(`${name}.n`));
  await SecureStore.deleteItemAsync(`${name}.n`);
  for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${name}.${i}`);
}

export const secureStorage = {
  getItem: (name: string) =>
    serial(async () => {
      const count = Number(await SecureStore.getItemAsync(`${name}.n`));
      if (!count) return null;
      const parts = await Promise.all(
        Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${name}.${i}`)),
      );
      return parts.some((part) => part === null) ? null : parts.join("");
    }),
  setItem: (name: string, value: string) =>
    serial(async () => {
      await remove(name);
      const count = Math.ceil(value.length / CHUNK);
      for (let i = 0; i < count; i++) {
        await SecureStore.setItemAsync(`${name}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
      }
      await SecureStore.setItemAsync(`${name}.n`, String(count));
    }),
  removeItem: (name: string) => serial(() => remove(name)),
};
