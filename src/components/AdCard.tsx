"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { Ad } from "@/lib/types";
import { MARKET_LABEL, SEGMENT_LABEL, SOURCE_LABEL, FORMAT_LABEL, verticalLabel } from "@/lib/filters";
import { brandFeedPath, daysLabel, displayReasons, formatDate, libraryLabel, platformLabel } from "@/lib/format";
import { useSaved } from "@/lib/saved";
import { AdMediaView, type MediaMode } from "./AdMediaView";
import { AdScore, BrandAvatar, Chip } from "./Bits";
import { BookmarkIcon, ExternalIcon, FlameIcon, MuteIcon, ShareIcon, VolumeIcon } from "./Icons";
import { useUI } from "./UIProvider";

export function AdCard({
  ad,
  active,
  near = active,
  muted,
  onToggleMute,
}: {
  ad: Ad;
  active: boolean;
  near?: boolean;
  muted: boolean;
  onToggleMute: () => void;
}) {
  const ui = useUI();
  const saved = useSaved();
  const isSaved = Boolean(saved.items[ad.id]);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<MediaMode>(ad.media.length ? "image" : "text");
  const onMode = useCallback((m: MediaMode) => setMode(m), []);
  const hasVideo = mode === "video";
  const textMode = mode === "text";
  const days = daysLabel(ad);
  const bodyText = ad.body ?? "";
  const long = bodyText.length > 110 || bodyText.includes("\n");

  return (
    <article className="relative h-full w-full overflow-hidden bg-ink" aria-label={`${ad.brand.name} reklamı`}>
      <div className="absolute inset-0">
        <AdMediaView ad={ad} active={active} near={near} muted={muted} onToggleMute={onToggleMute} onMode={onMode} />
      </div>

      {/* legibility gradients */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/60 to-transparent" />
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent transition-all duration-300 ${expanded ? "h-[85%]" : textMode ? "h-[34%]" : "h-[58%]"}`}
      />

      {/* right action rail */}
      <div className="absolute bottom-6 right-3 z-20 flex flex-col items-center gap-4">
        <div className="flex flex-col items-center gap-1">
          <AdScore ad={ad} size={46} />
          <span className="text-shadow text-[10px] font-semibold text-white/80">{ad.source === "curated" ? "Efsane" : "Skor"}</span>
        </div>
        <RailButton
          label={isSaved ? "Kayıtlı" : "Kaydet"}
          active={isSaved}
          onClick={() => ui.toggleSave(ad)}
          onContextMenu={(e) => {
            e.preventDefault();
            ui.openSave(ad);
          }}
        >
          <BookmarkIcon size={24} filled={isSaved} className={isSaved ? "animate-pop text-volt" : ""} />
        </RailButton>
        <RailButton label="Paylaş" onClick={() => ui.share(ad)}>
          <ShareIcon size={22} />
        </RailButton>
        {hasVideo && (
          <RailButton label={muted ? "Ses kapalı" : "Ses açık"} onClick={onToggleMute}>
            {muted ? <MuteIcon size={22} /> : <VolumeIcon size={22} />}
          </RailButton>
        )}
      </div>

      {/* bottom info */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-5 pr-[4.75rem]">
        <div className="mb-2.5 flex items-center gap-2.5">
          <Link href={brandFeedPath(ad.brand.name)} className="shrink-0" aria-label={`${ad.brand.name} reklamları`}>
            <BrandAvatar name={ad.brand.name} logoUrl={ad.brand.logoUrl} size={38} />
          </Link>
          <div className="min-w-0">
            <Link href={brandFeedPath(ad.brand.name)} className="text-shadow block truncate text-[15px] font-bold leading-tight hover:underline">
              {ad.brand.name}
            </Link>
            <p className="text-shadow truncate text-xs text-white/65">
              {[ad.brand.handle, SOURCE_LABEL[ad.source], ad.platforms?.length ? ad.platforms.map(platformLabel).slice(0, 2).join(" · ") : undefined]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>

        <div className="no-scrollbar -mx-4 mb-2.5 flex gap-1.5 overflow-x-auto px-4">
          <Chip tone="volt">{SEGMENT_LABEL[ad.segment]}</Chip>
          <Chip>{MARKET_LABEL[ad.market]}</Chip>
          {ad.vertical && <Chip>{verticalLabel(ad.vertical)}</Chip>}
          <Chip>{FORMAT_LABEL[ad.format]}</Chip>
          {days && !textMode && (
            <Chip tone="ember">
              <FlameIcon size={11} filled /> {days}
            </Chip>
          )}
        </div>

        {ad.headline && !textMode && <h3 className="text-shadow mb-1 text-[17px] font-bold leading-snug text-white">{ad.headline}</h3>}

        {bodyText && (
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            className="block w-full text-left"
            aria-expanded={expanded}
          >
            <p
              className={`text-shadow whitespace-pre-line text-[14px] leading-relaxed text-white/85 ${expanded ? "thin-scrollbar max-h-[34dvh] overflow-y-auto pr-1" : "line-clamp-2"}`}
            >
              {bodyText}
            </p>
            {(long || !expanded) && (
              <span className="mt-0.5 inline-block text-[13px] font-semibold text-white/60">{expanded ? "daha az" : long ? "devamı" : "detaylar"}</span>
            )}
          </button>
        )}

        {!bodyText && textMode && (
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            aria-expanded={expanded}
            className="text-shadow text-[13px] font-semibold text-white/70 hover:text-white"
          >
            {expanded ? "Gizle" : "Neden kazanıyor? →"}
          </button>
        )}

        {(expanded || (!bodyText && !textMode)) && (
          <div className="animate-fade-in mt-3 rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/10 backdrop-blur-md">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-volt">Neden kazanıyor?</p>
            <div className="flex flex-wrap gap-1.5">
              {displayReasons(ad).length ? (
                displayReasons(ad).map((r) => (
                  <Chip key={r} tone="solid">
                    {r}
                  </Chip>
                ))
              ) : (
                <span className="text-xs text-white/60">Sinyal verisi yok</span>
              )}
            </div>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-white/60">
              {ad.startedAt && (
                <>
                  <dt>Başlangıç</dt>
                  <dd className="text-right text-white/85">{formatDate(ad.startedAt)}</dd>
                </>
              )}
              {ad.variations !== undefined && (
                <>
                  <dt>Varyasyon</dt>
                  <dd className="text-right text-white/85">{ad.variations}</dd>
                </>
              )}
              {ad.platforms?.length ? (
                <>
                  <dt>Platform</dt>
                  <dd className="truncate text-right text-white/85">{ad.platforms.map(platformLabel).join(", ")}</dd>
                </>
              ) : null}
            </dl>
          </div>
        )}

        <div className={`mt-3 flex items-center gap-2 ${textMode && !ad.cta ? "hidden" : ""}`}>
          {ad.cta &&
            (ad.landingUrl ? (
              <a
                href={ad.landingUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="flex h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-xl bg-white px-4 text-sm font-bold text-black transition hover:bg-volt"
              >
                <span className="truncate">{ad.cta}</span>
                <span aria-hidden="true">→</span>
              </a>
            ) : (
              <span className="flex h-10 min-w-0 flex-1 items-center rounded-xl bg-white/90 px-4 text-sm font-bold text-black">
                <span className="truncate">{ad.cta}</span>
              </span>
            ))}
          {!textMode && (
          <a
            href={ad.libraryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-white/10 px-3 text-[13px] font-semibold text-white ring-1 ring-white/15 backdrop-blur-md transition hover:bg-white/20 ${ad.cta ? "" : "flex-1 justify-center"}`}
          >
            {libraryLabel(ad)} <ExternalIcon size={14} />
          </a>
          )}
        </div>
      </div>
    </article>
  );
}

function RailButton({
  label,
  active,
  children,
  onClick,
  onContextMenu,
}: {
  label: string;
  active?: boolean;
  children: React.ReactNode;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button type="button" onClick={onClick} onContextMenu={onContextMenu} className="flex flex-col items-center gap-1" aria-label={label} aria-pressed={active}>
      <span
        className={`grid size-12 place-items-center rounded-full ring-1 backdrop-blur-md transition ${active ? "bg-volt/15 ring-volt/40" : "bg-black/35 ring-white/15 hover:bg-black/55"} text-white`}
      >
        {children}
      </span>
      <span className="text-shadow text-[10px] font-semibold text-white/80">{label}</span>
    </button>
  );
}
