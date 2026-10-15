import * as photoUrls from "./photoUrls";

const mockCreateSignedUrls = jest.fn();

jest.mock("./supabase", () => ({
  supabase: { storage: { from: () => ({ createSignedUrls: mockCreateSignedUrls }) } },
}));

// The cache lives for the module, so each test uses its own paths.
beforeEach(() => {
  mockCreateSignedUrls.mockReset();
  mockCreateSignedUrls.mockImplementation(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })),
  }));
});

test("photos requested together are signed in one call", async () => {
  const urls = await Promise.all(["a.webp", "b.webp", "a.webp"].map(photoUrls.signedUrl));
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

test("a photo the caller cannot see, or a failed request, resolves to null", async () => {
  mockCreateSignedUrls.mockResolvedValueOnce({
    data: [{ path: "x.webp", signedUrl: "", error: "Object not found" }],
  });
  expect(await photoUrls.signedUrl("x.webp")).toBeNull();
  mockCreateSignedUrls.mockRejectedValueOnce(new TypeError("Network request failed"));
  expect(await photoUrls.signedUrl("y.webp")).toBeNull();
});
