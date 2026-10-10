import type { Ad, Source } from "./types";

/**
 * "Winner" proxy score (0–100). Spend is not public for commercial ads, so we use
 * longevity + scaling signals. Mirrored in scripts/ingest/score.mjs — keep in sync.
 *
 *   base (it made it into the library / watchlist)        10
 *   longevity  ≥7d +5 · ≥30d +20 · ≥90d +35 · ≥180d +42 · ≥365d +48
 *   still active                                           +12
 *   variations ≥2 +6 · ≥5 +12 · ≥10 +18
 *   platforms  ≥2 +5 · ≥3 +8
 *   TikTok Top Ads: rank ≤10 +16 · ≤50 +12 · any +8; CTR pct ≥80 +6; likes ≥100k +6
 */
export interface ScoreSignals {
  activeDays?: number;
  isActive?: boolean;
  variations?: number;
  platforms?: string[];
  source?: Source;
  tiktok?: {
    rank?: number;          // position in TikTok Top Ads (1 = best)
    ctrPercentile?: number; // 0–100
    likes?: number;
  };
}

export interface ScoreResult {
  score: number;
  reasons: string[];
}

export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(".", ",")} Mn`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} B`;
  return String(n);
}

export function computeScore(s: ScoreSignals): ScoreResult {
  let score = 10;
  const reasons: string[] = [];
  const days = s.activeDays ?? 0;

  if (days >= 365) { score += 48; reasons.push("365+ gün yayında"); }
  else if (days >= 180) { score += 42; reasons.push("180+ gün yayında"); }
  else if (days >= 90) { score += 35; reasons.push("90+ gün yayında"); }
  else if (days >= 30) { score += 20; reasons.push("30+ gün yayında"); }
  else if (days >= 7) { score += 5; }

  if (s.isActive) { score += 12; reasons.push("Hâlâ yayında"); }

  const v = s.variations ?? 0;
  if (v >= 10) { score += 18; reasons.push(`${v} varyasyon`); }
  else if (v >= 5) { score += 12; reasons.push(`${v} varyasyon`); }
  else if (v >= 2) { score += 6; reasons.push(`${v} varyasyon`); }

  const p = new Set((s.platforms ?? []).map((x) => x.toLowerCase())).size;
  if (p >= 3) { score += 8; reasons.push(`${p} platformda`); }
  else if (p >= 2) { score += 5; reasons.push(`${p} platformda`); }

  if (s.tiktok) {
    const { rank, ctrPercentile, likes } = s.tiktok;
    if (typeof rank === "number" && rank > 0) {
      score += rank <= 10 ? 16 : rank <= 50 ? 12 : 8;
      reasons.push(`TikTok Top Ads #${rank}`);
    }
    if (typeof ctrPercentile === "number" && ctrPercentile >= 80) {
      score += 6;
      reasons.push("Yüksek CTR");
    }
    if (typeof likes === "number" && likes >= 100_000) {
      score += 6;
      reasons.push(`${formatCompact(likes)} beğeni`);
    }
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

/** Days between two ISO dates (end defaults to now). */
export function daysBetween(startIso?: string, endIso?: string | null): number | undefined {
  if (!startIso) return undefined;
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return undefined;
  const end = endIso ? Date.parse(endIso) : Date.now();
  if (Number.isNaN(end)) return undefined;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

/** Score an ad from its own fields (used when ingested data has no performance block). */
export function scoreAd(ad: Pick<Ad, "activeDays" | "isActive" | "variations" | "platforms" | "source" | "startedAt" | "endedAt" | "collectedAt">): ScoreResult {
  const activeDays = ad.activeDays ?? daysBetween(ad.startedAt, ad.endedAt ?? ad.collectedAt);
  return computeScore({
    activeDays,
    isActive: ad.isActive,
    variations: ad.variations,
    platforms: ad.platforms,
    source: ad.source,
  });
}

export type ScoreTier = "elite" | "strong" | "solid";

export function scoreTier(score: number): ScoreTier {
  if (score >= 80) return "elite";
  if (score >= 60) return "strong";
  return "solid";
}
