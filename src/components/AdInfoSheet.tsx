"use client";

import Link from "next/link";
import type { Ad } from "@/lib/types";
import { FORMAT_LABEL, MARKET_LABEL, SEGMENT_LABEL, SOURCE_LABEL, effectiveFormat, verticalLabel } from "@/lib/filters";
import { adPath, brandFeedPath, daysLabel, displayReasons, formatDate, libraryLabel, platformLabel } from "@/lib/format";
import { useSaved } from "@/lib/saved";
import { AnalyzeButton } from "./AnalyzeButton";
import { AdScore, BrandAvatar, Chip } from "./Bits";
import { BookmarkIcon, ExternalIcon, FlameIcon, ShareIcon } from "./Icons";
import { Sheet } from "./Sheet";
import { useUI } from "./UIProvider";

/**
 * Everything the slim feed overlay leaves out: chips, longevity, score + reasons, full copy,
 * CTA and library links, save / share. Light scrim so the video keeps playing visibly behind it.
 */
export function AdInfoSheet({ ad, onClose }: { ad: Ad | null; onClose: () => void }) {
  if (!ad) return null;
  return (
    <Sheet open onClose={onClose} light label="Reklam detayları" title={<SheetTitle ad={ad} onNavigate={onClose} />}>
      <InfoBody ad={ad} onNavigate={onClose} />
    </Sheet>
  );
}

function SheetTitle({ ad, onNavigate }: { ad: Ad; onNavigate: () => void }) {
  return (
    <Link href={brandFeedPath(ad.brand.name)} onClick={onNavigate} className="flex min-w-0 items-center gap-2.5" aria-label={`${ad.brand.name} reklamları`}>
      <BrandAvatar name={ad.brand.name} logoUrl={ad.brand.logoUrl} size={36} />
      <span className="min-w-0">
        <span className="block truncate text-base font-bold leading-tight">{ad.brand.name}</span>
        <span className="block truncate text-xs font-normal text-mist">
          {[ad.brand.handle, SOURCE_LABEL[ad.source], ad.platforms?.length ? ad.platforms.map(platformLabel).slice(0, 2).join(" · ") : undefined]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
    </Link>
  );
}

function InfoBody({ ad, onNavigate }: { ad: Ad; onNavigate: () => void }) {
  const ui = useUI();
  const saved = useSaved();
  const isSaved = Boolean(saved.items[ad.id]);
  const days = daysLabel(ad);
  const reasons = displayReasons(ad);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <Chip tone="volt">{SEGMENT_LABEL[ad.segment]}</Chip>
        <Chip tone="solid">{MARKET_LABEL[ad.market]}</Chip>
        {ad.vertical && verticalLabel(ad.vertical) !== SEGMENT_LABEL[ad.segment] && <Chip tone="solid">{verticalLabel(ad.vertical)}</Chip>}
        <Chip tone="solid">{FORMAT_LABEL[effectiveFormat(ad)]}</Chip>
        {days && (
          <Chip tone="ember">
            <FlameIcon size={11} filled /> {days}
          </Chip>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-white/[0.03] p-3.5">
        <div className="flex items-center gap-3">
          <AdScore ad={ad} size={44} />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-volt">Neden kazanıyor?</p>
            <p className="text-xs text-mist">{ad.source === "curated" ? "Küratörlü klasik" : `Kazanan skoru ${ad.performance.score}/100`}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {reasons.length ? (
            reasons.map((r) => (
              <Chip key={r} tone="solid">
                {r}
              </Chip>
            ))
          ) : (
            <span className="text-xs text-mist">Sinyal verisi yok</span>
          )}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-mist">
          {ad.startedAt && (
            <>
              <dt>Başlangıç</dt>
              <dd className="text-right text-zinc-200">{formatDate(ad.startedAt)}</dd>
            </>
          )}
          {ad.variations !== undefined && (
            <>
              <dt>Varyasyon</dt>
              <dd className="text-right text-zinc-200">{ad.variations}</dd>
            </>
          )}
          {ad.platforms?.length ? (
            <>
              <dt>Platform</dt>
              <dd className="truncate text-right text-zinc-200">{ad.platforms.map(platformLabel).join(", ")}</dd>
            </>
          ) : null}
        </dl>
      </div>

      {(ad.headline || ad.body) && (
        <div>
          {ad.headline && <p className="text-[17px] font-bold leading-snug">{ad.headline}</p>}
          {ad.body && <p className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed text-zinc-300">{ad.body}</p>}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {ad.cta &&
          (ad.landingUrl ? (
            <a
              href={ad.landingUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="flex h-11 items-center justify-between gap-2 rounded-xl bg-white px-4 text-sm font-bold text-black transition hover:bg-volt"
            >
              <span className="truncate">{ad.cta}</span>
              <span aria-hidden="true">→</span>
            </a>
          ) : (
            <span className="flex h-11 items-center rounded-xl bg-white/90 px-4 text-sm font-bold text-black">
              <span className="truncate">{ad.cta}</span>
            </span>
          ))}
        <a
          href={ad.libraryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-white/[0.07] px-3 text-[13px] font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/[0.12]"
        >
          {libraryLabel(ad)} <ExternalIcon size={14} />
        </a>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => ui.toggleSave(ad)}
          aria-pressed={isSaved}
          className={`flex h-11 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold ring-1 transition ${isSaved ? "bg-volt/15 text-volt ring-volt/40" : "bg-white/[0.07] ring-white/10 hover:bg-white/[0.12]"}`}
        >
          <BookmarkIcon size={16} filled={isSaved} /> {isSaved ? "Kayıtlı" : "Kaydet"}
        </button>
        <button
          type="button"
          onClick={() => ui.share(ad)}
          className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-white/[0.07] text-[13px] font-semibold ring-1 ring-white/10 transition hover:bg-white/[0.12]"
        >
          <ShareIcon size={16} /> Paylaş
        </button>
        <Link
          href={adPath(ad.id)}
          onClick={onNavigate}
          className="flex h-11 items-center justify-center rounded-xl bg-white/[0.07] text-[13px] font-semibold ring-1 ring-white/10 transition hover:bg-white/[0.12]"
        >
          Detay
        </Link>
      </div>
      {isSaved && <AnalyzeButton adId={ad.id} variant="block" />}
    </div>
  );
}
