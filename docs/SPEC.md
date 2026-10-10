# AdGym — "Reklam kasını her gün çalıştır"

A TikTok-style vertical feed of real, high-performing ads. Users scroll ads, filter by
category/market/platform, save ads into collections, and share ads with others.

Sources: Meta Ad Library (public), TikTok (Creative Center / Commercial Content API), plus
hand-curated entries. Segments: high-performing **DTC brands**, **hotels/hospitality**,
**Turkey (TR)**, **USA (US)**, and **general** (big brand / other verticals).

UI language: **Turkish** (short, punchy labels). Ad content is shown as-is.

## Stack (fixed — do not change)

- Next.js 15 (App Router) + TypeScript + Tailwind CSS, `npm` as package manager.
- No database. Ad data = static JSON in `data/ads/*.json`, merged at build/read time.
- Saved ads / collections = `localStorage` (per device). Sharing = `/ad/[id]` page +
  Web Share API + copy-link fallback.
- Ingestion scripts = plain Node ESM (`scripts/ingest/*.mjs`), Node 22 built-in `fetch`,
  **no extra npm deps**. Tokens via env vars (`META_AD_LIBRARY_TOKEN`, `TIKTOK_*`).

## Data contract — `src/lib/types.ts` (source of truth)

```ts
export type Source = "meta" | "tiktok" | "curated";
export type Segment = "dtc" | "hotel" | "general";
export type Market = "TR" | "US" | "GLOBAL";
export type Format = "video" | "image" | "carousel" | "text";

export interface AdMedia {
  type: "video" | "image";
  url: string;            // direct media URL (may expire for fbcdn/tiktokcdn)
  thumbnailUrl?: string;
}

export interface Ad {
  id: string;             // `${source}_${nativeId}` e.g. "meta_1234567890"
  source: Source;
  segment: Segment;
  market: Market;
  vertical?: string;      // free tag: "skincare", "apparel", "supplements", "resort", "food", ...
  brand: {
    name: string;
    pageId?: string;      // Meta page id
    handle?: string;      // @instagram / @tiktok
    website?: string;
    logoUrl?: string;
  };
  format: Format;
  media: AdMedia[];       // may be empty -> UI renders a styled text card
  headline?: string;
  body?: string;          // primary text / caption
  cta?: string;           // "Shop Now", "Book Now", ...
  landingUrl?: string;
  platforms?: string[];   // ["facebook","instagram","messenger","audience_network","tiktok"]
  languages?: string[];   // ["tr","en"]
  startedAt?: string;     // ISO date the ad started running
  endedAt?: string | null;
  isActive?: boolean;
  activeDays?: number;    // days running as of collectedAt
  variations?: number;    // # of ads sharing this creative (signal of scaling)
  performance: {
    score: number;        // 0–100 "winner" proxy (see below)
    reasons: string[];    // e.g. ["90+ gün yayında", "12 varyasyon"]
  };
  libraryUrl: string;     // public link to the ad in its library (Meta: https://www.facebook.com/ads/library/?id=<id>)
  collectedAt: string;    // ISO timestamp
}
```

### "High-performing" proxy (spend is not public for commercial ads)
`score` = longevity + scaling signals: running ≥30 days (+), ≥90 days (++), still active (+),
multiple variations/duplicates (+), multi-platform (+), TikTok Top Ads CTR/likes rank (+).
Implemented once in `src/lib/score.ts` and mirrored in `scripts/ingest/score.mjs`.

### Data files
- `data/ads/meta-tr.json` — Meta ads, market TR (DTC + hotels + general)
- `data/ads/meta-us.json` — Meta ads, market US (DTC + hotels + general)
- `data/ads/tiktok.json` — TikTok ads (TR + US + global)
- `data/ads/curated.json` — optional hand-picked extras
- `data/brands.json` — brand watchlist that drives ingestion:
  `{ name, segment, market, vertical, metaPageId?, searchTerms?, tiktokHandle?, website? }[]`

Each `data/ads/*.json` file is `{ "generatedAt": string, "ads": Ad[] }`.
`src/lib/ads.ts` loads all files, dedupes by `id`, sorts by `performance.score`.

## Features
1. **Feed** (`/`): full-height snap-scroll vertical feed (mobile-first, works on desktop
   as a centered phone-width column). Video autoplays muted when in view; image/carousel
   swipe; text card fallback when media is missing/expired. Overlay: brand, segment/market
   chips, days running, score badge, body text (expandable), CTA, actions.
2. **Filters**: segment (DTC / Otel / Genel), market (TR / US / Global), source (Meta / TikTok),
   format, vertical; query params (`?segment=dtc&market=TR`) so filtered feeds are shareable.
   Also a "Bugünün antrenmanı" (daily 10-ad workout) mode seeded by date.
3. **Save**: heart/bookmark → localStorage; `/saved` page with collections (create/rename/delete,
   move ads between collections). Optional per-ad note ("neden çalışıyor?").
4. **Share**: `/ad/[id]` standalone page with OG metadata; share button uses `navigator.share`
   with copy-link fallback; also "WhatsApp'ta gönder" link.
5. **Brands** (`/brands`): browse brands, click → feed filtered to that brand.
6. Link out: "Ad Library'de aç" on every ad.

## File ownership (parallel agents — do not edit files you don't own)
| Owner | Paths |
|---|---|
| App/UI agent | everything under `src/`, `public/`, root config (`package.json`, `next.config.*`, `tailwind`, `tsconfig`, `.gitignore`, `README.md`) |
| Meta-TR data agent | `data/ads/meta-tr.json` |
| Meta-US data agent | `data/ads/meta-us.json` |
| Pipeline agent | `scripts/ingest/**`, `data/brands.json`, `data/ads/tiktok.json`, `data/ads/curated.json`, `docs/INGESTION.md` |

`package.json` scripts the App agent must add: `"ingest": "node scripts/ingest/index.mjs"`,
`"ingest:meta": "node scripts/ingest/meta.mjs"`, `"ingest:tiktok": "node scripts/ingest/tiktok.mjs"`.

No agent commits or pushes — the lead (chef) integrates and commits.
