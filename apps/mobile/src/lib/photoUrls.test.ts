import * as photoUrls from "./photoUrls";

const mockCreateSignedUrls = jest.fn();
const mockFrom = jest.fn((_bucket: string) => ({ createSignedUrls: mockCreateSignedUrls }));

jest.mock("./supabase", () => ({
  supabase: { storage: { from: (bucket: string) => mockFrom(bucket) } },
}));

// The cache lives for the module, so each test uses its own paths.
beforeEach(() => {
  mockFrom.mockClear();
  mockCreateSignedUrls.mockReset();
  mockCreateSignedUrls.mockImplementation(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })),
  }));
});

test("photos requested together are signed in one call", async () => {
  const urls = await Promise.all(["a.webp", "b.webp", "a.webp"].map((path) => photoUrls.signedUrl(path)));
  expect(urls).toEqual(["https://signed/a.webp", "https://signed/b.webp", "https://signed/a.webp"]);
  expect(mockCreateSignedUrls).toHaveBeenCalledTimes(1);
  expect(mockCreateSignedUrls).toHaveBeenCalledWith(["a.webp", "b.webp"], 3600);
});

test("a signed URL is reused until forgotten", async () => {
  await photoUrls.signedUrl("c.webp");
  await photoUrls.signedUrl("c.webp");
  expect(mockCreateSignedUrls).toHaveBeenCalledTimes(1);
  photoUrls.forgetSignedUrl("c.webp");
  await photoUrls.signedUrl("c.webp");
  expect(mockCreateSignedUrls).toHaveBeenCalledTimes(2);
});

test("each bucket is signed separately and cached by its own paths", async () => {
  await Promise.all([photoUrls.signedUrl("d.webp"), photoUrls.signedUrl("d.webp", "chat-images")]);
  expect(mockCreateSignedUrls).toHaveBeenCalledTimes(2);
  expect(mockFrom.mock.calls.map(([bucket]) => bucket).sort()).toEqual(["chat-images", "listing-photos"]);
});

test("a photo the caller cannot see, or a failed request, resolves to null", async () => {
  mockCreateSignedUrls.mockResolvedValueOnce({
    data: [{ path: "x.webp", signedUrl: "", error: "Object not found" }],
  });
  expect(await photoUrls.signedUrl("x.webp")).toBeNull();
  mockCreateSignedUrls.mockRejectedValueOnce(new TypeError("Network request failed"));
  expect(await photoUrls.signedUrl("y.webp")).toBeNull();
});
