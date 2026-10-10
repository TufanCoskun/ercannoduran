import type { Ad } from "@/lib/types";
import { brandHue, monogram, truncate } from "@/lib/format";
import { scoreTier } from "@/lib/score";

const norm = (s: string) => s.toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}]+/gu, "");

/** True when the "headline" is really just the brand / page name (common in Meta Ad Library data). */
function isBrandish(headline: string, brand: string): boolean {
  const h = norm(headline);
  const b = norm(brand);
  return !h || b.includes(h) || h.includes(b);
}

const TIER = {
  elite: "bg-volt text-black",
  strong: "bg-amber-300 text-black",
  solid: "bg-white/15 text-white",
} as const;

/**
 * Primary experience for ads without (working) media: a brand-colored poster with
 * monogram, big headline, score/longevity badges and a link to the full ad in its library.
 * Also the fallback when media URLs expire. `compact` renders a grid thumbnail.
 */
export function TextCard({ ad, reason, compact }: { ad: Ad; reason: "missing" | "expired"; compact?: boolean }) {
  const hue = brandHue(ad.brand.name);
  const hue2 = (hue + 48) % 360;
  const headline = ad.headline && !isBrandish(ad.headline, ad.brand.name) ? ad.headline : undefined;
  const big = headline ?? ad.brand.name;
  const sub = ad.body ? truncate(ad.body.replace(/\s+/g, " "), 170) : undefined;
  const bg = `radial-gradient(120% 75% at 0% 0%, hsl(${hue} 78% 42% / 0.95), transparent 60%), radial-gradient(90% 60% at 100% 100%, hsl(${hue2} 80% 34% / 0.85), transparent 62%), linear-gradient(165deg, hsl(${hue} 45% 13%), #060608 72%)`;

  if (compact) {
    return (
      <div className="relative flex h-full w-full flex-col justify-between overflow-hidden p-3" style={{ background: bg }}>
        <span
          className="grid size-8 place-items-center rounded-xl text-[11px] font-black text-white ring-1 ring-white/25"
          style={{ background: `linear-gradient(135deg, hsl(${hue} 85% 60%), hsl(${hue2} 75% 40%))` }}
        >
          {monogram(ad.brand.name)}
        </span>
        <p className="line-clamp-4 text-[13px] font-bold leading-snug text-white">{truncate(big, 110)}</p>
      </div>
    );
  }

  const formatNote =
    reason === "expired"
      ? "Medyanın süresi dolmuş"
      : ad.format === "carousel"
        ? "Carousel · görseller Ad Library'de"
        : ad.format === "video"
          ? "Video · Ad Library'de izle"
          : ad.format === "image"
            ? "Görsel · Ad Library'de"
            : "Metin reklamı";
  const len = big.length;
  const size = len > 120 ? "text-[1.6rem]" : len > 70 ? "text-[2rem]" : len > 28 ? "text-[2.5rem]" : "text-[3rem]";

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden" style={{ background: bg }}>
      <div className="grain pointer-events-none absolute inset-0" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-10 -right-6 select-none text-[13rem] font-black leading-none tracking-tighter text-white/[0.045]"
      >
        {monogram(ad.brand.name)}
      </div>

      <div className="relative flex flex-1 flex-col justify-center px-7 pb-44 pt-24">
        <div className="mb-6 flex items-center gap-3">
          <span
            className="grid size-16 shrink-0 place-items-center rounded-2xl text-2xl font-black tracking-tight text-white shadow-lg shadow-black/30 ring-1 ring-white/25"
            style={{ background: `linear-gradient(135deg, hsl(${hue} 85% 60%), hsl(${hue2} 75% 38%))` }}
          >
            {monogram(ad.brand.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold uppercase tracking-[0.14em] text-white/70">{ad.brand.name}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/55">
              <span className={`size-1.5 rounded-full ${reason === "expired" ? "bg-ember" : "bg-volt"}`} />
              {formatNote}
            </p>
          </div>
        </div>

        <p className={`font-black leading-[1.05] tracking-tight text-white text-balance ${size}`}>
          {headline ? <span className="mr-1 text-white/30">“</span> : null}
          {truncate(big, 200)}
          {headline ? <span className="ml-0.5 text-white/30">”</span> : null}
        </p>
        {sub && <p className="mt-4 line-clamp-3 text-[15px] leading-relaxed text-white/70">{sub}</p>}

        <div className="mt-6 flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-black ${TIER[scoreTier(ad.performance.score)]}`}>
            Skor {ad.performance.score}
          </span>
          {ad.activeDays !== undefined && (
            <span className="inline-flex items-center rounded-full bg-black/30 px-3 py-1.5 text-xs font-bold text-orange-200 ring-1 ring-white/15 backdrop-blur">
              {ad.activeDays} gün{ad.isActive === false ? "" : " · yayında"}
            </span>
          )}
          {ad.variations !== undefined && ad.variations > 1 && (
            <span className="inline-flex items-center rounded-full bg-black/30 px-3 py-1.5 text-xs font-bold text-white/85 ring-1 ring-white/15 backdrop-blur">
              {ad.variations} varyasyon
            </span>
          )}
        </div>

        <a
          href={ad.libraryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex w-fit items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-black shadow-xl shadow-black/30 transition hover:bg-volt"
        >
          {ad.source === "tiktok" ? "Reklamın tamamını TikTok'ta gör" : "Reklamın tamamını Ad Library'de gör"} <span aria-hidden="true">→</span>
        </a>
      </div>
    </div>
  );
}
