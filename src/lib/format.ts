import type { Ad } from "./types";

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function brandHue(name: string): number {
  return hashString(name.toLowerCase()) % 360;
}

export function monogram(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0];
  return letters.toLocaleUpperCase("tr");
}

export function daysLabel(ad: Ad): string | undefined {
  const d = ad.activeDays;
  if (d === undefined) return undefined;
  if (ad.isActive === false) return `${d} gün yayında kaldı`;
  if (d === 0) return "Bugün başladı";
  return `${d} gündür yayında`;
}

export function shortDays(d?: number): string | undefined {
  if (d === undefined) return undefined;
  return `${d} gün`;
}

const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  messenger: "Messenger",
  audience_network: "Audience Network",
  threads: "Threads",
  whatsapp: "WhatsApp",
  tiktok: "TikTok",
};

export function platformLabel(p: string): string {
  return PLATFORM_LABEL[p.toLowerCase()] ?? p;
}

export function formatDate(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
}

export function adTitle(ad: Ad): string {
  return ad.headline ?? firstLine(ad.body) ?? ad.brand.name;
}

export function firstLine(s?: string, max = 120): string | undefined {
  if (!s) return undefined;
  const line = s.split(/\n+/)[0].trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Image to preview an ad with (image url or video poster). */
export function previewImage(ad: Ad): string | undefined {
  for (const m of ad.media) {
    if (m.type === "image") return m.url;
    if (m.thumbnailUrl) return m.thumbnailUrl;
  }
  return undefined;
}

export function adPath(id: string): string {
  return `/ad/${encodeURIComponent(id)}`;
}

export function brandFeedPath(name: string): string {
  return `/?brand=${encodeURIComponent(name)}`;
}
