import type { Ad, Format, Market, Segment, Source } from "./types";

/** Client-safe filter helpers. Query params: segment, market, source, format, vertical, brand, mode. */

export interface Filters {
  segment: Segment[];
  market: Market[];
  source: Source[];
  format: Format[];
  vertical: string[];
  brand: string[];
}

export type FilterKey = keyof Filters;
export const FILTER_KEYS: FilterKey[] = ["segment", "market", "source", "format", "vertical", "brand"];

export const EMPTY_FILTERS: Filters = { segment: [], market: [], source: [], format: [], vertical: [], brand: [] };

export const SEGMENT_OPTIONS: { value: Segment; label: string }[] = [
  { value: "dtc", label: "DTC" },
  { value: "hotel", label: "Otel" },
  { value: "general", label: "Genel" },
];
export const MARKET_OPTIONS: { value: Market; label: string }[] = [
  { value: "TR", label: "Türkiye" },
  { value: "US", label: "ABD" },
  { value: "GLOBAL", label: "Global" },
];
export const SOURCE_OPTIONS: { value: Source; label: string }[] = [
  { value: "meta", label: "Meta" },
  { value: "tiktok", label: "TikTok" },
  { value: "curated", label: "Seçki" },
];
export const FORMAT_OPTIONS: { value: Format; label: string }[] = [
  { value: "video", label: "Video" },
  { value: "image", label: "Görsel" },
  { value: "carousel", label: "Carousel" },
  { value: "text", label: "Metin" },
];

export const SEGMENT_LABEL: Record<Segment, string> = { dtc: "DTC", hotel: "Otel", general: "Genel" };
export const MARKET_LABEL: Record<Market, string> = { TR: "TR", US: "US", GLOBAL: "Global" };
export const SOURCE_LABEL: Record<Source, string> = { meta: "Meta", tiktok: "TikTok", curated: "Seçki" };
export const FORMAT_LABEL: Record<Format, string> = { video: "Video", image: "Görsel", carousel: "Carousel", text: "Metin" };

const VERTICAL_TR: Record<string, string> = {
  skincare: "Cilt bakımı",
  beauty: "Güzellik",
  cosmetics: "Kozmetik",
  makeup: "Makyaj",
  haircare: "Saç bakımı",
  fragrance: "Parfüm",
  apparel: "Giyim",
  fashion: "Moda",
  footwear: "Ayakkabı",
  shoes: "Ayakkabı",
  jewelry: "Takı",
  accessories: "Aksesuar",
  supplements: "Takviye",
  health: "Sağlık",
  wellness: "Wellness",
  fitness: "Fitness",
  food: "Yemek",
  beverage: "İçecek",
  beverages: "İçecek",
  drinks: "İçecek",
  coffee: "Kahve",
  snacks: "Atıştırmalık",
  grocery: "Market",
  home: "Ev",
  furniture: "Mobilya",
  "home-decor": "Ev dekor",
  bedding: "Uyku",
  sleep: "Uyku",
  pets: "Evcil hayvan",
  pet: "Evcil hayvan",
  baby: "Bebek",
  kids: "Çocuk",
  electronics: "Elektronik",
  tech: "Teknoloji",
  fintech: "Fintech",
  finance: "Finans",
  banking: "Banka",
  insurance: "Sigorta",
  travel: "Seyahat",
  airline: "Havayolu",
  resort: "Resort",
  hotel: "Otel",
  "city-hotel": "Şehir oteli",
  "boutique-hotel": "Butik otel",
  "hotel-chain": "Otel zinciri",
  "luxury-hotel": "Lüks otel",
  ota: "Seyahat sitesi",
  delivery: "Teslimat",
  "quick-commerce": "Hızlı teslimat",
  ecommerce: "E-ticaret",
  marketplace: "Pazaryeri",
  retail: "Perakende",
  automotive: "Otomotiv",
  auto: "Otomotiv",
  telecom: "Telekom",
  gaming: "Oyun",
  apps: "Uygulama",
  app: "Uygulama",
  education: "Eğitim",
  eyewear: "Gözlük",
  bags: "Çanta",
  luggage: "Valiz",
  outdoor: "Outdoor",
  sports: "Spor",
  "meal-kit": "Yemek kutusu",
  restaurant: "Restoran",
  "personal-care": "Kişisel bakım",
  oral: "Ağız bakımı",
  razors: "Tıraş",
  grooming: "Erkek bakımı",
  bank: "Banka",
  "travel-agency": "Seyahat acentesi",
  "travel-deals": "Seyahat fırsatı",
  "beauty-retail": "Kozmetik mağazası",
  "food-beverage": "Yiyecek & içecek",
  "home-kitchen": "Ev & mutfak",
  "home-cleaning": "Temizlik",
  "kitchen-appliances": "Mutfak aletleri",
  "music-streaming": "Müzik",
  "resort-casino": "Resort & casino",
  "vacation-ownership": "Devre mülk",
  "short-term-rental": "Kısa dönem kiralık",
  "automotive-b2b": "Otomotiv (B2B)",
  destination: "Destinasyon",
  cruise: "Kruvaziyer",
  drinkware: "Matara & bardak",
  jobs: "İş ilanı",
  bathroom: "Banyo",
  mattress: "Yatak",
};

export function verticalLabel(v: string): string {
  const k = v.toLowerCase().trim().replace(/[()]/g, "").replace(/[\s_]+/g, "-");
  if (VERTICAL_TR[k]) return VERTICAL_TR[k];
  const s = k.replace(/[-_]+/g, " ");
  return s.charAt(0).toLocaleUpperCase("tr") + s.slice(1);
}

type Params = { get(name: string): string | null } | URLSearchParams;

function list(params: Params, key: string): string[] {
  const raw = params.get(key);
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function pickAll<T extends string>(values: string[], allowed: readonly T[]): T[] {
  const out: T[] = [];
  for (const v of values) {
    const hit = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

export function parseFilters(params: Params): Filters {
  return {
    segment: pickAll(list(params, "segment"), ["dtc", "hotel", "general"] as const),
    market: pickAll(list(params, "market"), ["TR", "US", "GLOBAL"] as const),
    source: pickAll(list(params, "source"), ["meta", "tiktok", "curated"] as const),
    format: pickAll(list(params, "format"), ["video", "image", "carousel", "text"] as const),
    vertical: list(params, "vertical").map((v) => v.toLowerCase()),
    brand: list(params, "brand"),
  };
}

export function filtersToQuery(f: Filters, extra?: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const k of FILTER_KEYS) if (f[k].length) sp.set(k, f[k].join(","));
  if (extra) for (const [k, v] of Object.entries(extra)) if (v) sp.set(k, v);
  const s = sp.toString().replace(/%2C/g, ",");
  return s ? `?${s}` : "";
}

export function activeFilterCount(f: Filters): number {
  return FILTER_KEYS.reduce((n, k) => n + f[k].length, 0);
}

export function matchesFilters(ad: Ad, f: Filters): boolean {
  if (f.segment.length && !f.segment.includes(ad.segment)) return false;
  if (f.market.length && !f.market.includes(ad.market)) return false;
  if (f.source.length && !f.source.includes(ad.source)) return false;
  if (f.format.length && !f.format.includes(ad.format)) return false;
  if (f.vertical.length && !(ad.vertical && f.vertical.includes(ad.vertical.toLowerCase()))) return false;
  if (f.brand.length) {
    const name = ad.brand.name.toLocaleLowerCase("tr");
    if (!f.brand.some((b) => b.toLocaleLowerCase("tr") === name)) return false;
  }
  return true;
}

export function toggleValue<K extends FilterKey>(f: Filters, key: K, value: Filters[K][number]): Filters {
  const cur = f[key] as string[];
  const next = cur.includes(value as string) ? cur.filter((v) => v !== value) : [...cur, value as string];
  return { ...f, [key]: next } as Filters;
}

/** Re-rank so the same brand doesn't appear back-to-back too often (keeps score order otherwise). */
export function diversify(ads: Ad[], gap = 3): Ad[] {
  const pending = [...ads];
  const out: Ad[] = [];
  const recent: string[] = [];
  while (pending.length) {
    let idx = pending.findIndex((a) => !recent.includes(a.brand.name));
    if (idx === -1 || idx > 12) idx = 0; // don't push a strong ad too far down
    const [ad] = pending.splice(idx, 1);
    out.push(ad);
    recent.push(ad.brand.name);
    if (recent.length > gap) recent.shift();
  }
  return out;
}

/**
 * Default feed order: score-ranked ads with curated classics ("Efsane") woven in every ~5 items
 * (curated ads have no longevity signals, so pure score order would sink them to the bottom).
 */
export function interleaveCurated(ads: Ad[], every = 5, first = 2): Ad[] {
  const legends = diversify(ads.filter((a) => a.source === "curated"), 2);
  const rest = diversify(ads.filter((a) => a.source !== "curated"));
  if (!legends.length || !rest.length) return legends.length ? legends : rest;
  const out: Ad[] = [];
  let r = 0;
  let l = 0;
  while (r < rest.length || l < legends.length) {
    const slot = out.length;
    const legendSlot = slot === first || (slot > first && (slot - first) % every === 0);
    if ((legendSlot && l < legends.length) || r >= rest.length) out.push(legends[l++]);
    else out.push(rest[r++]);
  }
  return out;
}

export interface Facet {
  value: string;
  count: number;
}

export function facetCounts(ads: Ad[], get: (a: Ad) => string | undefined): Facet[] {
  const m = new Map<string, number>();
  for (const a of ads) {
    const v = get(a);
    if (v) m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
