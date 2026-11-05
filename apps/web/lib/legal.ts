// /terms and /privacy: the documents the app shows (apps/mobile/src/features/legal/documents.ts), as web
// pages for the app stores and for people without the app. Same markdown subset as the app renders.
import { PRIVACY, TERMS } from "../../mobile/src/features/legal/documents";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const inline = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");

function toHtml(markdown: string) {
  let html = "";
  let list: "ul" | "ol" | null = null;
  for (const line of markdown.split("\n").filter((l) => l.trim())) {
    const item = line.match(/^(- |\d+\. )(.*)$/);
    const kind = item ? (item[1] === "- " ? "ul" : "ol") : null;
    if (list && list !== kind) {
      html += `</${list}>`;
      list = null;
    }
    if (kind && !list) html += `<${(list = kind)}>`;
    if (item) html += `<li>${inline(item[2])}</li>`;
    else if (line.startsWith("# ")) html += `<h1>${inline(line.slice(2))}</h1>`;
    else if (line.startsWith("## ")) html += `<h2>${inline(line.slice(3))}</h2>`;
    else html += `<p>${inline(line)}</p>`;
  }
  return html + (list ? `</${list}>` : "");
}

export function legalPage(doc: "terms" | "privacy") {
  const [title, markdown] = doc === "terms" ? ["Terms", TERMS] : ["Privacy Policy", PRIVACY];
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Campus Market</title>
  <link rel="icon" href="/icon.png">
  <style>
    :root { --bg: #fff; --ink: #17181a; --muted: #5e6168; --line: #e7e8eb; }
    @media (prefers-color-scheme: dark) { :root { --bg: #0f0f10; --ink: #f2f2f2; --muted: #a6a6ab; --line: #2a2a2d; } }
    body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 system-ui, -apple-system, sans-serif; }
    main { max-width: 720px; margin: 0 auto; padding: 32px 16px 48px; }
    h1 { font-size: 28px; line-height: 1.2; }
    h2 { font-size: 19px; margin-top: 32px; }
    nav { border-top: 1px solid var(--line); margin-top: 40px; padding-top: 16px; color: var(--muted); }
    a { color: inherit; }
  </style>
</head>
<body>
  <main>${toHtml(markdown)}
    <nav><a href="/">Campus Market</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy Policy</a></nav>
  </main>
</body>
</html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
