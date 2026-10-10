#!/usr/bin/env node
/**
 * One real end-to-end "Özetle" run. Costs one Gemini call (~$0.01–0.03 for a 30–60 s video).
 *
 * Local (calls Gemini directly through src/lib/gemini.ts; key ONLY from env):
 *   GEMINI_API_KEY=... node scripts/test-gemini.mjs [--ad <adId>] [--kind video|youtube|image] [--poster]
 *   (optional GEMINI_MODEL=... to override the default model)
 *
 * Remote (exercises the deployed POST /api/analyze behind the login gate; the key stays on Vercel):
 *   ADMIN_USERNAME=... ADMIN_PASSWORD=... node scripts/test-gemini.mjs --url https://adgym-ipek-palas.vercel.app [--ad <adId>] [--kind ...]
 *
 * Without --ad, the newest-collected Meta video ad (or YouTube / image ad for --kind) is used.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);
const remote = arg("url");
const kind = arg("kind") ?? "video";
const allowPoster = flag("poster");

// Paid-tier list prices (USD per 1M tokens, Oct 2026, ai.google.dev/gemini-api/docs/pricing).
const PRICES = {
  "gemini-3.8-flash": [0.75, 3.75],
  "gemini-3.6-flash": [0.75, 3.75],
  "gemini-3.5-flash-lite": [0.3, 2.5],
  "gemini-3-flash-preview": [0.5, 3.0],
  "gemini-2.5-flash": [0.3, 2.5],
};

let jiti;
try {
  const { createJiti } = await import("jiti");
  jiti = createJiti(import.meta.url);
} catch {
  console.error("jiti bulunamadı (devDependencies kurulu mu? `npm install`).");
  process.exit(1);
}

const { getAllAds, getAdById } = await jiti.import(path.join(ROOT, "src/lib/ads.ts"));
const { adYouTubeId } = await jiti.import(path.join(ROOT, "src/lib/youtube.ts"));

function pickAd() {
  const id = arg("ad");
  if (id) {
    const ad = getAdById(id);
    if (!ad) throw new Error(`Reklam bulunamadı: ${id}`);
    return ad;
  }
  const ads = getAllAds();
  const byNewest = [...ads].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  const match =
    kind === "youtube"
      ? (a) => Boolean(adYouTubeId(a))
      : kind === "image"
        ? (a) => a.media.length > 0 && a.media.every((m) => m.type === "image") && !adYouTubeId(a)
        : (a) => a.source === "meta" && a.media.some((m) => m.type === "video");
  const ad = byNewest.find(match);
  if (!ad) throw new Error(`--kind ${kind} için reklam yok`);
  return ad;
}

function report(record, ms, cached) {
  const a = record.data;
  console.log(`\n✓ ${cached ? "(cache) " : ""}${(ms / 1000).toFixed(1)} sn · model ${record.model} · girdi: ${record.input}`);
  console.log(`  Hook [${a.hook.timestamp}]: ${a.hook.text}`);
  console.log(`  Neden: ${a.hook.whyItWorks}`);
  console.log(`  Yapı: ${a.structure.framework} (${a.structure.beats.length} adım)`);
  console.log(`  Sahne: ${a.scenes.length} · transkript: ${a.transcript.length} karakter · remix: ${a.remixIdeas.length}`);
  console.log(`  Neden kazanıyor: ${a.whyItWins.slice(0, 300)}${a.whyItWins.length > 300 ? "…" : ""}`);
  const u = record.usage;
  if (u) {
    const p = PRICES[record.model];
    const out = (u.outputTokens ?? 0) + (u.thoughtsTokens ?? 0);
    const cost = p ? ((u.promptTokens ?? 0) * p[0] + out * p[1]) / 1e6 : undefined;
    console.log(`  Token: girdi ${u.promptTokens} · çıktı ${u.outputTokens} · düşünme ${u.thoughtsTokens ?? 0}${cost !== undefined ? ` · ≈ $${cost.toFixed(4)}` : ""}`);
  }
  if (flag("json")) console.log(JSON.stringify(record, null, 2));
}

const ad = pickAd();
console.log(`Reklam: ${ad.id} · ${ad.brand.name} · ${ad.format} · ${ad.activeDays ?? "?"} gün${allowPoster ? " · (poster modu)" : ""}`);

if (remote) {
  const user = process.env.ADMIN_USERNAME;
  const pass = process.env.ADMIN_PASSWORD;
  if (!user || !pass) {
    console.error("Uzak mod için ADMIN_USERNAME ve ADMIN_PASSWORD ortam değişkenleri gerekli.");
    process.exit(1);
  }
  const base = remote.replace(/\/$/, "");
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ username: user, password: pass }),
    redirect: "manual",
  });
  const cookie = (login.headers.getSetCookie?.() ?? [login.headers.get("set-cookie") ?? ""]).map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  if (!login.ok || !cookie) {
    console.error(`Giriş başarısız (HTTP ${login.status}).`);
    process.exit(1);
  }
  const t0 = Date.now();
  const res = await fetch(`${base}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ adId: ad.id, allowPoster, force: flag("force") }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    console.error(`✗ HTTP ${res.status}: ${body.error ?? JSON.stringify(body)}${body.canUsePoster ? "\n  → --poster ile poster + metin modunda dene." : ""}`);
    process.exit(1);
  }
  report(body.analysis, Date.now() - t0, body.cached);
} else {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY ortam değişkeni yok. (Anahtarı asla repoya yazma.) Ya da --url ile deploy edilmiş API'yi test et.");
    process.exit(1);
  }
  const g = await jiti.import(path.join(ROOT, "src/lib/gemini.ts"));
  console.log(`Model: ${g.configuredModel()}`);
  const pending = [];
  const t0 = Date.now();
  try {
    const { record, cached } = await g.analyzeAd(ad, { allowPoster, defer: (fn) => pending.push(fn) });
    report(record, Date.now() - t0, cached);
  } catch (e) {
    console.error(`✗ ${e.code ?? "error"} (${e.status ?? "-"}): ${e.message}${e.canUsePoster ? "\n  → --poster ile poster + metin modunda dene." : ""}`);
    process.exitCode = 1;
  } finally {
    for (const fn of pending) await fn(); // delete uploaded Gemini file
  }
}
