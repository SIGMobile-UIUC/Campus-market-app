import { createClient } from "npm:@supabase/supabase-js@2.117.3";

// delete-account (ACC-8, spec 6.11): takes a fresh code sent to the sign-in email, removes personal data
// in one transaction (delete_account), then soft-deletes the auth user, which ends every session and
// frees the email. 204 when done, 400 for a wrong or expired code, 409 while answering an open dispute.
const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
  const { data } = await admin.auth.getUser(jwt);
  const user = data.user;
  if (!user?.email) return Response.json({ code: "AUTH_REQUIRED" }, { status: 401 });

  const { code } = await req.json().catch(() => ({}));
  const check = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false },
  });
  const { error: codeError } = await check.auth.verifyOtp({
    email: user.email,
    token: String(code ?? ""),
    type: "email",
  });
  if (codeError) return Response.json({ code: "INVALID_CODE" }, { status: 400 });

  const { error } = await admin.rpc("delete_account", { p_user_id: user.id });
  if (error?.message === "DISPUTE_OPEN") return Response.json({ code: "DISPUTE_OPEN" }, { status: 409 });
  if (error) return Response.json({ code: error.message }, { status: 500 });

  const { error: authError } = await admin.auth.admin.deleteUser(user.id, true);
  if (authError) return Response.json({ code: "AUTH_DELETE_FAILED" }, { status: 500 });
  return new Response(null, { status: 204 });
});
