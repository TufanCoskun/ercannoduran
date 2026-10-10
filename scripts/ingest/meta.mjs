#!/usr/bin/env node
// Meta Ad Library ingestion -> data/ads/meta-tr.json, data/ads/meta-us.json
//
//   META_AD_LIBRARY_TOKEN=... node scripts/ingest/meta.mjs [--dry-run] [--market TR|US]
//                                     [--brand "Mavi"] [--limit-per-brand 50] [--no-filter]
//
// Uses the official Graph API endpoint https://graph.facebook.com/v21.0/ads_archive.
// IMPORTANT LIMITATION: for commercial (non-political) ads the official API only returns ads
// that were delivered to the EU/UK (DSA transparency) unless your app has extra approval.
// Requests for TR/US commercial ads therefore usually come back empty or with a permission
// error. This script handles that gracefully and explains it. See docs/INGESTION.md.
//
// The output files are also hand-edited by other people/agents, so this script MERGES:
// existing records are kept, duplicates (same id) are merged keeping the richer record.
import { resolve } from "node:path";
import { ADS_DIR, fetchJson, isMain, loadBrands, log, parseArgs, readJson, sleep, writeJsonAtomic } from "./io.mjs";
import { collapseMetaVariations, fromMetaArchive, mergeAds } from "./normalize.mjs";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v21.0";
const ENDPOINT = `https://graph.facebook.com/${GRAPH_VERSION}/ads_archive`;
const FIELDS = [
  "id", "ad_creation_time", "ad_delivery_start_time", "ad_delivery_stop_time",
  "ad_creative_bodies", "ad_creative_link_titles", "ad_creative_link_captions",
  "ad_creative_link_descriptions", "ad_snapshot_url", "page_id", "page_name",
  "publisher_platforms", "languages",
].join(",");
const MARKETS = { TR: "meta-tr.json", US: "meta-us.json" };
const PAGE_SIZE = 100;
const REQUEST_GAP_MS = 400;

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80004]);
const AUTH_CODES = new Set([102, 190, 463, 467]);

class FatalApiError extends Error {}

function explainError(err = {}) {
  const { code, error_subcode: sub, message = "" } = err;
  if (AUTH_CODES.has(code)) return "Token geçersiz/süresi dolmuş. developers.facebook.com üzerinden yeni bir token alın.";
  if (code === 10 || code === 200 || /permission|not authorized|ID confirmation|identity/i.test(message) || sub === 2332002 || sub === 2332004)
    return "Uygulamanın Ad Library API izni yok ya da kimlik doğrulaması tamamlanmamış (facebook.com/ID). " +
      "Ayrıca ticari reklamlar resmi API'de yalnızca AB/BK'ya ulaşanlar için döner; TR/US ticari reklamlar için ek onay gerekir.";
  if (code === 100 && /ad_type|ad_reached_countries|country/i.test(message))
    return "API bu ülke/ad_type kombinasyonunu reddetti: ticari (ALL) reklamlar yalnızca AB/BK erişimi için sorgulanabilir.";
  return message || "Bilinmeyen Graph API hatası";
}

async function graphGet(params, token, attempt = 0) {
  const url = `${ENDPOINT}?${new URLSearchParams({ ...params, access_token: token })}`;
  return graphGetUrl(url, attempt);
}

async function graphGetUrl(url, attempt = 0) {
  const res = await fetchJson(url);
  if (res.ok && res.json && !res.json.error) return res.json;
  const err = res.json?.error || { message: `HTTP ${res.status}: ${res.text.slice(0, 200)}` };
  if (RATE_LIMIT_CODES.has(err.code) && attempt < 2) {
    log(`  ! rate limit (code ${err.code}); 60 sn bekleniyor...`);
    await sleep(60_000);
    return graphGetUrl(url, attempt + 1);
  }
  const e = new FatalApiError(`[Graph ${err.code ?? res.status}${err.error_subcode ? "/" + err.error_subcode : ""}] ${explainError(err)}`);
  e.graph = err;
  throw e;
}

const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/** search_terms matches creative text, not advertiser — keep only ads whose page looks like the brand. */
function pageMatchesBrand(pageName, brand) {
  const p = norm(pageName);
  if (!p) return false;
  return [brand.name, ...(brand.searchTerms || [])].map(norm).filter((t) => t.length >= 3).some((t) => p.includes(t) || t.includes(p));
}

async function fetchBrand(brand, market, token, { limitPerBrand, noFilter }) {
  const base = {
    ad_reached_countries: JSON.stringify([market]),
    ad_active_status: "ACTIVE",
    ad_type: "ALL",
    fields: FIELDS,
    limit: String(Math.min(PAGE_SIZE, limitPerBrand)),
  };
  const queries = brand.metaPageId
    ? [{ ...base, search_page_ids: JSON.stringify([String(brand.metaPageId)]) }]
    : (brand.searchTerms?.length ? brand.searchTerms : [brand.name]).slice(0, 2).map((t) => ({ ...base, search_terms: t }));

  const raw = [];
  for (const q of queries) {
    let page = await graphGet(q, token);
    while (page) {
      for (const ad of page.data || []) {
        if (brand.metaPageId || noFilter || pageMatchesBrand(ad.page_name, brand)) raw.push(ad);
      }
      if (raw.length >= limitPerBrand || !page.paging?.next) break;
      await sleep(REQUEST_GAP_MS);
      page = await graphGetUrl(page.paging.next);
    }
    if (raw.length >= limitPerBrand) break;
    await sleep(REQUEST_GAP_MS);
  }
  const seen = new Set();
  return raw.filter((a) => (seen.has(a.id) ? false : seen.add(a.id))).slice(0, limitPerBrand);
}

/**
 * @returns {Promise<{source:string,status:"ok"|"skipped"|"error",message?:string,markets:object}>}
 */
export async function run(opts = {}) {
  const args = { ...opts };
  const dryRun = Boolean(args["dry-run"] ?? args.dryRun);
  const token = process.env.META_AD_LIBRARY_TOKEN;
  const markets = args.market ? [String(args.market).toUpperCase()] : Object.keys(MARKETS);
  const limitPerBrand = Number(args["limit-per-brand"] || 50);
  const noFilter = Boolean(args["no-filter"]);
  const summary = { source: "meta", status: "ok", markets: {} };

  if (!token) {
    summary.status = "skipped";
    summary.message = "META_AD_LIBRARY_TOKEN tanımlı değil — Meta atlandı. Token almak için docs/INGESTION.md'ye bakın.";
    log(`[meta] ${summary.message}`);
    return summary;
  }
  for (const m of markets) if (!MARKETS[m]) throw new Error(`Bilinmeyen market: ${m} (TR veya US)`);

  const brands = (await loadBrands()).filter((b) => !args.brand || norm(b.name) === norm(args.brand));
  const collectedAt = new Date().toISOString();

  for (const market of markets) {
    const file = resolve(ADS_DIR, MARKETS[market]);
    const targets = brands.filter((b) => b.market === market || b.market === "GLOBAL");
    const stat = { brands: targets.length, fetched: 0, ads: 0, added: 0, updated: 0, errors: 0, file };
    summary.markets[market] = stat;
    log(`[meta] ${market}: ${targets.length} marka sorgulanıyor (ad_reached_countries=["${market}"], ACTIVE)...`);

    const incoming = [];
    for (const brand of targets) {
      try {
        const raw = await fetchBrand(brand, market, token, { limitPerBrand, noFilter });
        stat.fetched += raw.length;
        for (const { raw: r, variations } of collapseMetaVariations(raw)) {
          incoming.push(fromMetaArchive(r, { brand, market, collectedAt, variations }));
        }
        if (args.verbose) log(`  - ${brand.name}: ${raw.length} reklam`);
      } catch (err) {
        stat.errors++;
        log(`  ! ${brand.name}: ${err.message}`);
        // Auth/permission problems will repeat for every brand — stop early instead of hammering the API.
        if (err.graph && (AUTH_CODES.has(err.graph.code) || err.graph.code === 10 || err.graph.code === 200 || err.graph.code === 100)) {
          summary.status = "error";
          summary.message = err.message;
          break;
        }
      }
      await sleep(REQUEST_GAP_MS);
    }

    if (stat.fetched === 0 && stat.errors === 0) {
      log(`[meta] ${market}: 0 sonuç. Bu genellikle beklenen durumdur: resmi API ticari reklamları yalnızca AB/BK erişimi için döndürür.`);
    }

    // Read the existing file as late as possible: other people edit it by hand.
    const existing = await readJson(file, { ads: [] });
    const { ads, added, updated } = mergeAds(existing?.ads || [], incoming);
    Object.assign(stat, { ads: ads.length, added, updated });
    const out = { generatedAt: collectedAt, ads };

    if (dryRun) {
      process.stdout.write(JSON.stringify({ file: MARKETS[market], incoming: incoming.length, ...out }, null, 2) + "\n");
    } else if (incoming.length > 0) {
      await writeJsonAtomic(file, out);
      log(`[meta] ${market}: ${MARKETS[market]} yazıldı (${added} yeni, ${updated} güncellendi, toplam ${ads.length}).`);
    } else {
      log(`[meta] ${market}: yeni veri yok, ${MARKETS[market]} değiştirilmedi.`);
    }
    if (summary.status === "error") break;
  }
  return summary;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), ["dry-run", "help", "verbose", "no-filter"]);
  if (args.help) {
    console.log("Kullanım: META_AD_LIBRARY_TOKEN=... node scripts/ingest/meta.mjs [--dry-run] [--market TR|US] [--brand NAME] [--limit-per-brand N] [--no-filter] [--verbose]");
    process.exit(0);
  }
  run(args)
    .then((s) => { if (s.status === "error") process.exitCode = 1; })
    .catch((e) => { log(`[meta] HATA: ${e.message}`); process.exitCode = 1; });
}
