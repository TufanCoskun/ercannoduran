#!/usr/bin/env node
// Import a public Superscale ad board (https://superscale.ai/board/<handle>/<slug>) into
// AdGym's `Ad` schema -> data/ads/superscale.json.
//
// How Superscale boards work (see docs/SUPERSCALE.md):
//   * Public boards are server-rendered (Next.js RSC) and paginated through a public JSON
//     endpoint the page itself calls: GET https://superscale.ai/__api/boards/<handle>/<slug>?page=N
//     -> { data: { board, ads[40] }, meta: { page } }. No login, no token.
//   * Every ad carries `adId` = the Meta Ad Library archive id (so we emit `meta_<adId>`, which
//     dedupes with data/ads/meta-*.json), brand, creative text, platforms, start date, active
//     flag and Superscale's own performance score/stars/reach.
//   * Categories are NOT on the ad objects. They exist as server-side board filters
//     (`filters={"version":1,"industries":["HEALTH_WELLNESS"]}` / `"funnelStage":"TOFU"`), so we
//     tag ads by asking the endpoint once per category and recording which ids come back.
//   * Media lives on Superscale's own CloudFront/S3 (assets.superscale.so) behind *signed* URLs
//     that expire within hours. They are Superscale's copies, useless in a static JSON file, so
//     this importer does NOT store them: `media` stays empty and the Meta enrichment overlay
//     (scripts/ingest/enrich-meta-media.mjs -> data/media/meta-media.json) supplies the
//     creative by `meta_<id>`, exactly as for our own Meta ads.
//
// robots.txt (checked 2026-10-10) does not disallow /board/ or /__api/; the Terms & Conditions
// only bind paying customers and contain no anti-scraping clause. We still go slow: one request
// at a time with --delay ms (default 1500) between calls, and back off on 429/5xx.
//
// Usage:
//   node scripts/ingest/superscale.mjs <board-url> [<board-url> ...]
//        [--out data/ads/superscale.json] [--delay 1500] [--max-pages 20]
//        [--no-categories] [--market TR|US|GLOBAL] [--segment dtc|hotel|general]
//        [--replace] [--dry-run] [--browser]
//   Default board: https://superscale.ai/board/the-moonlighters/sam-pilieros-top-ads
//   Runs merge into the existing output file (so several boards accumulate) unless --replace.
//   --browser forces the Playwright fallback (optional dependency, loaded dynamically; only
//   needed if plain fetch ever gets a bot challenge instead of JSON).
// Plain Node 22 ESM, no npm dependencies.
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, ADS_DIR, readJson, writeJsonAtomic, parseArgs, sleep, log, isMain } from "./io.mjs";
import { compact } from "./normalize.mjs";
import { computeScore, daysBetween } from "./score.mjs";

const DEFAULT_BOARD = "https://superscale.ai/board/the-moonlighters/sam-pilieros-top-ads";
const API = "https://superscale.ai/__api/boards";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const FILTER_VERSION = 1; // AD_BOARD_FILTER_DEFINITION_VERSION in Superscale's bundle

// Superscale's industry taxonomy (values + labels copied from the board page's filter menu).
// `group` is the menu section; GAMING / OTHER exist in two sections but are one API value.
export const INDUSTRIES = [
  ["E_COMMERCE_DTC", "E-Commerce", "general"],
  ["MOBILE_APPS", "Mobile Apps", "general"],
  ["OTHER", "Other", "general"],
  ["BEAUTY_COSMETICS", "Beauty and Cosmetics", "ecommerce"],
  ["FASHION_APPAREL", "Fashion and Apparel", "ecommerce"],
  ["HEALTH_WELLNESS", "Health and Wellness", "ecommerce"],
  ["FOOD_BEVERAGE", "Food and Beverage", "ecommerce"],
  ["HOME_LIVING", "Home and Living", "ecommerce"],
  ["CONSUMER_ELECTRONICS", "Consumer Electronics", "ecommerce"],
  ["SPORTS_OUTDOORS", "Sports and Outdoors", "ecommerce"],
  ["KIDS_BABY", "Kids and Baby", "ecommerce"],
  ["PETS", "Pets", "ecommerce"],
  ["JEWELRY_ACCESSORIES", "Jewelry and Accessories", "ecommerce"],
  ["MEDIA_PUBLISHING", "Media and Publishing", "ecommerce"],
  ["AUTOMOTIVE", "Automotive", "ecommerce"],
  ["TRAVEL_HOSPITALITY", "Travel and Hospitality", "ecommerce"],
  ["EDUCATION", "Education", "ecommerce"],
  ["FINANCE", "Finance", "ecommerce"],
  ["INSURANCE", "Insurance", "ecommerce"],
  ["REAL_ESTATE", "Real Estate", "ecommerce"],
  ["HEALTHCARE", "Healthcare", "ecommerce"],
  ["PROFESSIONAL_SERVICES", "Professional Services", "ecommerce"],
  ["ENTERTAINMENT", "Entertainment", "ecommerce"],
  ["GAMING", "Gaming", "ecommerce"],
  ["HEALTH_FITNESS", "Health and Fitness", "mobileApps"],
  ["FINANCE_FINTECH", "Finance and Fintech", "mobileApps"],
  ["EDUCATION_LEARNING", "Education and Learning", "mobileApps"],
  ["TRAVEL_MOBILITY", "Travel and Mobility", "mobileApps"],
  ["ENTERTAINMENT_MEDIA", "Entertainment and Media", "mobileApps"],
  ["SOCIAL_COMMUNITY", "Social and Community", "mobileApps"],
  ["PRODUCTIVITY_TOOLS", "Productivity Tools", "mobileApps"],
  ["SHOPPING_E_COMMERCE", "Shopping and E-Commerce", "mobileApps"],
  ["UTILITIES_SECURITY", "Utilities and Security", "mobileApps"],
  ["LIFESTYLE", "Lifestyle", "mobileApps"],
].map(([value, label, group]) => ({ value, label, group }));

export const FUNNEL_STAGES = [
  { value: "TOFU", label: "Awareness" },
  { value: "MOFU", label: "Consideration" },
  { value: "BOFU", label: "Conversion" },
];

const GENERIC_INDUSTRIES = new Set(["E_COMMERCE_DTC", "MOBILE_APPS", "OTHER"]);
const ECOM_VALUES = new Set(INDUSTRIES.filter((i) => i.group === "ecommerce").map((i) => i.value));
const slug = (s) => s.toLowerCase().replace(/_/g, "-");

// ---------------------------------------------------------------------------
// Board URL
// ---------------------------------------------------------------------------
export function parseBoardUrl(input) {
  const u = new URL(input);
  if (!/(^|\.)superscale\.ai$/.test(u.hostname)) throw new Error(`Not a superscale.ai URL: ${input}`);
  const m = u.pathname.match(/^\/board\/([^/]+)\/([^/]+)\/?$/);
  if (!m) throw new Error(`Expected https://superscale.ai/board/<handle>/<slug>, got ${input}`);
  return { handle: decodeURIComponent(m[1]), slug: decodeURIComponent(m[2]), url: `https://superscale.ai/board/${m[1]}/${m[2]}` };
}

function apiUrl({ handle, slug }, { page = 1, filters } = {}) {
  const q = new URLSearchParams();
  if (filters) q.set("filters", JSON.stringify({ version: FILTER_VERSION, ...filters }));
  if (page > 1) q.set("page", String(page));
  const qs = q.toString();
  return `${API}/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}${qs ? `?${qs}` : ""}`;
}

// ---------------------------------------------------------------------------
// HTTP: plain fetch first, optional Playwright fallback (same-origin fetch inside a real page)
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
  throw new Error("playwright is not installed (optional): npm i --no-save playwright, or set PLAYWRIGHT_MODULE");
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

class Client {
  constructor({ delay, browser }) {
    this.delay = delay;
    this.forceBrowser = browser;
    this.page = null;
    this.browser = null;
    this.last = 0;
    this.requests = 0;
  }

  async throttle() {
    const wait = this.last + this.delay - Date.now();
    if (wait > 0) await sleep(wait);
    this.last = Date.now();
  }

  async viaFetch(url) {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json", referer: "https://superscale.ai/" } });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* challenge / html */ }
    return { status: res.status, json };
  }

  async viaBrowser(url, boardUrl) {
    if (!this.page) {
      const pw = await loadPlaywright();
      this.browser = await pw.chromium.launch({ headless: true, executablePath: findChromium() });
      const ctx = await this.browser.newContext({ userAgent: UA });
      this.page = await ctx.newPage();
      await this.page.goto(boardUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await this.page.waitForTimeout(3000);
    }
    return this.page.evaluate(async (u) => {
      const r = await fetch(u, { headers: { accept: "application/json" } });
      const t = await r.text();
      let j = null;
      try { j = JSON.parse(t); } catch { /* ignore */ }
      return { status: r.status, json: j };
    }, url);
  }

  async get(url, boardUrl) {
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.throttle();
      this.requests++;
      let r;
      try {
        r = this.forceBrowser ? await this.viaBrowser(url, boardUrl) : await this.viaFetch(url);
      } catch (e) {
        r = { status: 0, json: null, error: e.message };
      }
      if (r.status === 200 && r.json?.data) return r.json;
      if (r.status === 404) throw new Error(`Board not found / not public (404): ${url}`);
      if (r.status === 401 || r.status === 403) {
        if (!this.forceBrowser) { log(`[superscale] ${r.status} on plain fetch, switching to browser`); this.forceBrowser = true; continue; }
        throw new Error(`Board requires login or is blocked (${r.status}): ${url}`);
      }
      if (r.status === 200 && !this.forceBrowser) { log("[superscale] non-JSON answer (bot challenge?), switching to browser"); this.forceBrowser = true; continue; }
      const backoff = (r.status === 429 ? 15_000 : 4_000) * (attempt + 1);
      log(`[superscale] HTTP ${r.status || r.error} for ${url}, retry in ${backoff / 1000}s`);
      await sleep(backoff);
    }
    throw new Error(`Giving up on ${url}`);
  }

  async close() {
    if (this.browser) await this.browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Fetching a board
// ---------------------------------------------------------------------------
async function fetchAll(client, board, filters, maxPages) {
  const ads = [];
  const seen = new Set();
  let meta = null;
  for (let page = 1; page <= maxPages; page++) {
    const j = await client.get(apiUrl(board, { page, filters }), board.url);
    meta ??= j.data.board;
    const batch = Array.isArray(j.data.ads) ? j.data.ads : [];
    let fresh = 0;
    for (const a of batch) if (a?.uuid && !seen.has(a.uuid)) { seen.add(a.uuid); ads.push(a); fresh++; }
    if (!batch.length || !fresh) break;
    if (!filters && meta?.itemCount && ads.length >= meta.itemCount) break;
    if (batch.length < 40) break; // Superscale pages are 40 ads
  }
  return { board: meta, ads };
}

async function collectCategories(client, board, maxPages) {
  const industries = new Map(); // uuid -> Set(value)
  const funnel = new Map(); // uuid -> value
  for (const ind of INDUSTRIES) {
    const { ads } = await fetchAll(client, board, { industries: [ind.value] }, maxPages);
    if (ads.length) log(`[superscale]   industry ${ind.value}: ${ads.length}`);
    for (const a of ads) {
      if (!industries.has(a.uuid)) industries.set(a.uuid, new Set());
      industries.get(a.uuid).add(ind.value);
    }
  }
  for (const st of FUNNEL_STAGES) {
    const { ads } = await fetchAll(client, board, { funnelStage: st.value }, maxPages);
    if (ads.length) log(`[superscale]   funnel ${st.value}: ${ads.length}`);
    for (const a of ads) funnel.set(a.uuid, st.value);
  }
  return { industries, funnel };
}

// ---------------------------------------------------------------------------
// Mapping -> Ad
// ---------------------------------------------------------------------------
const clean = (s) => (typeof s === "string" ? s.replace(/\s+\n/g, "\n").trim() || undefined : undefined);

function captionToUrl(caption) {
  const c = clean(caption)?.toLowerCase();
  if (!c) return undefined;
  if (/^https?:\/\//.test(c)) return c;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(c)) return `https://${c}`;
  return undefined;
}

function marketFrom(countryCodes, override) {
  if (override) return override;
  const cc = Array.isArray(countryCodes) ? countryCodes.map((c) => String(c).toUpperCase()) : [];
  if (cc.includes("TR")) return "TR";
  if (cc.includes("US")) return "US";
  return "GLOBAL"; // Superscale only knows targeting countries for EU-transparency ads; never guess.
}

function pickVertical(values) {
  const list = [...values];
  const specific = list.find((v) => !GENERIC_INDUSTRIES.has(v));
  return slug(specific ?? list[0]);
}

function segmentFrom(values, override) {
  if (override) return override;
  if ([...values].some((v) => v === "E_COMMERCE_DTC" || ECOM_VALUES.has(v))) return "dtc";
  return "general";
}

export function toAd(raw, ctx) {
  const { board, cats, collectedAt, market: marketOverride, segment: segmentOverride } = ctx;
  const nativeId = String(raw.adId ?? "").trim();
  const isMetaId = /^\d{6,20}$/.test(nativeId);
  const industries = cats?.industries.get(raw.uuid) ?? new Set();
  const funnelStage = cats?.funnel.get(raw.uuid);
  const platforms = Array.isArray(raw.platforms) ? raw.platforms.map((p) => String(p).toLowerCase()) : undefined;
  const startedAt = raw.deliveryStartTime ? new Date(raw.deliveryStartTime).toISOString() : undefined;
  const isActive = typeof raw.isActive === "boolean" ? raw.isActive : undefined;
  // Superscale gives no stop date: running days are only known for ads that are still live.
  const activeDays = isActive ? daysBetween(startedAt, collectedAt) : undefined;
  const cardCount = raw.creative?.cardCount;
  const format = cardCount > 1 ? "carousel" : raw.mediaType === "VIDEO" ? "video" : raw.mediaType === "IMAGE" ? "image" : "text";
  const m = raw.metrics ?? {};

  const perf = computeScore({ activeDays, isActive, platforms, source: isMetaId ? "meta" : "curated" });
  if (typeof m.performanceScore === "number") perf.reasons.push(`Superscale skoru ${m.performanceScore}/100`);

  const tags = [
    "superscale",
    `board:${board.handle}/${board.slug}`,
    ...[...industries].map((v) => `industry:${slug(v)}`),
    ...(funnelStage ? [`funnel:${funnelStage.toLowerCase()}`] : []),
  ];

  return compact({
    id: isMetaId ? `meta_${nativeId}` : `curated_superscale-${raw.uuid}`,
    source: isMetaId ? "meta" : "curated",
    segment: segmentFrom(industries, segmentOverride),
    market: marketFrom(raw.targeting?.countryCodes, marketOverride),
    vertical: industries.size ? pickVertical(industries) : undefined,
    tags,
    brand: {
      name: clean(raw.advertiserBrandName) ?? "Unknown",
      website: captionToUrl(raw.creative?.caption),
    },
    format,
    // Superscale media URLs are signed (expire in hours) copies on their CDN: not stored.
    // Creatives come from the Meta enrichment overlay keyed by `meta_<id>`.
    media: [],
    headline: clean(raw.creative?.title),
    body: clean(raw.creative?.body),
    landingUrl: captionToUrl(raw.creative?.caption),
    platforms,
    startedAt,
    isActive,
    activeDays,
    performance: perf,
    libraryUrl: isMetaId ? `https://www.facebook.com/ads/library/?id=${nativeId}` : board.url,
    collectedAt,
    superscale: {
      uuid: raw.uuid,
      board: board.url,
      advertiserBrandUuid: raw.advertiserBrandUuid,
      industries: [...industries],
      funnelStage,
      mediaType: raw.mediaType,
      mediaWidth: raw.mediaWidth,
      mediaHeight: raw.mediaHeight,
      performanceScore: m.performanceScore,
      performanceStars: m.performanceStars,
      reach: m.reach ?? undefined,
      growth7d: m.growth7d ?? undefined,
      countryCodes: raw.targeting?.countryCodes ?? undefined,
    },
  });
}

function mergeInto(existing, incoming) {
  const prev = existing.get(incoming.id);
  if (!prev) { existing.set(incoming.id, incoming); return; }
  const tags = [...new Set([...(prev.tags ?? []), ...(incoming.tags ?? [])])];
  const industries = [...new Set([...(prev.superscale?.industries ?? []), ...(incoming.superscale?.industries ?? [])])];
  existing.set(incoming.id, { ...prev, ...incoming, tags, superscale: { ...prev.superscale, ...incoming.superscale, industries } });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, ["dry-run", "help", "no-categories", "replace", "browser", "verbose"]);
  if (args.help) {
    console.log("node scripts/ingest/superscale.mjs [board-url ...] [--out file] [--delay ms] [--max-pages N] [--no-categories] [--market TR|US|GLOBAL] [--segment dtc|hotel|general] [--replace] [--dry-run] [--browser]");
    return;
  }
  const boards = (args._.length ? args._ : [DEFAULT_BOARD]).map(parseBoardUrl);
  const out = resolve(ROOT, args.out || join(ADS_DIR, "superscale.json"));
  const delay = Math.max(500, Number(args.delay) || 1500);
  const maxPages = Math.max(1, Number(args["max-pages"]) || 20);
  const client = new Client({ delay, browser: Boolean(args.browser) });
  const collectedAt = new Date().toISOString();

  const prevFile = args.replace ? null : await readJson(out, null);
  const byId = new Map((prevFile?.ads ?? []).map((a) => [a.id, a]));
  const boardsMeta = { ...(prevFile?.boards ?? {}) };

  try {
    for (const board of boards) {
      log(`[superscale] board ${board.url}`);
      const { board: meta, ads } = await fetchAll(client, board, undefined, maxPages);
      if (meta?.visibility && meta.visibility !== "PUBLIC") throw new Error(`Board is ${meta.visibility}, not importing`);
      log(`[superscale]   "${meta?.name}" ${ads.length}/${meta?.itemCount ?? "?"} ads`);
      const cats = args["no-categories"] ? null : await collectCategories(client, board, maxPages);
      for (const raw of ads) {
        mergeInto(byId, toAd(raw, { board: { ...board }, cats, collectedAt, market: args.market, segment: args.segment }));
      }
      boardsMeta[board.url] = compact({
        handle: board.handle,
        slug: board.slug,
        name: meta?.name,
        description: meta?.description,
        itemCount: meta?.itemCount,
        imported: ads.length,
        updatedAt: meta?.updatedAt,
        fetchedAt: collectedAt,
      });
    }
  } finally {
    await client.close();
  }

  const ads = [...byId.values()].sort((a, b) => (b.performance?.score ?? 0) - (a.performance?.score ?? 0) || a.id.localeCompare(b.id));
  const doc = {
    generatedAt: collectedAt,
    source: "superscale.ai public boards (metadata only; media via Meta enrichment)",
    boards: boardsMeta,
    ads,
  };
  log(`[superscale] ${ads.length} ads (${ads.filter((a) => a.source === "meta").length} with Meta library id), ${client.requests} requests`);
  if (args["dry-run"]) { console.log(JSON.stringify(doc, null, 2)); return doc; }
  await writeJsonAtomic(out, doc);
  log(`[superscale] wrote ${out}`);
  return doc;
}

if (isMain(import.meta.url)) {
  run().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
