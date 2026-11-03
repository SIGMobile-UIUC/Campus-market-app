// Share-link page (LST-11): campusmarket.trade/l/<code> renders the listing-preview Edge Function as a web
// page with link-preview tags, for people without the app and for posts on Reddit or in group chats.
// Android opens the app itself once App Links are verified; this page is the fallback.

type Item = {
  position: number;
  name: string;
  price_cents: number;
  negotiable: boolean;
  condition: string;
  status: "available" | "reserved" | "sold";
};
type Photo = { url: string | null; thumb_url: string | null; item: number | null };
type Preview = {
  kind: "item" | "bundle" | "wanted";
  title: string;
  description: string;
  status: "active" | "sold_out" | "closed";
  visibility: "campus" | "open";
  area_label: string;
  zone: string | null;
  payment_methods: string[];
  budget_cents: number | null;
  created_at: string;
  campus: { name: string; short_name: string | null } | null;
  items: Item[];
  photos: Photo[];
};
type Context = { params: { code: string }; env: { SUPABASE_URL: string }; request: Request };

const CONDITIONS: Record<string, string> = {
  new: "New",
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
};
const PAYMENTS: Record<string, string> = {
  cash: "Cash",
  venmo: "Venmo",
  zelle: "Zelle",
  paypal: "PayPal",
  apple_pay: "Apple Pay",
  cash_app: "Cash App",
  other: "Other (discuss in chat)",
};
const PACKAGE = "trade.campusmarket.app";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Same rule as the app: 0 is Free and whole dollars drop the cents.
function price(cents: number) {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export async function onRequest({ params, env, request }: Context) {
  const code = params.code;
  // Crawlers and readers share one cached copy for 5 minutes; the photo URLs in it last an hour.
  const res = /^[0-9a-f]{12}$/.test(code)
    ? await fetch(`${env.SUPABASE_URL}/functions/v1/listing-preview?code=${code}`, {
        cf: { cacheTtl: 300, cacheEverything: true },
      } as RequestInit)
    : null;
  if (res && !res.ok && res.status !== 404)
    return new Response("Something went wrong. Try again later.", { status: 502 });
  const listing = res?.ok ? ((await res.json()) as Preview) : null;

  const origin = new URL(request.url).origin;
  const android = /android/i.test(request.headers.get("user-agent") ?? "");
  const html = listing ? page(listing, `${origin}/l/${code}`, code, origin, android) : gone(origin, android);
  return new Response(html, {
    status: listing ? 200 : 404,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function headline(l: Preview) {
  if (l.kind === "wanted") return `Budget ${price(l.budget_cents ?? 0)}`;
  if (l.kind === "item") return price(l.items[0].price_cents);
  const left = l.items.filter((i) => i.status === "available");
  return (
    `${left.length} of ${l.items.length} items left` +
    (left.length ? ` · from ${price(Math.min(...left.map((i) => i.price_cents)))}` : "")
  );
}

// The link-preview line, e.g. "Sold · $40 · UIUC" or "Wanted · Budget $50 · Champaign, IL".
function summary(l: Preview) {
  const status = l.status === "sold_out" ? "Sold · " : l.status === "closed" ? "Closed · " : "";
  return `${status}${l.kind === "wanted" ? "Wanted · " : ""}${headline(l)} · ${l.area_label}`;
}

function page(l: Preview, url: string, code: string, origin: string, android: boolean) {
  const cover = l.photos[0]?.url;
  const campus = l.campus?.short_name ?? l.campus?.name;
  const where = [l.area_label, l.zone].filter(Boolean).join(" · ");
  const posted = new Date(l.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const badge =
    l.status === "sold_out"
      ? "Sold"
      : l.status === "closed"
        ? "Closed"
        : l.kind === "item" && l.items[0].status === "reserved"
          ? "Reserved"
          : null;
  const negotiable =
    l.kind === "item" && l.items[0].negotiable ? ' <span class="muted">Negotiable</span>' : "";
  const gallery = l.photos
    .filter((p) => p.url)
    .map((p, i) => `<img src="${esc(p.url!)}" alt="" ${i ? 'loading="lazy"' : ""}>`)
    .join("");
  const rows =
    l.kind === "bundle"
      ? l.items
          .map((i) => {
            const thumb = l.photos.find((p) => p.item === i.position)?.thumb_url;
            const state =
              i.status === "available" ? price(i.price_cents) : i.status === "sold" ? "Sold" : "Reserved";
            return `<li class="${i.status}">${thumb ? `<img src="${esc(thumb)}" alt="">` : "<span></span>"}
              <div><b>${esc(i.name)}</b><small>${CONDITIONS[i.condition]}${i.negotiable ? " · Negotiable" : ""}</small></div>
              <strong>${state}</strong></li>`;
          })
          .join("")
      : "";
  const payments = l.payment_methods.map((m) => PAYMENTS[m] ?? m).join(", ");

  return layout(
    `${esc(l.title)} · Campus Market`,
    `<meta property="og:type" content="website">
    <meta property="og:site_name" content="Campus Market">
    <meta property="og:title" content="${esc(l.title)}">
    <meta property="og:description" content="${esc(summary(l))}">
    <meta property="og:url" content="${esc(url)}">
    ${cover ? `<meta property="og:image" content="${esc(cover)}"><meta name="twitter:card" content="summary_large_image">` : ""}`,
    `${gallery ? `<div class="gallery">${gallery}</div>` : ""}
    <main>
      ${badge ? `<span class="badge">${badge}</span>` : ""}
      <h1>${esc(l.title)}</h1>
      <p class="price">${headline(l)}${negotiable}</p>
      <p class="muted">${esc(where)} · Posted ${posted}</p>
      ${
        l.visibility === "campus" && campus
          ? `<p class="note">For ${esc(campus)} students only. Sign in with your school email to chat with the seller.</p>`
          : ""
      }
      ${rows ? `<ul class="items">${rows}</ul>` : ""}
      ${l.kind === "item" ? `<p>Condition: ${CONDITIONS[l.items[0].condition]}</p>` : ""}
      ${l.description ? `<p class="desc">${esc(l.description)}</p>` : ""}
      ${payments ? `<p class="muted">Payment: ${esc(payments)}</p>` : ""}
      ${actions(origin, android, `l/${code}`)}
    </main>`,
  );
}

function gone(origin: string, android: boolean) {
  return layout(
    "Listing not available · Campus Market",
    "",
    `<main><h1>This listing is no longer available</h1>
    <p class="muted">It may have been deleted or taken down.</p>${actions(origin, android)}</main>`,
  );
}

// Android tries the app and falls back to the download when it is not installed; /app picks the build
// for the visitor's phone.
function actions(origin: string, android: boolean, path = "") {
  const open = `intent://${path}#Intent;scheme=campusmarket;package=${PACKAGE};S.browser_fallback_url=${encodeURIComponent(`${origin}/app`)};end`;
  return `<div class="actions">
    ${android ? `<a class="button" href="${esc(open)}">Open in Campus Market</a>` : ""}
    <a class="button ${android ? "secondary" : ""}" href="/app">Get the app</a>
  </div>`;
}

function layout(title: string, meta: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${title}</title>
  <link rel="icon" href="/icon.png">
  ${meta}
  <style>
    :root { --bg: #fff; --surface: #f1f2f4; --ink: #17181a; --muted: #5e6168; --line: #e7e8eb; --primary: #334155; }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #0f0f10; --surface: #1b1b1e; --ink: #f2f2f2; --muted: #a6a6ab; --line: #2a2a2d; --primary: #cbd5e1; }
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, sans-serif; }
    .gallery { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; max-width: 640px; margin: 0 auto; }
    .gallery img { flex: 0 0 100%; height: min(100vw, 640px); object-fit: cover; scroll-snap-align: center; background: var(--surface); }
    main { max-width: 640px; margin: 0 auto; padding: 16px 16px 40px; }
    h1 { font-size: 22px; margin: 4px 0; }
    .price { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
    .muted, small { color: var(--muted); font-weight: 400; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 99px; background: var(--surface); font-size: 13px; font-weight: 600; }
    .note { background: var(--surface); border-radius: 12px; padding: 12px; }
    .desc { white-space: pre-wrap; }
    .items { list-style: none; padding: 0; margin: 16px 0; border-top: 1px solid var(--line); }
    .items li { display: flex; gap: 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--line); }
    .items img, .items span { width: 56px; height: 56px; border-radius: 8px; object-fit: cover; background: var(--surface); flex: none; }
    .items div { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .items li.sold, .items li.reserved { opacity: .5; }
    .actions { margin-top: 24px; display: flex; flex-direction: column; gap: 8px; text-align: center; }
    .button { display: block; padding: 14px; border-radius: 12px; background: var(--primary); color: var(--bg); font-weight: 600; text-decoration: none; }
    .button.secondary { background: var(--surface); color: var(--ink); }
  </style>
</head>
<body>${body}</body>
</html>`;
}
