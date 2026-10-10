import type { Ad } from "@/lib/types";
import { brandHue, monogram, truncate } from "@/lib/format";

/**
 * Styled fallback when an ad has no media, or its media URL expired / failed to load.
 * `compact` is used for grid thumbnails.
 */
export function TextCard({ ad, reason, compact }: { ad: Ad; reason: "missing" | "expired"; compact?: boolean }) {
  const hue = brandHue(ad.brand.name);
  const hue2 = (hue + 42) % 360;
  const quote = ad.headline ?? ad.body ?? ad.brand.name;
  const sub = ad.headline && ad.body ? ad.body : undefined;
  const qLen = quote.length;

  if (compact) {
    return (
      <div
        className="relative flex h-full w-full flex-col justify-between overflow-hidden p-3"
        style={{ background: `radial-gradient(120% 90% at 0% 0%, hsl(${hue} 70% 34%), transparent 60%), linear-gradient(160deg, hsl(${hue2} 45% 14%), #08080a)` }}
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">{monogram(ad.brand.name)}</span>
        <p className="line-clamp-4 text-[13px] font-semibold leading-snug text-white">{truncate(quote, 110)}</p>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden px-7 pb-64 pt-20"
      style={{
        background: `radial-gradient(110% 70% at 10% 0%, hsl(${hue} 75% 38% / 0.95), transparent 62%), radial-gradient(90% 60% at 100% 100%, hsl(${hue2} 80% 30% / 0.8), transparent 60%), linear-gradient(170deg, hsl(${hue2} 40% 10%), #060608 70%)`,
      }}
    >
      <div className="grain pointer-events-none absolute inset-0" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 top-16 select-none text-[11rem] font-black leading-none tracking-tighter text-white/[0.05]"
      >
        {monogram(ad.brand.name)}
      </div>
      <span className="relative mb-5 inline-flex w-fit items-center gap-2 rounded-full bg-black/30 px-3 py-1 text-[11px] font-medium text-white/70 ring-1 ring-white/10 backdrop-blur">
        <span className={`size-1.5 rounded-full ${reason === "expired" ? "bg-ember" : "bg-volt"}`} />
        {reason === "expired" ? "Medyanın süresi dolmuş · metin görünümü" : "Metin odaklı reklam"}
      </span>
      <div className="relative my-auto">
        <span className="mb-2 block font-serif text-6xl leading-none text-white/25">“</span>
        <p
          className={`font-bold leading-[1.12] tracking-tight text-white text-balance ${qLen > 140 ? "text-2xl" : qLen > 70 ? "text-[1.9rem]" : "text-4xl"}`}
        >
          {truncate(quote, 220)}
        </p>
        {sub && <p className="mt-4 line-clamp-3 text-[15px] leading-relaxed text-white/65">{sub}</p>}
      </div>
    </div>
  );
}
