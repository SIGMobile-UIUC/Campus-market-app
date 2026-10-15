import { preparePhoto, uploadPhoto, type UploadedPhoto } from "@/lib/media";
import { supabase } from "@/lib/supabase";

export type DraftItem = {
  name: string;
  priceCents: number;
  negotiable: boolean;
  condition: string;
  photos: string[]; // local URIs, cover first
};

export type Draft = {
  kind: "item" | "bundle" | "wanted";
  fields: Record<string, unknown>; // title, description, category, subcategory, trade fields, budget_cents
  items: DraftItem[];
};

// Compresses and uploads every photo, then creates the listing in one call. Uploaded photos are kept in
// `uploaded` by local URI and the request id is the caller's, so tapping Post again after a failure
// neither re-uploads nor double-posts (spec 6.1).
export async function postListing(
  userId: string,
  draft: Draft,
  requestId: string,
  uploaded: Map<string, UploadedPhoto>,
  onProgress: (done: number, total: number) => void,
): Promise<{ id: string }> {
  const queue = draft.items.flatMap((item, index) =>
    item.photos.map((uri) => ({ uri, position: index + 1 })),
  );
  const photos = [];
  for (const [done, { uri, position }] of queue.entries()) {
    onProgress(done, queue.length);
    let photo = uploaded.get(uri);
    if (!photo) {
      photo = await uploadPhoto(userId, await preparePhoto(uri));
      uploaded.set(uri, photo);
    }
    photos.push({ ...photo, item_position: position });
  }
  onProgress(queue.length, queue.length);

  const { data, error } = await supabase.rpc("create_listing", {
    p_request_id: requestId,
    p_listing: {
      kind: draft.kind,
      ...draft.fields,
      items: draft.items.map((item) => ({
        name: item.name,
        price_cents: item.priceCents,
        negotiable: item.negotiable,
        condition: item.condition,
      })),
      photos,
    },
  });
  if (error) throw error;
  return data as { id: string };
}
