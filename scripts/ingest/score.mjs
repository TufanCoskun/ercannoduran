// AdGym "winner" scoring heuristic (SPEC: "High-performing proxy").
// Mirror of src/lib/score.ts — keep the weights below in sync with the app.
//
// Spend is not public for commercial ads, so the score is a proxy built from
// longevity + scaling signals. Every rule adds points and a short Turkish reason.
//
//   base                          10
//   running >= 30 days           +15  "30+ gün yayında"
//   running >= 90 days           +15  "90+ gün yayında"      (cumulative)
//   running >= 180 days          +10  "180+ gün yayında"     (cumulative)
//   still active                 +10  "Hâlâ yayında"
//   variations >= 3              +10  "N varyasyon"
//   variations >= 10             +10  (cumulative)
//   platforms >= 2               +5   "N platformda"
//   platforms >= 3               +5   (cumulative)
//   TikTok Top Ads rank <= 10    +25  "TikTok Top Ads #N"
//   TikTok Top Ads rank <= 50    +15
//   TikTok Top Ads rank > 50     +8
//   TikTok likes >= 10k / 100k   +5 / +10  "N beğeni"
//   TikTok CTR (top tier) >= .8  +10  "Yüksek CTR"
//   reach >= 100k / 1M (EU lib)  +5 / +10  "1M+ erişim"
//   curated classic              +30  "Küratörlü klasik"
// Clamped to 0–100.

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

function fmtCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}B`;
  return String(n);
}

/**
 * @param {object} s signals
 * @param {number}   [s.activeDays]
 * @param {boolean}  [s.isActive]
 * @param {number}   [s.variations]
 * @param {string[]} [s.platforms]
 * @param {number}   [s.tiktokRank]    1-based position in TikTok Top Ads list
 * @param {number}   [s.tiktokLikes]
 * @param {number}   [s.tiktokCtr]     Creative Center relative CTR tier (0..1)
 * @param {number}   [s.reach]         unique users reached (EU ad libraries)
 * @param {boolean}  [s.curated]
 * @returns {{score:number, reasons:string[]}}
 */
export function scoreAd(s = {}) {
  let score = 10;
  const reasons = [];

  const days = Number.isFinite(s.activeDays) ? s.activeDays : null;
  if (days !== null) {
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

  if (Number.isFinite(s.tiktokRank) && s.tiktokRank > 0) {
    score += s.tiktokRank <= 10 ? 25 : s.tiktokRank <= 50 ? 15 : 8;
    reasons.push(`TikTok Top Ads #${s.tiktokRank}`);
  }
  if (Number.isFinite(s.tiktokLikes)) {
    if (s.tiktokLikes >= 100_000) { score += 10; reasons.push(`${fmtCount(s.tiktokLikes)} beğeni`); }
    else if (s.tiktokLikes >= 10_000) { score += 5; reasons.push(`${fmtCount(s.tiktokLikes)} beğeni`); }
  }
  if (Number.isFinite(s.tiktokCtr) && s.tiktokCtr >= 0.8) { score += 10; reasons.push("Yüksek CTR"); }

  if (Number.isFinite(s.reach)) {
    if (s.reach >= 1_000_000) { score += 10; reasons.push("1M+ erişim"); }
    else if (s.reach >= 100_000) { score += 5; reasons.push("100B+ erişim"); }
  }

  if (s.curated) { score += 30; reasons.push("Küratörlü klasik"); }

  return { score: clamp(score), reasons };
}

export default scoreAd;
