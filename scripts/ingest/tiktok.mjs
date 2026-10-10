#!/usr/bin/env node
// TikTok ingestion -> data/ads/tiktok.json (merged, deduped by id).
//
// Three input modes (combine freely in one run):
//
// 1) TikTok Commercial Content API (official, needs approved Research/CCA app)
//      TIKTOK_CLIENT_KEY=... TIKTOK_CLIENT_SECRET=... node scripts/ingest/tiktok.mjs
//    Coverage: ads shown in the EU/EEA (+CH/UK) only -> market "GLOBAL".
//    Options: --country ALL|FR|DE|...  (env TIKTOK_CCA_COUNTRY, default ALL)
//             --days 90                (published date window)
//             --brand "Gymshark"       (single brand from data/brands.json)
//
// 2) Creative Center "Top Ads" export (TR / US / global top ads)
//      node scripts/ingest/tiktok.mjs --import ~/Downloads/topads-tr.json --market TR
//    The file is the JSON response of the Top Ads list that YOU saved from your own browser
//    while logged in to ads.tiktok.com/business/creativecenter (DevTools > Network >
//    "top_ads/v2/list" > Save response). Accepts {data:{materials}}, {materials} or an array.
//    Several files: --import a.json,b.json. Order in the file = rank.
//
// 3) Hand-picked TikTok video URLs (verified through TikTok's public oEmbed endpoint)
//      node scripts/ingest/tiktok.mjs --urls my-tiktok-ads.csv
//    One per line: url[,market[,segment[,brand]]]   e.g.
//      https://www.tiktok.com/@brand/video/7300000000000000000,TR,dtc,Mavi
//    Only rows whose URL oEmbed confirms are written.
//
// --dry-run prints the merged result to stdout instead of writing.
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ADS_DIR, fetchJson, isMain, loadBrands, log, parseArgs, readJson, sleep, writeJsonAtomic } from "./io.mjs";
import { adId, compact, fromTikTokCommercial, fromTikTokTopAds, matchBrand, mergeAds } from "./normalize.mjs";
import { computeScore } from "./score.mjs";

const OUT_FILE = resolve(ADS_DIR, "tiktok.json");
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const QUERY_URL = "https://open.tiktokapis.com/v2/research/adlib/ad/query/";
const QUERY_FIELDS = [
  "ad.id", "ad.first_shown_date", "ad.last_shown_date", "ad.status", "ad.videos",
  "ad.image_urls", "ad.reach", "advertiser.business_id", "advertiser.business_name",
].join(",");
const MARKETS = new Set(["TR", "US", "GLOBAL"]);
const SEGMENTS = new Set(["dtc", "hotel", "general"]);

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

// ---------------------------------------------------------------------------
// 1) Commercial Content API
// ---------------------------------------------------------------------------
async function getClientToken(key, secret) {
  const res = await fetchJson(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({ client_key: key, client_secret: secret, grant_type: "client_credentials" }),
  });
  if (!res.ok || !res.json?.access_token) {
    const j = res.json || {};
    throw new Error(`TikTok OAuth başarısız (${res.status}): ${j.error || ""} ${j.error_description || res.text.slice(0, 160)}`.trim());
  }
  return res.json.access_token;
}

async function queryCommercial(token, { searchTerm, country, days, maxPerBrand }) {
  const max = new Date();
  const min = new Date(Date.now() - days * 86_400_000);
  const out = [];
  let searchId;
  for (let page = 0; page < 10 && out.length < maxPerBrand; page++) {
    const body = {
      filters: { ad_published_date_range: { min: ymd(min), max: ymd(max) }, country_code: country },
      search_term: searchTerm.slice(0, 50),
      max_count: Math.min(50, maxPerBrand - out.length),
      ...(searchId ? { search_id: searchId } : {}),
    };
    const res = await fetchJson(`${QUERY_URL}?fields=${QUERY_FIELDS}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const err = res.json?.error;
    if (!res.ok || (err && err.code && err.code !== "ok")) {
      const e = new Error(`[CCA ${res.status}] ${err?.code || ""}: ${err?.message || res.text.slice(0, 200)}`);
      e.fatal = res.status === 401 || res.status === 403 || /scope|permission|access_token|unauthorized/i.test(err?.code || err?.message || "");
      throw e;
    }
    const data = res.json?.data || {};
    out.push(...(data.ads || []));
    if (!data.has_more || !data.search_id) break;
    searchId = data.search_id;
    await sleep(500);
  }
  return out;
}

async function runCommercial(brands, args, collectedAt) {
  const key = process.env.TIKTOK_CLIENT_KEY;
  const secret = process.env.TIKTOK_CLIENT_SECRET;
  if (!key || !secret) return { status: "skipped", message: "TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET yok — Commercial Content API atlandı.", ads: [] };

  const country = String(args.country || process.env.TIKTOK_CCA_COUNTRY || "ALL").toUpperCase();
  const days = Number(args.days || 90);
  const maxPerBrand = Number(args["limit-per-brand"] || 30);
  const noFilter = Boolean(args["no-filter"]);
  const token = await getClientToken(key, secret);
  const targets = brands.filter((b) => !args.brand || norm(b.name) === norm(args.brand));
  log(`[tiktok] Commercial Content API: ${targets.length} marka, country_code=${country}, son ${days} gün...`);

  const ads = [];
  let errors = 0;
  for (const brand of targets) {
    try {
      const items = await queryCommercial(token, { searchTerm: brand.name, country, days, maxPerBrand });
      const mine = items.filter((it) => noFilter || matchBrand([brand], { name: it.advertiser?.business_name }) ||
        norm(it.advertiser?.business_name).includes(norm(brand.name)));
      for (const it of mine) ads.push(fromTikTokCommercial(it, { brands, brandHint: brand, market: "GLOBAL", collectedAt }));
      if (args.verbose) log(`  - ${brand.name}: ${mine.length}/${items.length}`);
    } catch (e) {
      errors++;
      log(`  ! ${brand.name}: ${e.message}`);
      if (e.fatal) return { status: "error", message: e.message, ads };
    }
    await sleep(400);
  }
  return { status: errors && !ads.length ? "error" : "ok", ads, message: `${ads.length} reklam (AB kapsamı)` };
}

// ---------------------------------------------------------------------------
// 2) Creative Center Top Ads export (user-saved JSON)
// ---------------------------------------------------------------------------
async function expandPaths(list) {
  const files = [];
  for (const p of String(list).split(",").map((s) => s.trim()).filter(Boolean)) {
    const abs = resolve(p);
    const st = await stat(abs);
    if (st.isDirectory()) {
      for (const f of (await readdir(abs)).sort()) if (f.endsWith(".json")) files.push(join(abs, f));
    } else files.push(abs);
  }
  return files;
}

function materialsOf(json) {
  if (Array.isArray(json)) return json;
  return json?.data?.materials || json?.materials || json?.data?.list || [];
}

async function runImport(brands, args, collectedAt) {
  if (!args.import) return { status: "skipped", ads: [] };
  const market = String(args.market || "GLOBAL").toUpperCase();
  if (!MARKETS.has(market)) throw new Error(`--market TR|US|GLOBAL olmalı (verilen: ${market})`);
  const ads = [];
  for (const file of await expandPaths(args.import)) {
    const json = JSON.parse(await readFile(file, "utf8"));
    if (json && json.code !== undefined && json.code !== 0) {
      log(`  ! ${file}: yanıt hata içeriyor (code=${json.code}, msg=${json.msg}) — atlandı.`);
      continue;
    }
    const mats = materialsOf(json);
    mats.forEach((m, i) => { if (m?.id) ads.push(fromTikTokTopAds(m, { market, rank: i + 1, brands, collectedAt })); });
    log(`[tiktok] import ${file}: ${mats.length} materyal (${market}).`);
  }
  return { status: "ok", ads, message: `${ads.length} Top Ads kaydı içe aktarıldı` };
}

// ---------------------------------------------------------------------------
// 3) URL list verified via oEmbed
// ---------------------------------------------------------------------------
async function oembed(url) {
  const res = await fetchJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
  return res.ok ? res.json : null;
}

async function runUrls(brands, args, collectedAt) {
  if (!args.urls) return { status: "skipped", ads: [] };
  const lines = (await readFile(resolve(args.urls), "utf8")).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const ads = [];
  for (const line of lines) {
    const [url, mk = "GLOBAL", seg, brandName] = line.split(",").map((s) => s.trim());
    const vid = url.match(/\/video\/(\d+)/)?.[1];
    if (!vid) { log(`  ! video id yok: ${url}`); continue; }
    const meta = await oembed(url);
    if (!meta) { log(`  ! oEmbed doğrulanamadı, atlandı: ${url}`); continue; }
    const handle = (meta.author_unique_id || meta.author_url?.split("@")[1] || "").replace(/\/.*$/, "");
    const brand = matchBrand(brands, { name: brandName || meta.author_name, handle });
    const market = MARKETS.has(mk.toUpperCase()) ? mk.toUpperCase() : "GLOBAL";
    ads.push(compact({
      id: adId("tiktok", vid),
      source: "tiktok",
      segment: SEGMENTS.has(seg) ? seg : brand?.segment || "general",
      market,
      vertical: brand?.vertical,
      brand: { name: brand?.name || brandName || meta.author_name, handle: handle ? `@${handle}` : undefined, website: brand?.website },
      format: "video",
      media: meta.thumbnail_url ? [{ type: "image", url: meta.thumbnail_url }] : [],
      body: meta.title || undefined,
      platforms: ["tiktok"],
      performance: computeScore({ source: "tiktok", platforms: ["tiktok"] }),
      libraryUrl: url.split("?")[0],
      collectedAt,
    }));
    await sleep(300);
  }
  return { status: "ok", ads, message: `${ads.length}/${lines.length} URL doğrulandı` };
}

// ---------------------------------------------------------------------------
export async function run(opts = {}) {
  const args = { ...opts };
  const dryRun = Boolean(args["dry-run"] ?? args.dryRun);
  const brands = await loadBrands();
  const collectedAt = new Date().toISOString();
  const summary = { source: "tiktok", status: "ok", parts: {} };

  const parts = [
    ["commercial", runCommercial],
    ["import", runImport],
    ["urls", runUrls],
  ];
  const incoming = [];
  for (const [name, fn] of parts) {
    try {
      const r = await fn(brands, args, collectedAt);
      summary.parts[name] = { status: r.status, count: r.ads.length, message: r.message };
      if (r.status === "skipped" && r.message) log(`[tiktok] ${r.message}`);
      incoming.push(...r.ads);
    } catch (e) {
      summary.parts[name] = { status: "error", count: 0, message: e.message };
      log(`[tiktok] ${name} HATA: ${e.message}`);
    }
  }

  const active = Object.values(summary.parts).filter((p) => p.status !== "skipped");
  if (!active.length) {
    summary.status = "skipped";
    summary.message =
      "TikTok kaynağı atlandı: TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET yok ve --import/--urls verilmedi. " +
      "Creative Center Top Ads verisi için docs/INGESTION.md > TikTok bölümüne bakın.";
    log(`[tiktok] ${summary.message}`);
    return summary;
  }
  if (active.every((p) => p.status === "error")) summary.status = "error";

  const existing = await readJson(OUT_FILE, { ads: [] });
  const { ads, added, updated } = mergeAds(existing?.ads || [], incoming);
  Object.assign(summary, { incoming: incoming.length, total: ads.length, added, updated, file: OUT_FILE });
  const out = { generatedAt: collectedAt, ads };

  if (dryRun) process.stdout.write(JSON.stringify({ file: "tiktok.json", incoming: incoming.length, ...out }, null, 2) + "\n");
  else if (incoming.length) {
    await writeJsonAtomic(OUT_FILE, out);
    log(`[tiktok] tiktok.json yazıldı (${added} yeni, ${updated} güncellendi, toplam ${ads.length}).`);
  } else log("[tiktok] yeni veri yok, tiktok.json değiştirilmedi.");
  return summary;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), ["dry-run", "help", "verbose", "no-filter"]);
  if (args.help) {
    console.log("Kullanım: node scripts/ingest/tiktok.mjs [--dry-run] [--import FILE[,FILE] --market TR|US|GLOBAL] [--urls FILE] [--country ALL] [--days 90] [--brand NAME]");
    process.exit(0);
  }
  run(args)
    .then((s) => { if (s.status === "error") process.exitCode = 1; })
    .catch((e) => { log(`[tiktok] HATA: ${e.message}`); process.exitCode = 1; });
}
