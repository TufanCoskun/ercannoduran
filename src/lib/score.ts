import type { Ad } from "./types";

/**
 * "Winner" proxy score (0–100). Spend is not public for commercial ads, so we use
 * longevity + scaling signals. Mirrors scripts/ingest/score.mjs — keep weights in sync.
 *
 *   base                          10
 *   running ≥30 / ≥90 / ≥180 days +15 / +30 / +40
 *   still active                  +10
 *   variations ≥3 / ≥10           +10 / +20
 *   platforms ≥2 / ≥3             +5 / +10
 *   TikTok Top Ads rank ≤10 / ≤50 / any   +25 / +15 / +8
 *   TikTok likes ≥10k / ≥100k     +5 / +10
 *   TikTok CTR tier ≥0.8          +10
 *   reach ≥100k / ≥1M             +5 / +10
 *   curated classic               +30
 */
export interface ScoreSignals {
  activeDays?: number;
  isActive?: boolean;
  variations?: number;
  platforms?: string[];
  tiktokRank?: number;  // 1-based position in TikTok Top Ads
  tiktokLikes?: number;
  tiktokCtr?: number;   // Creative Center relative CTR tier (0..1)
  reach?: number;       // unique users reached (EU ad libraries)
  curated?: boolean;
}

export interface ScoreResult {
  score: number;
  reasons: string[];
}

export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}B`;
  return String(n);
}

const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function computeScore(s: ScoreSignals = {}): ScoreResult {
  let score = 10;
  const reasons: string[] = [];

  if (fin(s.activeDays)) {
    const days = s.activeDays;
    if (days >= 180) { score += 40; reasons.push("180+ gün yayında"); }
    else if (days >= 90) { score += 30; reasons.push("90+ gün yayında"); }
    else if (days >= 30) { score += 15; reasons.push("30+ gün yayında"); }
  }

  if (s.isActive) { score += 10; reasons.push("Hâlâ yayında"); }

  const v = s.variations || 0;
  if (v >= 10) { score += 20; reasons.push(`${v} varyasyon`); }
  else if (v >= 3) { score += 10; reasons.push(`${v} varyasyon`); }

  const p = Array.isArray(s.platforms) ? new Set(s.platforms).size : 0;
  if (p >= 3) { score += 10; reasons.push(`${p} platformda`); }
  else if (p >= 2) { score += 5; reasons.push(`${p} platformda`); }

  if (fin(s.tiktokRank) && s.tiktokRank > 0) {
    score += s.tiktokRank <= 10 ? 25 : s.tiktokRank <= 50 ? 15 : 8;
    reasons.push(`TikTok Top Ads #${s.tiktokRank}`);
  }
  if (fin(s.tiktokLikes)) {
    if (s.tiktokLikes >= 100_000) { score += 10; reasons.push(`${formatCompact(s.tiktokLikes)} beğeni`); }
    else if (s.tiktokLikes >= 10_000) { score += 5; reasons.push(`${formatCompact(s.tiktokLikes)} beğeni`); }
  }
  if (fin(s.tiktokCtr) && s.tiktokCtr >= 0.8) { score += 10; reasons.push("Yüksek CTR"); }

  if (fin(s.reach)) {
    if (s.reach >= 1_000_000) { score += 10; reasons.push("1M+ erişim"); }
    else if (s.reach >= 100_000) { score += 5; reasons.push("100B+ erişim"); }
  }

  if (s.curated) { score += 30; reasons.push("Küratörlü klasik"); }

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
  });
}

export type ScoreTier = "elite" | "strong" | "solid";

export function scoreTier(score: number): ScoreTier {
  if (score >= 80) return "elite";
  if (score >= 60) return "strong";
  return "solid";
}
