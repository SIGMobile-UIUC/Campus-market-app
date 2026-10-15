import { encodeToTarget, type Encoded } from "./media";

jest.mock("./supabase", () => ({ supabase: {} }));

// A fake encoder whose file size follows the quality, like a real one.
const encoder = (bytesAt: Record<number, number>) => {
  const calls: number[] = [];
  const encode = async (quality: number): Promise<Encoded> => {
    calls.push(quality);
    return { uri: `file://${quality}`, bytes: bytesAt[quality], format: "webp" };
  };
  return { encode, calls };
};

test("stops at the first quality that fits the target", async () => {
  const { encode, calls } = encoder({ 0.75: 220_000, 0.65: 180_000, 0.55: 150_000 });
  expect((await encodeToTarget(encode, 300_000)).uri).toBe("file://0.75");
  expect(calls).toEqual([0.75]);
});

test("lowers the quality until the file fits (spec 4.7.1: 0.75, then 0.65, then 0.55)", async () => {
  const { encode, calls } = encoder({ 0.75: 420_000, 0.65: 330_000, 0.55: 280_000 });
  expect((await encodeToTarget(encode, 300_000)).uri).toBe("file://0.55");
  expect(calls).toEqual([0.75, 0.65, 0.55]);
});

test("keeps the smallest attempt when nothing fits", async () => {
  const { encode } = encoder({ 0.75: 500_000, 0.65: 450_000, 0.55: 410_000 });
  expect((await encodeToTarget(encode, 300_000)).bytes).toBe(410_000);
});
