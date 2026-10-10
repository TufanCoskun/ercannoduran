// Normalizers: raw source payloads -> SPEC `Ad` objects (see docs/SPEC.md, src/lib/types.ts).
// Also: dedupe/merge helpers shared by every source script.
import { scoreAd } from "./score.mjs";

const DAY = 86_400_000;

export const adId = (source, nativeId) => `${source}_${String(nativeId)}`;

export function toIsoDate(v) {
  if (v === undefined || v === null || v === "") return undefined;
  // TikTok Commercial Content API uses YYYYMMDD integers.
  if (/^\d{8}$/.test(String(v))) {
    const s = String(v);
    return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`).toISOString();
  }
  // Unix seconds.
  if (typeof v === "number" || /^\d{9,11}$/.test(String(v))) return new Date(Number(v) * 1000).toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function daysBetween(fromIso, toIso) {
  if (!fromIso) return undefined;
  const a = new Date(fromIso).getTime();
  const b = toIso ? new Date(toIso).getTime() : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return Math.max(0, Math.floor((b - a) / DAY));
}

const first = (arr) => (Array.isArray(arr) && arr.length ? String(arr[0]).trim() || undefined : undefined);
const clean = (s) => (typeof s === "string" ? s.replace(/\s+\n/g, "\n").trim() || undefined : undefined);

/** "1M-10M" | "10K" | 12345 -> lower bound as number */
export function parseReach(v) {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number") return v;
  const m = String(v).trim().match(/^([\d.]+)\s*([KMB])?/i);
  if (!m) return undefined;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] || 1;
  return Math.round(parseFloat(m[1]) * mult);
}

/** Meta link captions are usually display domains ("MAVI.COM"). Turn into a URL when it looks like one. */
function captionToUrl(caption) {
  if (!caption) return undefined;
  const c = caption.trim().toLowerCase();
  if (/^https?:\/\//.test(c)) return c;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(c)) return `https://${c}`;
  return undefined;
}

/** Remove undefined keys so JSON stays compact. */
export function compact(obj) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined) delete obj[k];
    else if (v && typeof v === "object" && !Array.isArray(v)) compact(v);
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Meta Graph API `ads_archive`
// ---------------------------------------------------------------------------

/**
 * @param {object} raw   one element of ads_archive `data[]`
 * @param {object} ctx   { brand (brands.json entry), market, collectedAt, variations }
 */
export function fromMetaArchive(raw, ctx) {
  const { brand = {}, market, collectedAt = new Date().toISOString(), variations } = ctx;
  const startedAt = toIsoDate(raw.ad_delivery_start_time || raw.ad_creation_time);
  const endedAt = toIsoDate(raw.ad_delivery_stop_time) ?? null;
  const isActive = !endedAt || new Date(endedAt).getTime() > Date.now();
  const activeDays = daysBetween(startedAt, isActive ? collectedAt : endedAt);
  const platforms = Array.isArray(raw.publisher_platforms)
    ? raw.publisher_platforms.map((p) => String(p).toLowerCase())
    : undefined;

  const ad = {
    id: adId("meta", raw.id),
    source: "meta",
    segment: brand.segment || "general",
    market,
    vertical: brand.vertical,
    brand: {
      name: raw.page_name || brand.name,
      pageId: raw.page_id ? String(raw.page_id) : brand.metaPageId,
      website: brand.website,
    },
    // ads_archive returns no creative media for commercial ads, only ad_snapshot_url
    // (an HTML render that needs a token). The UI shows a text card + "Ad Library'de aç".
    format: "text",
    media: [],
    headline: clean(first(raw.ad_creative_link_titles)),
    body: clean(first(raw.ad_creative_bodies)),
    landingUrl: captionToUrl(first(raw.ad_creative_link_captions)) || brand.website,
    platforms,
    languages: Array.isArray(raw.languages) ? raw.languages : undefined,
    startedAt,
    endedAt,
    isActive,
    activeDays,
    variations,
    performance: scoreAd({ activeDays, isActive, variations, platforms }),
    libraryUrl: `https://www.facebook.com/ads/library/?id=${raw.id}`,
    collectedAt,
  };
  if (!ad.headline && first(raw.ad_creative_link_descriptions)) ad.headline = clean(first(raw.ad_creative_link_descriptions));
  return compact(ad);
}

/** Group near-identical Meta ads (same page + same copy) into one record with `variations`. */
export function collapseMetaVariations(rawAds) {
  const groups = new Map();
  for (const r of rawAds) {
    const key = [
      r.page_id,
      (first(r.ad_creative_bodies) || "").toLowerCase().replace(/\s+/g, " ").slice(0, 280),
      (first(r.ad_creative_link_titles) || "").toLowerCase(),
    ].join("|");
    const g = groups.get(key);
    if (!g) groups.set(key, { rep: r, count: 1, platforms: new Set(r.publisher_platforms || []) });
    else {
      g.count++;
      for (const p of r.publisher_platforms || []) g.platforms.add(p);
      // representative = the longest-running ad of the group
      const a = Number(new Date(r.ad_delivery_start_time || 0));
      const b = Number(new Date(g.rep.ad_delivery_start_time || 0));
      if (a && (!b || a < b)) g.rep = r;
    }
  }
  return [...groups.values()].map((g) => ({
    raw: { ...g.rep, publisher_platforms: [...g.platforms] },
    variations: g.count,
  }));
}

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------

const HOTEL_RE = /\b(hotel|otel|resort|tatil|holiday|vacation|travel|seyahat|booking|flight|uçuş|ucus|airline|cruise|airbnb|konaklama)\b/i;
const DTC_OBJECTIVE_RE = /(conversion|product_sales|shop|catalog|web_conversions|app_install)/i;

/** Find the brands.json entry for a TikTok advertiser name / handle. */
export function matchBrand(brands, { name, handle } = {}) {
  const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
  const n = norm(name);
  const h = norm(handle);
  return brands.find((b) =>
    (h && norm(b.tiktokHandle) === h) ||
    (n && (norm(b.name) === n || (b.searchTerms || []).some((t) => norm(t) === n))),
  );
}

function inferSegment({ brand, text, objective }) {
  if (brand?.segment) return brand.segment;
  if (HOTEL_RE.test(text || "")) return "hotel";
  if (DTC_OBJECTIVE_RE.test(objective || "")) return "dtc";
  return "general";
}

/**
 * TikTok Creative Center "Top Ads" material (top_ads/v2/list `data.materials[]`), e.g. exported
 * by the user from their own browser session. See docs/INGESTION.md.
 * ctx: { market, rank, brands, collectedAt, periodDays }
 */
export function fromTikTokTopAds(m, ctx) {
  const { market = "GLOBAL", rank, brands = [], collectedAt = new Date().toISOString() } = ctx;
  const brandName = (m.brand_name || "").trim() || undefined;
  const brand = matchBrand(brands, { name: brandName });
  const vi = m.video_info || {};
  const urls = vi.video_url || {};
  const videoUrl = urls["720p"] || urls["1080p"] || urls["540p"] || urls["480p"] || urls["360p"] || Object.values(urls)[0];
  const media = videoUrl ? [{ type: "video", url: videoUrl, thumbnailUrl: vi.cover }] : vi.cover ? [{ type: "image", url: vi.cover }] : [];
  const likes = Number.isFinite(Number(m.like)) ? Number(m.like) : undefined;
  const ctr = Number.isFinite(Number(m.ctr)) ? Number(m.ctr) : undefined;
  const qs = new URLSearchParams({ countryCode: market === "GLOBAL" ? "" : market, from: "001010" });
  if (!qs.get("countryCode")) qs.delete("countryCode");

  return compact({
    id: adId("tiktok", m.id),
    source: "tiktok",
    segment: inferSegment({ brand, text: `${brandName || ""} ${m.ad_title || ""}`, objective: m.objective_key }),
    market,
    vertical: brand?.vertical,
    brand: {
      name: brand?.name || brandName || "TikTok advertiser",
      handle: brand?.tiktokHandle ? `@${brand.tiktokHandle}` : undefined,
      website: brand?.website,
    },
    format: media.length ? media[0].type : "text",
    media,
    body: clean(m.ad_title),
    landingUrl: m.landing_page || brand?.website,
    platforms: ["tiktok"],
    isActive: undefined,
    performance: scoreAd({ tiktokRank: rank, tiktokLikes: likes, tiktokCtr: ctr }),
    libraryUrl: `https://ads.tiktok.com/business/creativecenter/topads/${m.id}/pc/en?${qs}`,
    collectedAt,
  });
}

/**
 * TikTok Commercial Content API (`/v2/research/adlib/ad/query/`) item: { ad: {...}, advertiser: {...} }.
 * Coverage is EU/EEA (+ CH, UK) only, so market defaults to GLOBAL.
 * ctx: { brands, market, collectedAt }
 */
export function fromTikTokCommercial(item, ctx) {
  const { brands = [], market = "GLOBAL", collectedAt = new Date().toISOString(), brandHint } = ctx;
  const ad = item.ad || item;
  const adv = item.advertiser || {};
  const brand = brandHint || matchBrand(brands, { name: adv.business_name });
  const startedAt = toIsoDate(ad.first_shown_date);
  const lastShown = toIsoDate(ad.last_shown_date);
  const isActive = String(ad.status || "").toLowerCase() === "active";
  const activeDays = daysBetween(startedAt, isActive ? collectedAt : lastShown);
  const videos = Array.isArray(ad.videos) ? ad.videos : [];
  const images = Array.isArray(ad.image_urls) ? ad.image_urls : [];
  const media = [
    ...videos.filter((v) => v && v.url).map((v) => ({ type: "video", url: v.url, thumbnailUrl: v.cover_image_url })),
    ...images.map((u) => ({ type: "image", url: u })),
  ];
  const reach = parseReach(ad.reach?.unique_users_seen);
  return compact({
    id: adId("tiktok", ad.id),
    source: "tiktok",
    segment: inferSegment({ brand, text: adv.business_name }),
    market,
    vertical: brand?.vertical,
    brand: {
      name: brand?.name || adv.business_name || "TikTok advertiser",
      handle: brand?.tiktokHandle ? `@${brand.tiktokHandle}` : undefined,
      website: brand?.website,
    },
    format: videos.length ? "video" : images.length > 1 ? "carousel" : images.length ? "image" : "text",
    media,
    platforms: ["tiktok"],
    startedAt,
    endedAt: isActive ? null : lastShown ?? null,
    isActive,
    activeDays,
    performance: scoreAd({ activeDays, isActive, reach }),
    libraryUrl: `https://library.tiktok.com/ads/detail/?ad_id=${ad.id}`,
    collectedAt,
  });
}

// ---------------------------------------------------------------------------
// Merge / dedupe
// ---------------------------------------------------------------------------

/** Rough "how much useful content" measure, used to keep the richer of two records. */
export function richness(ad) {
  if (!ad) return -1;
  let n = 0;
  for (const k of ["headline", "body", "cta", "landingUrl", "startedAt", "activeDays", "variations", "vertical"]) {
    if (ad[k] !== undefined && ad[k] !== null && ad[k] !== "") n++;
  }
  n += (ad.media?.length || 0) * 3;
  n += ad.platforms?.length ? 1 : 0;
  n += ad.languages?.length ? 1 : 0;
  n += ad.brand?.logoUrl ? 1 : 0;
  n += (ad.body?.length || 0) > 40 ? 1 : 0;
  return n;
}

const FRESHNESS_KEYS = ["isActive", "endedAt", "activeDays", "variations", "performance", "collectedAt"];

/** Merge two records with the same id: richer one wins, gaps filled from the other, freshness from the newer. */
export function mergeAd(a, b) {
  if (!a) return b;
  if (!b) return a;
  const [rich, poor] = richness(b) > richness(a) ? [b, a] : [a, b];
  const out = { ...poor, ...Object.fromEntries(Object.entries(rich).filter(([, v]) => v !== undefined && v !== null && v !== "")) };
  out.brand = { ...(poor.brand || {}), ...(rich.brand || {}) };
  if (!(rich.media?.length) && poor.media?.length) { out.media = poor.media; out.format = poor.format; }
  const newer = new Date(b.collectedAt || 0) >= new Date(a.collectedAt || 0) ? b : a;
  for (const k of FRESHNESS_KEYS) if (newer[k] !== undefined) out[k] = newer[k];
  return out;
}

/** Dedupe by id across existing + incoming, sorted by score desc. Returns { ads, added, updated }. */
export function mergeAds(existing = [], incoming = []) {
  const byId = new Map();
  for (const ad of existing) if (ad?.id) byId.set(ad.id, mergeAd(byId.get(ad.id), ad));
  let added = 0, updated = 0;
  for (const ad of incoming) {
    if (!ad?.id) continue;
    if (byId.has(ad.id)) updated++; else added++;
    byId.set(ad.id, mergeAd(byId.get(ad.id), ad));
  }
  const ads = [...byId.values()].sort((x, y) => (y.performance?.score ?? 0) - (x.performance?.score ?? 0));
  return { ads, added, updated };
}
