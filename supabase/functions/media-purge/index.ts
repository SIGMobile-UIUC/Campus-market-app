import { createClient } from "npm:@supabase/supabase-js@2.117.3";

// media-purge (spec 4.7.2, 6.11): daily-maintenance calls this through pg_net with the shared secret.
// Files go first through the storage API, then media_purge_finish changes the rows, so a run that fails
// halfway leaves rows that the next run picks up again.
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  const secret = Deno.env.get("MEDIA_PURGE_SECRET");
  if (!secret || req.headers.get("x-purge-secret") !== secret) return new Response(null, { status: 401 });

  const { data: due, error } = await admin.rpc("media_purge_due");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let deleted = 0;
  for (const [bucket, paths] of Object.entries(due.objects as Record<string, string[]>)) {
    // The storage API takes up to 1,000 paths per call.
    for (let i = 0; i < paths.length; i += 1000) {
      const { data, error: removeError } = await admin.storage.from(bucket).remove(paths.slice(i, i + 1000));
      if (removeError) return Response.json({ error: removeError.message }, { status: 500 });
      deleted += data.length;
    }
  }

  const { data: done, error: finishError } = await admin.rpc("media_purge_finish", { p_due: due });
  if (finishError) return Response.json({ error: finishError.message }, { status: 500 });
  return Response.json({ ...done, objects_deleted: deleted });
});
