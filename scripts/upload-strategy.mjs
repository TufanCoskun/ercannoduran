#!/usr/bin/env node
/**
 * Uploads (or replaces) the brand strategy on the deployed site: logs in as admin, then POSTs the file
 * to /api/strategy, which extracts the text and condenses it into the prompt brief with ONE Gemini call
 * (≈$0.03). The document is stored in the site's PRIVATE Vercel Blob store — never commit it to the repo.
 *
 *   ADMIN_USERNAME=... ADMIN_PASSWORD=... node scripts/upload-strategy.mjs <file.html|.md|.txt> \
 *     [--name "Strateji adı"] [--url https://adgym-ipek-palas.vercel.app] [--brief brief.md] [--inactive]
 *
 *   --brief <file>  use this hand-written brief instead of the Gemini summary (no Gemini call)
 *   --inactive      store it switched off (turn it on later on /strategy)
 *
 * Credentials come only from the environment and are never printed; the brief itself is not printed either.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);
const valueFlags = new Set(["--name", "--url", "--brief"]);
const positional = args.filter((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1]));

const file = positional[0];
const base = (opt("url") ?? process.env.ADGYM_URL ?? "https://adgym-ipek-palas.vercel.app").replace(/\/$/, "");
const user = process.env.ADMIN_USERNAME ?? "";
const pass = process.env.ADMIN_PASSWORD ?? "";

if (!file || flag("help")) {
  console.error("Kullanım: ADMIN_USERNAME=... ADMIN_PASSWORD=... node scripts/upload-strategy.mjs <dosya> [--name ad] [--url site] [--brief brief.md] [--inactive]");
  process.exit(file ? 0 : 1);
}
if (!user || !pass) {
  console.error("ADMIN_USERNAME ve ADMIN_PASSWORD ortam değişkenleri gerekli.");
  process.exit(1);
}
if (!/\.(html?|md|markdown|txt)$/i.test(file)) {
  console.error("Sadece .html, .md veya .txt dosyası yüklenebilir.");
  process.exit(1);
}

const name = opt("name") ?? path.basename(file).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
const bytes = await readFile(file);
const briefFile = opt("brief");
const brief = briefFile ? (await readFile(briefFile, "utf8")).trim() : "";

// 1) Log in (JSON → no redirect; the session cookie comes back in Set-Cookie).
const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ username: user, password: pass, remember: false }),
});
const cookie = (login.headers.getSetCookie?.() ?? [login.headers.get("set-cookie") ?? ""])
  .map((c) => c.split(";")[0])
  .filter((c) => c.startsWith("adgym_session="))
  .join("; ");
if (!login.ok || !cookie) {
  console.error(`Giriş başarısız (HTTP ${login.status}). Kullanıcı adı/şifreyi ve --url'yi kontrol et.`);
  process.exit(1);
}
console.log(`Giriş tamam (${base}).`);

// 2) Upload.
const fd = new FormData();
fd.set("name", name);
fd.set("file", new Blob([bytes], { type: /\.html?$/i.test(file) ? "text/html" : "text/plain" }), path.basename(file));
if (brief) fd.set("brief", brief);
if (flag("inactive")) fd.set("active", "0");

console.log(`Yükleniyor: ${path.basename(file)} (${bytes.length.toLocaleString("tr-TR")} bayt) → "${name}"${brief ? " + elle brief" : " — Gemini özetliyor (15–45 sn)…"}`);
const t0 = Date.now();
const res = await fetch(`${base}/api/strategy`, { method: "POST", headers: { cookie }, body: fd });
const json = await res.json().catch(() => null);
if (!res.ok || !json?.ok) {
  console.error(`Yükleme başarısız (HTTP ${res.status}): ${json?.error ?? "yanıt okunamadı"}`);
  process.exit(1);
}
const s = json.strategy;
console.log(
  [
    `Tamam (${((Date.now() - t0) / 1000).toFixed(1)} sn).`,
    `  Ad:          ${s.name}`,
    `  Kaynak metin: ${s.fullTextChars.toLocaleString("tr-TR")} karakter`,
    `  Brief:       ${s.brief.length.toLocaleString("tr-TR")} karakter (≈${json.briefTokens.toLocaleString("tr-TR")} token), ${s.briefSource}${s.model ? ` / ${s.model}` : ""}`,
    `  Durum:       ${s.active ? "AÇIK (remix fikirleri bu stratejiye göre)" : "kapalı"}`,
    `Brief'i ${base}/strategy sayfasında gözden geçirip düzenleyebilirsin.`,
  ].join("\n"),
);
