#!/usr/bin/env node
// Enrich Meta ads (data/ads/meta-*.json) with their real creatives from the public
// Meta Ad Library web UI, which embeds full ad snapshots (body, title, CTA, link,
// images, videos, carousel cards, collation_count) in its server-rendered JSON.
//
// Why a browser: facebook.com answers plain HTTP clients with a JS challenge (403);
// a headless Chromium passes it transparently. Nothing here is fabricated: every
// field is copied from the snapshot Meta returns for that ad_archive_id.
//
// Output: data/media/meta-media.json
//   { generatedAt, items: { [adId]: { media, body?, headline?, cta?, landingUrl?,
//     platforms?, variations?, format?, thumbnailUrl?, displayFormat, fetchedAt,
//     mediaExpiresAt? } }, errors: { [adId]: reason } }
// Plus one poster JPEG per ad: public/media/meta/<adId>.jpg (<= ~80KB, <= 720px wide),
// because fbcdn URLs are signed and expire after a few days. Videos stay remote.
//
// Strategy per run:
//   1. Group ads still missing media by (pageId, market) and open the Ad Library
//      "all ads of this page" view for that country; scroll a little so the
//      GraphQL pagination loads more. Collect snapshots for our ids
//      (this view also exposes collation_count = # of variations).
//   2. Any id not found that way is opened directly (?id=<id>), whose SSR payload
//      contains `deeplink_ad_archive` with the snapshot.
//
// Usage:
//   node scripts/ingest/enrich-meta-media.mjs [--market TR|US] [--ids 1,2] [--limit N]
//        [--force] [--concurrency 2] [--no-page-search] [--headful] [--dry-run]
// Requires playwright (optional dependency, not in package.json):
//   npm i --no-save playwright   (or set PLAYWRIGHT_MODULE=/path/to/node_modules/playwright)
// Chromium: uses Playwright's bundled browser, or CHROMIUM_PATH, or /opt/pw-browsers/*.
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, ADS_DIR, readJson, writeJsonAtomic, parseArgs, sleep, log, isMain } from "./io.mjs";

const OUT_FILE = resolve(ROOT, "data", "media", "meta-media.json");
const THUMB_DIR = resolve(ROOT, "public", "media", "meta");
const THUMB_PUBLIC = "/media/meta";
const THUMB_MAX_W = 720;
const THUMB_MAX_BYTES = 80 * 1024;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const LIB = "https://www.facebook.com/ads/library/";

// ---------------------------------------------------------------------------
// Playwright loading (optional dependency)
// ---------------------------------------------------------------------------
async function loadPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE) {
    const p = resolve(process.env.PLAYWRIGHT_MODULE);
    candidates.push(pathToFileURL(existsSync(join(p, "index.mjs")) ? join(p, "index.mjs") : p).href);
  }
  candidates.push("playwright", "playwright-core");
  for (const c of candidates) {
    try {
      const mod = await import(c);
      return mod.chromium ? mod : mod.default;
    } catch { /* try next */ }
  }
  throw new Error(
    "playwright is not installed. It is an optional dependency of this script:\n" +
      "  npm i --no-save playwright\n" +
      "or point PLAYWRIGHT_MODULE at an existing node_modules/playwright directory.",
  );
}

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  try {
    const dirs = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      const exe = join(base, d, "chrome-linux", "chrome");
      if (existsSync(exe)) return exe;
    }
  } catch { /* none */ }
  return undefined;
}

async function launch(pw, headful) {
  const opts = { headless: !headful, args: ["--disable-blink-features=AutomationControlled"] };
  try {
    return await pw.chromium.launch(opts);
  } catch (err) {
    const exe = findChromium();
    if (!exe) throw err;
    log(`[enrich] bundled chromium unavailable (${err.message.split("\n")[0]}), using ${exe}`);
    return pw.chromium.launch({ ...opts, executablePath: exe });
  }
}

// ---------------------------------------------------------------------------
// Snapshot extraction
// ---------------------------------------------------------------------------
function walk(o, fn) {
  if (o && typeof o === "object") {
    fn(o);
    for (const k in o) walk(o[k], fn);
  }
}

/** Collect every {ad_archive_id, snapshot} object found in a JSON value. */
function collectAds(json, into) {
  walk(json, (o) => {
    if (typeof o.ad_archive_id === "string" && o.snapshot && typeof o.snapshot === "object") {
      const prev = into.get(o.ad_archive_id);
      // Prefer the record that carries collation_count (search results) over the deeplink one.
      if (!prev || (prev.collation_count == null && o.collation_count != null)) into.set(o.ad_archive_id, o);
    }
  });
}

function collectFromHtml(html, into) {
  const re = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    if (!m[1].includes("ad_archive_id")) continue;
    try { collectAds(JSON.parse(m[1]), into); } catch { /* not JSON */ }
  }
}

/** GraphQL responses may be several JSON documents separated by newlines. */
function collectFromText(text, into) {
  if (!text.includes("ad_archive_id")) return;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try { collectAds(JSON.parse(t), into); } catch { /* partial */ }
  }
}

const PLATFORM = {
  FACEBOOK: "facebook", INSTAGRAM: "instagram", MESSENGER: "messenger",
  AUDIENCE_NETWORK: "audience_network", WHATSAPP: "whatsapp", THREADS: "threads",
};
const isTemplate = (s) => typeof s === "string" && /\{\{.+?\}\}/.test(s);
const clean = (s) => (typeof s === "string" && s.trim() && !isTemplate(s) ? s.trim() : undefined);

function mediaFrom(o) {
  // Works for snapshot.videos[i], snapshot.images[i] and snapshot.cards[i].
  const v = o.video_hd_url || o.video_sd_url;
  if (v) return { type: "video", url: v, thumbnailUrl: o.video_preview_image_url || undefined };
  const img = o.original_image_url || o.resized_image_url;
  if (img) return { type: "image", url: img, thumbnailUrl: o.resized_image_url || undefined };
  return null;
}

/** Earliest `oe=` (hex unix seconds) among fbcdn URLs = when the links stop working. */
function expiry(urls) {
  let min = Infinity;
  for (const u of urls) {
    const m = /[?&]oe=([0-9A-Fa-f]{6,10})/.exec(u || "");
    if (m) min = Math.min(min, parseInt(m[1], 16));
  }
  return Number.isFinite(min) ? new Date(min * 1000).toISOString() : undefined;
}

export function toItem(rec) {
  const s = rec.snapshot;
  const cards = Array.isArray(s.cards) ? s.cards : [];
  const media = [];
  for (const v of s.videos || []) { const m = mediaFrom(v); if (m) media.push(m); }
  for (const i of s.images || []) { const m = mediaFrom(i); if (m) media.push(m); }
  for (const c of cards) { const m = mediaFrom(c); if (m) media.push(m); }
  for (const v of s.extra_videos || []) { const m = mediaFrom(v); if (m) media.push(m); }
  for (const i of s.extra_images || []) { const m = mediaFrom(i); if (m) media.push(m); }
  // Dedupe identical URLs (DCO sometimes repeats assets).
  const seen = new Set();
  const uniq = media.filter((m) => (seen.has(m.url) ? false : (seen.add(m.url), true)));
  for (const m of uniq) if (!m.thumbnailUrl) delete m.thumbnailUrl;

  const firstCard = cards[0] || {};
  const body = clean(s.body?.text) ?? clean(firstCard.body);
  const headline = clean(s.title) ?? clean(firstCard.title) ?? clean(s.link_description) ?? clean(firstCard.link_description);
  const cta = clean(s.cta_text) ?? clean(firstCard.cta_text);
  const landingUrl = clean(s.link_url) ?? clean(firstCard.link_url);
  const platforms = (rec.publisher_platform || []).map((p) => PLATFORM[p] || String(p).toLowerCase());

  const df = s.display_format || null;
  let format;
  if (df === "VIDEO") format = "video";
  else if (df === "IMAGE") format = "image";
  else if (df === "CAROUSEL" || df === "MULTI_IMAGES" || df === "MULTI_VIDEOS") format = "carousel";
  else if (df === "TEXT") format = "text";
  if (!format || uniq.length === 0) {
    if (uniq.length === 0) format = "text";
    else if (uniq.length > 1) format = "carousel";
    else format = uniq[0].type;
  }

  const item = { media: uniq, format, displayFormat: df };
  if (body) item.body = body;
  if (headline) item.headline = headline;
  if (cta) item.cta = cta;
  if (landingUrl) item.landingUrl = landingUrl;
  if (platforms.length) item.platforms = platforms;
  if (typeof rec.collation_count === "number" && rec.collation_count > 0) item.variations = rec.collation_count;
  const exp = expiry(uniq.flatMap((m) => [m.url, m.thumbnailUrl]));
  if (exp) item.mediaExpiresAt = exp;
  return item;
}

/** Best still image to use as the poster for this snapshot. */
function posterUrl(rec) {
  const s = rec.snapshot;
  const pools = [s.videos, s.images, s.cards, s.extra_videos, s.extra_images];
  for (const pool of pools) {
    for (const x of pool || []) {
      const u = x.video_preview_image_url || x.resized_image_url || x.original_image_url;
      if (u) return u;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------
async function dismissCookies(page) {
  try {
    const btn = page.getByRole("button", {
      name: /allow all cookies|only allow essential|decline optional|tüm çerezlere izin ver|isteğe bağlı çerezleri reddet/i,
    });
    if (await btn.count()) { await btn.first().click({ timeout: 3000 }); await sleep(800); }
  } catch { /* no dialog */ }
}

/** Open an Ad Library URL, pass the JS challenge, return all ad records seen. */
async function loadLibrary(ctx, url, { scrolls = 0, wantIds = null } = {}) {
  const page = await ctx.newPage();
  const found = new Map();
  const pending = [];
  page.on("response", (r) => {
    const u = r.url();
    if (!u.includes("/api/graphql")) return;
    pending.push(r.text().then((t) => collectFromText(t, found)).catch(() => {}));
  });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
      // The challenge page POSTs then reloads itself; wait until the real app is in the DOM.
      const ok = await page
        .waitForFunction(() => document.querySelectorAll('script[type="application/json"]').length > 5, null, { timeout: 30_000 })
        .then(() => true, () => false);
      if (ok) break;
      await sleep(3000 + attempt * 4000);
    }
    await sleep(1500);
    await dismissCookies(page);
    collectFromHtml(await page.content(), found);
    const html = await page.content();
    if (/xfb_ad_library_is_captcha_required":true/.test(html)) throw new Error("captcha required");
    for (let i = 0; i < scrolls; i++) {
      if (wantIds && [...wantIds].every((id) => found.has(id))) break;
      await page.mouse.wheel(0, 6000);
      await sleep(2200 + Math.random() * 800);
    }
    await Promise.all(pending);
  } finally {
    await page.close().catch(() => {});
  }
  return found;
}

/** Download an image through Chromium and re-encode it to a small JPEG via canvas. */
async function makeThumb(ctx, url) {
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(url, { timeout: 45_000 });
    if (!resp || !resp.ok()) throw new Error(`poster HTTP ${resp ? resp.status() : "?"}`);
    const buf = await resp.body();
    const ct = resp.headers()["content-type"] || "image/jpeg";
    await page.goto("about:blank");
    const b64 = await page.evaluate(
      async ({ data, ct, maxW, maxBytes }) => {
        const img = new Image();
        img.src = `data:${ct};base64,${data}`;
        await img.decode();
        const scale = Math.min(1, maxW / img.naturalWidth);
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        const g = c.getContext("2d");
        g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        let out = "";
        for (const q of [0.8, 0.72, 0.64, 0.56, 0.48, 0.4, 0.32]) {
          out = c.toDataURL("image/jpeg", q).split(",")[1];
          if (out.length * 0.75 <= maxBytes) break;
        }
        return out;
      },
      { data: buf.toString("base64"), ct, maxW: THUMB_MAX_W, maxBytes: THUMB_MAX_BYTES },
    );
    return Buffer.from(b64, "base64");
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function loadAds(market) {
  const files = (await readdir(ADS_DIR)).filter((f) => /^meta-.*\.json$/.test(f)).sort();
  const ads = [];
  for (const f of files) {
    const d = await readJson(join(ADS_DIR, f), null).catch((e) => (log(`[enrich] skip ${f}: ${e.message}`), null));
    for (const a of d?.ads || []) {
      if (a?.source !== "meta" || !/^meta_\d+$/.test(a.id || "")) continue;
      if (market && a.market !== market) continue;
      ads.push(a);
    }
  }
  const byId = new Map();
  for (const a of ads) if (!byId.has(a.id)) byId.set(a.id, a);
  return [...byId.values()];
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, ["force", "headful", "dry-run", "no-page-search", "help", "retry-errors"]);
  if (args.help) {
    console.log("node scripts/ingest/enrich-meta-media.mjs [--market TR|US] [--ids a,b] [--limit N] [--force] [--retry-errors] [--concurrency 2] [--no-page-search] [--headful] [--dry-run]");
    return;
  }
  const concurrency = Math.max(1, Math.min(3, Number(args.concurrency) || 2));
  const out = (await readJson(OUT_FILE, null)) || { generatedAt: null, items: {}, errors: {} };
  out.items ||= {};
  out.errors ||= {};

  let ads = await loadAds(args.market ? String(args.market).toUpperCase() : null);
  if (args.ids) {
    const want = new Set(String(args.ids).split(",").map((s) => (s.startsWith("meta_") ? s : `meta_${s}`)));
    ads = ads.filter((a) => want.has(a.id));
  }
  const todo = [];
  for (const a of ads) {
    const have = out.items[a.id];
    const thumbOk = have?.thumbnailUrl ? existsSync(join(THUMB_DIR, `${a.id}.jpg`)) : true;
    if (!args.force && have && have.media?.length && thumbOk) continue;
    if (!args.force && !have && out.errors[a.id] && !args["retry-errors"]) continue;
    todo.push(a);
  }
  if (args.limit) todo.splice(Number(args.limit));
  log(`[enrich] ${ads.length} meta ads considered, ${todo.length} to enrich`);
  if (!todo.length || args["dry-run"]) return out;

  const pw = await loadPlaywright();
  const browser = await launch(pw, args.headful);
  const ctx = await browser.newContext({ userAgent: UA, locale: "en-US", viewport: { width: 1366, height: 900 } });
  await mkdir(THUMB_DIR, { recursive: true });

  const records = new Map(); // ad_archive_id -> record
  const nativeId = (a) => a.id.slice("meta_".length);
  let dirty = 0;
  const save = async () => {
    out.generatedAt = new Date().toISOString();
    out.items = Object.fromEntries(Object.entries(out.items).sort(([a], [b]) => a.localeCompare(b)));
    await writeJsonAtomic(OUT_FILE, out);
    dirty = 0;
  };

  const finish = async (ad) => {
    const rec = records.get(nativeId(ad));
    if (!rec) return false;
    const item = toItem(rec);
    item.fetchedAt = new Date().toISOString();
    const poster = posterUrl(rec);
    if (poster) {
      try {
        const jpg = await makeThumb(ctx, poster);
        await writeFile(join(THUMB_DIR, `${ad.id}.jpg`), jpg);
        item.thumbnailUrl = `${THUMB_PUBLIC}/${ad.id}.jpg`;
        if (item.media[0]) item.media[0].thumbnailUrl = item.thumbnailUrl;
      } catch (e) {
        log(`[enrich] ${ad.id}: poster failed: ${e.message}`);
      }
    }
    out.items[ad.id] = item;
    delete out.errors[ad.id];
    if (++dirty >= 5) await save();
    return true;
  };

  try {
    // Phase 1: page-level views, one per (pageId, market).
    if (!args["no-page-search"]) {
      const groups = new Map();
      for (const a of todo) {
        if (!a.brand?.pageId) continue;
        const k = `${a.brand.pageId}|${a.market}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(a);
      }
      log(`[enrich] phase 1: ${groups.size} page views`);
      await pool([...groups.entries()], concurrency, async ([k, list]) => {
        const [pageId, market] = k.split("|");
        const country = market === "TR" || market === "US" ? market : "ALL";
        const url = `${LIB}?active_status=all&ad_type=all&country=${country}&media_type=all&search_type=page&view_all_page_id=${pageId}`;
        const want = new Set(list.map(nativeId));
        try {
          const found = await loadLibrary(ctx, url, { scrolls: Math.min(8, Math.ceil(list.length / 3) + 2), wantIds: want });
          for (const [id, rec] of found) if (want.has(id)) records.set(id, rec);
          let hit = 0;
          for (const a of list) if (await finish(a)) hit++;
          log(`[enrich] page ${pageId} (${country}): ${found.size} ads seen, ${hit}/${list.length} matched`);
        } catch (e) {
          log(`[enrich] page ${pageId} failed: ${e.message}`);
        }
        await sleep(1500 + Math.random() * 1500);
      });
      await save();
    }

    // Phase 2: direct deeplinks for whatever is still missing.
    const rest = todo.filter((a) => !records.has(nativeId(a)));
    log(`[enrich] phase 2: ${rest.length} direct ad pages`);
    await pool(rest, concurrency, async (a) => {
      const id = nativeId(a);
      try {
        const found = await loadLibrary(ctx, `${LIB}?id=${id}`);
        const rec = found.get(id);
        if (rec) { records.set(id, rec); await finish(a); log(`[enrich] ${a.id}: ok (deeplink)`); }
        else { out.errors[a.id] = "not found in Ad Library page"; log(`[enrich] ${a.id}: not found`); }
      } catch (e) {
        out.errors[a.id] = String(e.message).slice(0, 200);
        log(`[enrich] ${a.id}: ${e.message}`);
      }
      await sleep(1200 + Math.random() * 1500);
    });
  } finally {
    await save();
    await browser.close().catch(() => {});
  }

  const done = todo.filter((a) => out.items[a.id]).length;
  log(`[enrich] done: ${done}/${todo.length} enriched this run, ${Object.keys(out.items).length} items total -> ${OUT_FILE}`);
  return out;
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(`[enrich] ${err.stack || err.message}`);
    process.exit(1);
  });
}
