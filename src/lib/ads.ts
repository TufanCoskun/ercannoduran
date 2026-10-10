import fs from "node:fs";
import path from "node:path";
import type { Ad, AdMedia, Format, Market, Segment, Source } from "./types";
import { runningDays, scoreAd } from "./score";
import { FIXTURE_ADS } from "./fixtures";
import { previewImage } from "./format";

/**
 * Server-only ad loader. Reads every `data/ads/*.json` (`{ generatedAt, ads: Ad[] }`,
 * a bare `Ad[]` is tolerated too), normalises/validates each ad, dedupes by `id`
 * and sorts by `performance.score` (desc). Missing / empty / malformed files are skipped.
 * Falls back to dev fixtures only when no file yields a single ad.
 */

export const DATA_DIR = path.join(process.cwd(), "data", "ads");
/** Optional enrichment overlays: `{ generatedAt, items: { [adId]: Partial<Ad> } }` (e.g. meta-media.json). */
export const MEDIA_DIR = path.join(process.cwd(), "data", "media");

export interface AdDataset {
  ads: Ad[];
  usingFixtures: boolean;
  generatedAt?: string; // newest generatedAt across files
  files: { name: string; count: number; error?: string }[];
}

const SOURCES: Source[] = ["meta", "tiktok", "curated"];
const SEGMENTS: Segment[] = ["dtc", "hotel", "general"];
const MARKETS: Market[] = ["TR", "US", "GLOBAL"];
const FORMATS: Format[] = ["video", "image", "carousel", "text"];

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined;
const strArr = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
  return out.length ? out : undefined;
};
const isUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//i.test(v.trim());
/** Media may also point at files we host ourselves under /public (e.g. /media/meta/<id>.jpg). */
const isMediaUrl = (v: unknown): v is string => isUrl(v) || (typeof v === "string" && /^\/[^/]/.test(v.trim()));
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => {
  if (typeof v !== "string") return fallback;
  const hit = allowed.find((a) => a.toLowerCase() === v.trim().toLowerCase());
  return hit ?? fallback;
};

function normalizeMedia(v: unknown): AdMedia[] {
  if (!Array.isArray(v)) return [];
  const out: AdMedia[] = [];
  for (const m of v) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    const url = isMediaUrl(r.url) ? r.url.trim() : undefined;
    const thumb = isMediaUrl(r.thumbnailUrl) ? r.thumbnailUrl.trim() : undefined;
    if (!url && !thumb) continue;
    const type = r.type === "video" ? "video" : "image";
    if (!url && thumb) {
      out.push({ type: "image", url: thumb });
      continue;
    }
    // An image's remote thumbnail is a smaller copy on the same expiring CDN — useless as a fallback,
    // and fbcdn URLs are ~1 KB each, so only keep thumbnails we host ourselves (or video posters).
    const keepThumb = thumb && thumb !== url && (type === "video" || thumb.startsWith("/"));
    out.push(keepThumb ? { type, url: url!, thumbnailUrl: thumb } : { type, url: url! });
  }
  return out;
}

function inferFormat(raw: unknown, media: AdMedia[]): Format {
  const declared = typeof raw === "string" ? FORMATS.find((f) => f === raw.toLowerCase()) : undefined;
  if (declared) return declared;
  if (media.some((m) => m.type === "video")) return "video";
  if (media.length > 1) return "carousel";
  if (media.length === 1) return "image";
  return "text";
}

export function normalizeAd(raw: unknown, fileGeneratedAt?: string): Ad | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id) ?? (typeof r.id === "number" ? String(r.id) : undefined);
  if (!id) return null;

  const brandRaw = r.brand;
  let brand: Ad["brand"] | undefined;
  if (typeof brandRaw === "string" && brandRaw.trim()) brand = { name: brandRaw.trim() };
  else if (brandRaw && typeof brandRaw === "object") {
    const b = brandRaw as Record<string, unknown>;
    const name = str(b.name);
    if (name) {
      brand = { name };
      const pageId = str(b.pageId) ?? (typeof b.pageId === "number" ? String(b.pageId) : undefined);
      if (pageId) brand.pageId = pageId;
      if (str(b.handle)) brand.handle = str(b.handle);
      if (isUrl(b.website)) brand.website = b.website;
      if (isUrl(b.logoUrl)) brand.logoUrl = b.logoUrl;
    }
  }
  if (!brand) return null;

  const prefix = id.split("_")[0];
  const source = pick(r.source, SOURCES, (SOURCES as string[]).includes(prefix) ? (prefix as Source) : "curated");
  const media = normalizeMedia(r.media);
  const headline = str(r.headline);
  const body = str(r.body);

  const collectedAt = str(r.collectedAt) ?? fileGeneratedAt ?? new Date(0).toISOString();
  const startedAt = str(r.startedAt);
  const endedAt = r.endedAt === null ? null : str(r.endedAt);
  const isActive = typeof r.isActive === "boolean" ? r.isActive : endedAt ? false : undefined;
  const activeDays = runningDays({ startedAt, endedAt, isActive, collectedAt, activeDays: num(r.activeDays) });
  const variations = num(r.variations);
  const platforms = strArr(r.platforms)?.map((p) => p.toLowerCase());

  const nativeId = id.includes("_") ? id.slice(id.indexOf("_") + 1) : id;
  const libraryUrl =
    (isUrl(r.libraryUrl) ? r.libraryUrl.trim() : undefined) ??
    (source === "meta" && /^\d+$/.test(nativeId)
      ? `https://www.facebook.com/ads/library/?id=${nativeId}`
      : source === "tiktok"
        ? "https://ads.tiktok.com/business/creativecenter/inspiration/topads/"
        : `https://www.facebook.com/ads/library/?q=${encodeURIComponent(brand.name)}`);

  const ad: Ad = {
    id,
    source,
    segment: pick(r.segment, SEGMENTS, "general"),
    market: pick(r.market, MARKETS, "GLOBAL"),
    brand,
    format: inferFormat(r.format, media),
    media,
    performance: { score: 0, reasons: [] },
    libraryUrl,
    collectedAt,
  };
  const vertical = str(r.vertical);
  if (vertical) ad.vertical = vertical.toLowerCase();
  if (headline) ad.headline = headline;
  if (body) ad.body = body;
  if (str(r.cta)) ad.cta = str(r.cta);
  if (isUrl(r.landingUrl)) ad.landingUrl = r.landingUrl.trim();
  if (platforms) ad.platforms = platforms;
  const languages = strArr(r.languages);
  if (languages) ad.languages = languages;
  if (startedAt) ad.startedAt = startedAt;
  if (endedAt !== undefined) ad.endedAt = endedAt;
  if (isActive !== undefined) ad.isActive = isActive;
  if (activeDays !== undefined) ad.activeDays = activeDays;
  if (variations !== undefined) ad.variations = variations;

  // Always recompute from the signals (canonical formula in ./score) so every ad is consistent,
  // whatever formula / reason texts the data file was written with. Stored reasons are only read
  // back for TikTok rank/CTR/likes, which have no dedicated fields in the schema.
  const perf = r.performance as Record<string, unknown> | undefined;
  ad.performance = scoreAd({ ...ad, performance: { reasons: strArr(perf?.reasons) ?? [] } });
  return ad;
}

function readFileSafe(file: string): { generatedAt?: string; items: unknown[]; error?: string } {
  try {
    const text = fs.readFileSync(file, "utf8");
    if (!text.trim()) return { items: [] };
    const json = JSON.parse(text) as unknown;
    if (Array.isArray(json)) return { items: json };
    if (json && typeof json === "object") {
      const o = json as Record<string, unknown>;
      return { generatedAt: str(o.generatedAt), items: Array.isArray(o.ads) ? o.ads : [] };
    }
    return { items: [] };
  } catch (e) {
    return { items: [], error: e instanceof Error ? e.message : String(e) };
  }
}

type OverlayItem = Record<string, unknown>;

const OVERLAY_FIELDS = ["media", "body", "headline", "cta", "landingUrl", "platforms", "variations", "format", "languages"] as const;

const nonEmpty = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim() !== "" : typeof v === "number" ? Number.isFinite(v) : v !== undefined && v !== null;

/** Reads every data/media/*.json overlay; later files win on conflicts. Missing dir/files are fine. */
function readOverlays(names: string[]): Map<string, OverlayItem> {
  const out = new Map<string, OverlayItem>();
  for (const name of names) {
    try {
      const json = JSON.parse(fs.readFileSync(path.join(MEDIA_DIR, name), "utf8")) as unknown;
      const items = json && typeof json === "object" ? (json as Record<string, unknown>).items : undefined;
      if (!items || typeof items !== "object" || Array.isArray(items)) continue;
      for (const [id, item] of Object.entries(items as Record<string, unknown>)) {
        if (item && typeof item === "object") out.set(id, { ...(out.get(id) ?? {}), ...(item as OverlayItem) });
      }
    } catch {
      /* malformed / partially written overlay — ignore */
    }
  }
  return out;
}

/** Overlay fields win when non-empty (variations / platforms are merged). Score is recomputed later anyway. */
function applyOverlay(raw: unknown, overlays: Map<string, OverlayItem>): unknown {
  if (!overlays.size || !raw || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  const ov = overlays.get(String(r.id));
  if (!ov) return raw;
  const next: Record<string, unknown> = { ...r };
  for (const f of OVERLAY_FIELDS) if (nonEmpty(ov[f])) next[f] = ov[f];

  if (nonEmpty(ov.media) && !nonEmpty(ov.format)) {
    // Re-infer the format from the new media, keeping a declared carousel only if it really has >1 item.
    const m = ov.media as unknown[];
    if (!(r.format === "carousel" && m.length > 1)) delete next.format;
  }
  // Scaling signals: both sources are lower bounds, so keep the strongest evidence.
  const ovVar = num(ov.variations);
  const rawVar = num(r.variations);
  if (ovVar !== undefined || rawVar !== undefined) next.variations = Math.max(ovVar ?? 0, rawVar ?? 0);
  const ovPlat = strArr(ov.platforms);
  const rawPlat = strArr(r.platforms);
  if (ovPlat || rawPlat) next.platforms = [...new Set([...(rawPlat ?? []), ...(ovPlat ?? [])].map((p) => p.toLowerCase()))];
  return next;
}

function better(a: Ad, b: Ad): Ad {
  if (a.performance.score !== b.performance.score) return a.performance.score > b.performance.score ? a : b;
  return a.collectedAt >= b.collectedAt ? a : b;
}

export function compareAds(a: Ad, b: Ad): number {
  return (
    b.performance.score - a.performance.score ||
    (b.activeDays ?? 0) - (a.activeDays ?? 0) ||
    (b.variations ?? 0) - (a.variations ?? 0) ||
    a.id.localeCompare(b.id)
  );
}

let cache: { key: string; data: AdDataset } | null = null;

export function loadAds(): AdDataset {
  const list = (dir: string) => {
    try {
      return fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".json")).sort();
    } catch {
      return [];
    }
  };
  const names = list(DATA_DIR);
  const overlayNames = list(MEDIA_DIR);

  // Cache keyed by file mtimes/sizes so `next dev` picks up fresh ingests without restart.
  const stamp = (dir: string, n: string) => {
    try {
      const s = fs.statSync(path.join(dir, n));
      return `${n}:${s.mtimeMs}:${s.size}`;
    } catch {
      return `${n}:x`;
    }
  };
  const key = [...names.map((n) => stamp(DATA_DIR, n)), "#", ...overlayNames.map((n) => stamp(MEDIA_DIR, n))].join("|");
  if (cache && cache.key === key) return cache.data;

  const overlays = readOverlays(overlayNames);
  const byId = new Map<string, Ad>();
  const files: AdDataset["files"] = [];
  let generatedAt: string | undefined;
  for (const name of names) {
    const { generatedAt: g, items, error } = readFileSafe(path.join(DATA_DIR, name));
    if (g && (!generatedAt || g > generatedAt)) generatedAt = g;
    let count = 0;
    for (const raw of items) {
      const ad = normalizeAd(applyOverlay(raw, overlays), g);
      if (!ad) continue;
      count++;
      const prev = byId.get(ad.id);
      byId.set(ad.id, prev ? better(prev, ad) : ad);
    }
    files.push(error ? { name, count, error } : { name, count });
  }

  let ads = [...byId.values()];
  const usingFixtures = ads.length === 0;
  if (usingFixtures) ads = FIXTURE_ADS.map((a) => ({ ...a }));
  ads.sort(compareAds);

  const data: AdDataset = { ads, usingFixtures, generatedAt, files };
  cache = { key, data };
  return data;
}

export function getAllAds(): Ad[] {
  return loadAds().ads;
}

export function getAdById(id: string): Ad | undefined {
  return loadAds().ads.find((a) => a.id === id);
}

export interface BrandSummary {
  key: string;
  name: string;
  handle?: string;
  website?: string;
  logoUrl?: string;
  segments: Segment[];
  markets: Market[];
  sources: Source[];
  verticals: string[];
  count: number;
  topScore: number;
  avgScore: number;
  maxDays: number;
  topAdId: string;
  topIsLegend: boolean; // best ad is a curated classic → show the "Efsane" badge, not a number
  previewUrl?: string; // best ad's image or video thumbnail (may expire)
}

export function brandKey(name: string): string {
  return name.trim().toLocaleLowerCase("tr");
}

export function getBrands(ads: Ad[] = getAllAds()): BrandSummary[] {
  const map = new Map<string, { ads: Ad[] }>();
  for (const ad of ads) {
    const k = brandKey(ad.brand.name);
    const e = map.get(k) ?? { ads: [] };
    e.ads.push(ad);
    map.set(k, e);
  }
  const out: BrandSummary[] = [];
  for (const [key, { ads: list }] of map) {
    const sorted = [...list].sort(compareAds);
    const top = sorted[0];
    const uniq = <T,>(xs: (T | undefined)[]) => [...new Set(xs.filter((x): x is T => x !== undefined))];
    const firstImage = sorted.map(previewImage).find(Boolean);
    out.push({
      key,
      name: top.brand.name,
      handle: sorted.find((a) => a.brand.handle)?.brand.handle,
      website: sorted.find((a) => a.brand.website)?.brand.website,
      logoUrl: sorted.find((a) => a.brand.logoUrl)?.brand.logoUrl,
      segments: uniq(sorted.map((a) => a.segment)),
      markets: uniq(sorted.map((a) => a.market)),
      sources: uniq(sorted.map((a) => a.source)),
      verticals: uniq(sorted.map((a) => a.vertical)),
      count: list.length,
      topScore: top.performance.score,
      avgScore: Math.round(list.reduce((s, a) => s + a.performance.score, 0) / list.length),
      maxDays: Math.max(0, ...list.map((a) => a.activeDays ?? 0)),
      topAdId: top.id,
      topIsLegend: top.source === "curated",
      previewUrl: firstImage,
    });
  }
  return out.sort((a, b) => b.topScore - a.topScore || b.count - a.count || a.name.localeCompare(b.name, "tr"));
}
