import { createClient } from "npm:@supabase/supabase-js@2.117.3";

// review-sign-in: App Store and Google Play reviewers cannot read our sign-in emails, so the review account
// (REVIEW_EMAIL) signs in with a fixed code (REVIEW_CODE). The app tries this after a code fails; for the
// right pair it returns a fresh one-time code, which the app verifies as usual. 404 for anything else,
// and for everything once the secrets are unset after review.
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  const email = Deno.env.get("REVIEW_EMAIL")?.toLowerCase();
  const code = Deno.env.get("REVIEW_CODE");
  const body = await req.json().catch(() => ({}));
  const asked = String(body.email ?? "")
    .trim()
    .toLowerCase();
  if (!email || !code || asked !== email || body.code !== code) return new Response(null, { status: 404 });
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ token: data.properties.email_otp });
});
