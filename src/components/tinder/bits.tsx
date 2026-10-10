"use client";

import type { SVGProps } from "react";
import type { Ad } from "@/lib/types";
import { daysLabel } from "@/lib/format";
import { useSaved } from "@/lib/saved";
import { AdThumb } from "../AdThumb";
import { BrandAvatar } from "../Bits";
import { BookmarkIcon, FlameIcon, ShareIcon } from "../Icons";
import { useUI } from "../UIProvider";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const HeartIcon = ({ filled, ...p }: P & { filled?: boolean }) => (
  <Svg {...p}>
    <path
      d="M12 20.5s-7.5-4.6-9.3-9.4C1.5 7.8 3.6 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.5 3.3 4.3 6.6-1.8 4.8-9.3 9.4-9.3 9.4z"
      fill={filled ? "currentColor" : "none"}
    />
  </Svg>
);
export const UndoIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 8v5h5" />
    <path d="M3.5 13A8.5 8.5 0 1 0 6 6.6L3 9.5" />
  </Svg>
);
export const CrossIcon = (p: P) => (
  <Svg strokeWidth={3} {...p}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Svg>
);
export const CardsIcon = (p: P) => (
  <Svg {...p}>
    <rect x="7" y="3.5" width="12" height="16" rx="2.5" transform="rotate(8 13 11.5)" />
    <rect x="4" y="4.5" width="12" height="16" rx="2.5" transform="rotate(-6 10 12.5)" />
  </Svg>
);

/** Always-visible longevity: "🔥 204 gün" (curated classics without dates → "★ Efsane"). */
export function DaysBadge({ ad, className = "" }: { ad: Ad; className?: string }) {
  if (ad.activeDays !== undefined) {
    return (
      <span
        title={daysLabel(ad)}
        className={`inline-flex shrink-0 items-center gap-0.5 rounded-full bg-black/50 px-1.5 py-[3px] text-[11px] font-bold leading-none text-orange-200 ring-1 ring-white/10 backdrop-blur-sm ${className}`}
        data-days=""
      >
        <FlameIcon size={11} filled className="text-orange-400" /> {ad.activeDays} gün
      </span>
    );
  }
  if (ad.source === "curated") {
    return <span className={`inline-flex shrink-0 items-center rounded-full bg-amber-300/90 px-1.5 py-[3px] text-[11px] font-bold leading-none text-black ${className}`}>★ Efsane</span>;
  }
  return null;
}

/** Brand avatar + name + days pill, for overlays on media. */
export function BrandLine({ ad, size = 26 }: { ad: Ad; size?: number }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <BrandAvatar name={ad.brand.name} logoUrl={ad.brand.logoUrl} size={size} className="!ring-1" />
      <span className="text-shadow truncate text-[14px] font-bold leading-tight">{ad.brand.name}</span>
      <DaysBadge ad={ad} />
    </span>
  );
}

export function SaveShareIcons({ ad, className = "", dark }: { ad: Ad; className?: string; dark?: boolean }) {
  const ui = useUI();
  const saved = useSaved();
  const isSaved = Boolean(saved.items[ad.id]);
  const btn = `grid size-8 place-items-center rounded-full ring-1 transition ${dark ? "bg-black/40 ring-white/10 backdrop-blur-sm hover:bg-black/60" : "bg-white/[0.06] ring-white/10 hover:bg-white/[0.12]"}`;
  return (
    <span className={`flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          ui.toggleSave(ad);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          ui.openSave(ad);
        }}
        aria-label={isSaved ? "Kayıtlı" : "Kaydet"}
        aria-pressed={isSaved}
        title={isSaved ? "Kayıtlı" : "Kaydet"}
        className={`${btn} ${isSaved ? "!bg-volt/15 text-volt !ring-volt/40" : "text-white"}`}
      >
        <BookmarkIcon size={15} filled={isSaved} />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          ui.share(ad);
        }}
        aria-label="Paylaş"
        title="Paylaş"
        className={`${btn} text-white`}
      >
        <ShareIcon size={14} />
      </button>
    </span>
  );
}

/** Thumbnail tile used in the Round 1 summary, the winner screen and the history. */
export function AdTile({ ad, onOpen, tag, highlight }: { ad: Ad; onOpen: (ad: Ad) => void; tag?: string; highlight?: boolean }) {
  return (
    <li className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-ink-2 ${highlight ? "border-amber-300/60" : "border-line"}`} data-tile={ad.id}>
      <button type="button" onClick={() => onOpen(ad)} className="relative block text-left" aria-label={`${ad.brand.name} detayları`}>
        <AdThumb ad={ad} />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent" />
        <span className="absolute bottom-2 left-2">
          <DaysBadge ad={ad} />
        </span>
        {tag && <span className="absolute right-2 top-2 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur">{tag}</span>}
      </button>
      <div className="flex items-center gap-1.5 px-2 py-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{ad.brand.name}</span>
        <SaveShareIcons ad={ad} />
      </div>
    </li>
  );
}
