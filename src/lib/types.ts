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
