import { createClient } from "npm:@supabase/supabase-js@2.117.3";

// listing-preview (LST-11): GET ?code=<share_code> returns the public preview behind a share link, for the
// web page and for app users who cannot see the listing itself. Photos are private, so their URLs are
// signed here for an hour; the web page caches the response for 5 minutes. 404 when there is no listing.
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

type Photo = { path: string | null; thumb_path: string; blurhash: string; item: number | null };

Deno.serve(async (req) => {
  const code = new URL(req.url).searchParams.get("code") ?? "";
  if (!/^[0-9a-f]{12}$/.test(code)) return new Response(null, { status: 404 });

  const { data: preview, error } = await admin.rpc("listing_preview", { p_code: code });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!preview) return new Response(null, { status: 404 });

  // A sold listing past its purge date keeps only the cover thumbnail, which then serves as the photo.
  const photos = preview.photos as Photo[];
  const paths = [...new Set(photos.flatMap((p) => [p.path ?? p.thumb_path, p.thumb_path]))];
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data, error: signError } = await admin.storage
      .from("listing-photos")
      .createSignedUrls(paths, 3600);
    if (signError) return Response.json({ error: signError.message }, { status: 500 });
    for (const s of data) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }

  return Response.json({
    ...preview,
    photos: photos.map((p) => ({
      url: urls.get(p.path ?? p.thumb_path) ?? null,
      thumb_url: urls.get(p.thumb_path) ?? null,
      blurhash: p.blurhash,
      item: p.item,
    })),
  });
});
