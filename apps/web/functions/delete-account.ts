// /delete-account (ACC-8): deletes an account without the app, which Google Play requires. Plain forms, so
// it works without JavaScript and needs no CORS: send a code to the sign-in email, then confirm with it.
// The delete-account Edge Function does the deletion, the same as in the app.
type Env = { SUPABASE_URL: string; SUPABASE_PUBLISHABLE_KEY: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(body: string, status = 200) {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Delete your account · Campus Market</title>
  <link rel="icon" href="/icon.png">
  <style>
    :root { --bg: #fff; --surface: #f1f2f4; --ink: #17181a; --muted: #5e6168; --danger: #c62828; }
    @media (prefers-color-scheme: dark) { :root { --bg: #0f0f10; --surface: #1b1b1e; --ink: #f2f2f2; --muted: #a6a6ab; --danger: #ef5350; } }
    body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 system-ui, -apple-system, sans-serif; }
    main { max-width: 480px; margin: 0 auto; padding: 32px 16px 48px; }
    h1 { font-size: 26px; line-height: 1.2; }
    p, li { color: var(--muted); }
    label { display: block; margin-top: 16px; font-weight: 600; }
    input[type=email], input[type=text] { box-sizing: border-box; width: 100%; margin-top: 6px; padding: 12px; border: 0; border-radius: 12px; background: var(--surface); color: var(--ink); font-size: 16px; }
    button { width: 100%; margin-top: 20px; padding: 14px; border: 0; border-radius: 12px; background: var(--danger); color: #fff; font-size: 16px; font-weight: 600; }
    .error { color: var(--danger); }
    a { color: inherit; }
  </style>
</head>
<body>
  <main>
    <h1>Delete your Campus Market account</h1>
    ${body}
    <p><small><a href="/">Campus Market</a> · <a href="/privacy">Privacy Policy</a></small></p>
  </main>
</body>
</html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

const WHAT = `<p>In the app, go to Settings, then Delete account. Without the app, use this page.</p>
    <ul>
      <li>Your email, profile, settings and favorites are removed, and your listings come down; their photos are deleted within 30 days.</li>
      <li>Trades, reviews and messages you took part in stay for the other person and show "Deleted user".</li>
      <li>Records of rule violations are kept for 3 years, and a banned email cannot sign up again.</li>
    </ul>`;

function emailStep(error = "") {
  return page(`${WHAT}
    <form method="post">
      <input type="hidden" name="step" value="send">
      <label for="email">Sign-in email</label>
      <input id="email" name="email" type="email" required autocomplete="email">
      ${error && `<p class="error">${error}</p>`}
      <button>Send code</button>
    </form>`);
}

function codeStep(email: string, error = "") {
  return page(`<p>If an account uses ${esc(email)}, we sent it a 6-digit code. It expires in 10 minutes.</p>
    <form method="post">
      <input type="hidden" name="step" value="delete">
      <input type="hidden" name="email" value="${esc(email)}">
      <label for="code">Code</label>
      <input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code">
      ${error && `<p class="error">${error}</p>`}
      <p>Deleting your account cannot be undone.</p>
      <button>Delete my account</button>
    </form>`);
}

export async function onRequest({ request, env }: { request: Request; env: Env }) {
  if (request.method !== "POST") return emailStep();
  const form = await request.formData();
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email.includes("@")) return emailStep("Enter the email you sign in with.");
  const headers = {
    apikey: env.SUPABASE_PUBLISHABLE_KEY,
    "content-type": "application/json",
  };

  if (form.get("step") === "send") {
    // An unknown email gets the same answer, so the page does not reveal who has an account.
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/otp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, create_user: false }),
    });
    if (res.status === 429) return emailStep("Too many codes were sent. Wait a minute and try again.");
    return codeStep(email);
  }

  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/delete-account`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, code: String(form.get("code") ?? "") }),
  });
  if (res.status === 204) return page("<p>Your account has been deleted.</p>");
  if (res.status === 400)
    return codeStep(email, "That code is wrong or expired. Go back and send a new one.");
  if (res.status === 409)
    return codeStep(email, "You can delete your account once the dispute about your trade is resolved.");
  return page(
    `<p class="error">Something went wrong. Try again later, or write to campusmarketsupports@gmail.com.</p>`,
    502,
  );
}
