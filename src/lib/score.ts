import type { Ad } from "./types";

/**
 * AdGym "winner" proxy score (0–100) — THE canonical formula.
 * Spend is not public for commercial ads, so we use longevity + scaling signals.
 * scripts/ingest/score.mjs is a line-for-line JS copy of this file: change both together.
 *
 *   base (it made it into the library / watchlist)        10
 *   longevity  ≥7d +5 · ≥30d +20 · ≥90d +35 · ≥180d +42 · ≥365d +48
 *   still active                                           +12
 *   variations ≥2 +6 · ≥5 +12 · ≥10 +18
 *   platforms  ≥2 +5 · ≥3 +8
 *   TikTok Top Ads: rank ≤10 +16 · ≤50 +12 · any +8; CTR pct ≥80 +6; likes ≥100k +6
 *   curated classic ("Efsane"): floor of LEGEND_SCORE
 *
 * The app (src/lib/ads.ts) always recomputes `performance` from the ad's signals at load time,
 * so precomputed scores in data files never drift from this formula.
 */

export const LEGEND_SCORE = 85;

/** Canonical reason texts (also used to read TikTok signals back from stored reasons). */
export const REASON = {
  days: (d: number) => `${d}+ gün yayında`,
  active: "Hâlâ yayında",
  variations: (v: number) => `${v} varyasyon`,
  platforms: (p: number) => `${p} platformda`,
  tiktokRank: (r: number) => `TikTok Top Ads #${r}`,
  tiktokCtr: "Yüksek CTR",
  likes: (n: string) => `${n} beğeni`,
  legend: "Küratörlü klasik",
} as const;

export interface TikTokSignals {
  rank?: number; // position in TikTok Top Ads (1 = best)
  ctrPercentile?: number; // 0–100
  likes?: number;
}

export interface ScoreSignals {
  activeDays?: number;
  isActive?: boolean;
  variations?: number;
  platforms?: string[];
  source?: "meta" | "tiktok" | "curated";
  tiktok?: TikTokSignals;
}

export interface ScoreResult {
  score: number;
  reasons: string[];
}

/** Turkish compact number: 1 200 → "1 B", 2 500 000 → "2,5 Mn". */
export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "").replace(".", ",")} Mn`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} B`;
  return String(n);
}

export function computeScore(s: ScoreSignals = {}): ScoreResult {
  let score = 10;
  const reasons: string[] = [];
  const days = typeof s.activeDays === "number" && Number.isFinite(s.activeDays) ? s.activeDays : 0;

  if (days >= 365) { score += 48; reasons.push(REASON.days(365)); }
  else if (days >= 180) { score += 42; reasons.push(REASON.days(180)); }
  else if (days >= 90) { score += 35; reasons.push(REASON.days(90)); }
  else if (days >= 30) { score += 20; reasons.push(REASON.days(30)); }
  else if (days >= 7) { score += 5; }

  if (s.isActive) { score += 12; reasons.push(REASON.active); }

  const v = typeof s.variations === "number" && Number.isFinite(s.variations) ? s.variations : 0;
  if (v >= 10) { score += 18; reasons.push(REASON.variations(v)); }
  else if (v >= 5) { score += 12; reasons.push(REASON.variations(v)); }
  else if (v >= 2) { score += 6; reasons.push(REASON.variations(v)); }

  const p = new Set((s.platforms ?? []).map((x) => x.toLowerCase())).size;
  if (p >= 3) { score += 8; reasons.push(REASON.platforms(p)); }
  else if (p >= 2) { score += 5; reasons.push(REASON.platforms(p)); }

  if (s.tiktok) {
    const { rank, ctrPercentile, likes } = s.tiktok;
    if (typeof rank === "number" && rank > 0) {
      score += rank <= 10 ? 16 : rank <= 50 ? 12 : 8;
      reasons.push(REASON.tiktokRank(rank));
    }
    if (typeof ctrPercentile === "number" && ctrPercentile >= 80) { score += 6; reasons.push(REASON.tiktokCtr); }
    if (typeof likes === "number" && likes >= 100_000) { score += 6; reasons.push(REASON.likes(formatCompact(likes))); }
  }

  if (s.source === "curated") { score = Math.max(score, LEGEND_SCORE); reasons.push(REASON.legend); }

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

/**
 * Days an ad has been running: from startedAt to endedAt, or to now while it is (presumably)
 * still live, or to collectedAt when it is known to have stopped without an end date.
 * Falls back to the stored value when there is no usable startedAt.
 */
export function runningDays(
  ad: Pick<Ad, "startedAt" | "endedAt" | "isActive" | "collectedAt" | "activeDays">,
  now: number = Date.now(),
): number | undefined {
  const end = ad.endedAt ? ad.endedAt : ad.isActive === false ? ad.collectedAt : new Date(now).toISOString();
  return daysBetween(ad.startedAt, end) ?? ad.activeDays;
}

/** Reads TikTok signals back out of stored reasons (the Ad schema has no dedicated fields). */
export function tiktokSignalsFromReasons(reasons: readonly string[] = []): TikTokSignals | undefined {
  const out: TikTokSignals = {};
  for (const r of reasons) {
    const rank = /TikTok Top Ads #(\d+)/.exec(r);
    if (rank) out.rank = Number(rank[1]);
    if (r === REASON.tiktokCtr) out.ctrPercentile = 80;
    const likes = /^([\d,]+)\s*(B|Mn|M|K)?\s*beğeni$/i.exec(r.trim());
    if (likes) {
      const n = Number(likes[1].replace(",", "."));
      const unit = (likes[2] ?? "").toLowerCase();
      out.likes = n * (unit === "mn" || unit === "m" ? 1_000_000 : unit === "b" || unit === "k" ? 1_000 : 1);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** Score an ad from its own fields. */
export function scoreAd(
  ad: Pick<Ad, "activeDays" | "isActive" | "variations" | "platforms" | "source" | "startedAt" | "endedAt" | "collectedAt"> & {
    performance?: { reasons?: string[] };
  },
): ScoreResult {
  return computeScore({
    activeDays: runningDays(ad),
    isActive: ad.isActive,
    variations: ad.variations,
    platforms: ad.platforms,
    source: ad.source,
    tiktok: ad.source === "tiktok" ? tiktokSignalsFromReasons(ad.performance?.reasons) : undefined,
  });
}

export type ScoreTier = "elite" | "strong" | "solid";

export function scoreTier(score: number): ScoreTier {
  if (score >= 80) return "elite";
  if (score >= 60) return "strong";
  return "solid";
}
