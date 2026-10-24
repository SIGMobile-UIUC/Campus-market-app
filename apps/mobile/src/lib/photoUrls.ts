import { supabase } from "./supabase";

// Signed URLs for private photos (spec 4.7). Requests made in the same moment, such as every card of a
// feed page, go out as one createSignedUrls call per bucket. URLs live an hour and are reused for 55 minutes.
export type Bucket = "listing-photos" | "chat-images";
const LIFETIME_SECONDS = 3600;
const REUSE_MS = 55 * 60 * 1000;

const cache = new Map<string, { url: string; until: number }>();
let pending = new Map<Bucket, Map<string, ((url: string | null) => void)[]>>();
let scheduled = false;

async function sign(bucket: Bucket, batch: Map<string, ((url: string | null) => void)[]>) {
  const paths = [...batch.keys()];
  // A failed request resolves every waiting photo with null rather than leaving it pending.
  const { data } = await supabase.storage
    .from(bucket)
    .createSignedUrls(paths, LIFETIME_SECONDS)
    .catch(() => ({ data: null }));
  const urls = new Map((data ?? []).map((item) => [item.path, item.error ? null : item.signedUrl]));
  for (const path of paths) {
    const url = urls.get(path) ?? null;
    if (url) cache.set(`${bucket}/${path}`, { url, until: Date.now() + REUSE_MS });
    for (const resolve of batch.get(path)!) resolve(url);
  }
}

async function flush() {
  scheduled = false;
  const batches = pending;
  pending = new Map();
  await Promise.all([...batches].map(([bucket, batch]) => sign(bucket, batch)));
}

// Null when the photo is gone or not visible to the caller.
export function signedUrl(path: string, bucket: Bucket = "listing-photos"): Promise<string | null> {
  const hit = cache.get(`${bucket}/${path}`);
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.url);
  return new Promise((resolve) => {
    const batch = pending.get(bucket) ?? new Map();
    batch.set(path, [...(batch.get(path) ?? []), resolve]);
    pending.set(bucket, batch);
    if (!scheduled) {
      scheduled = true;
      setTimeout(() => void flush(), 0);
    }
  });
}

// After a load fails with an expired URL, the next signedUrl call asks the server again.
export function forgetSignedUrl(path: string, bucket: Bucket = "listing-photos") {
  cache.delete(`${bucket}/${path}`);
}
