"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Ad } from "@/lib/types";
import { brandFeedPath, daysLabel, firstLine } from "@/lib/format";
import { scoreTier } from "@/lib/score";
import { useSaved } from "@/lib/saved";
import { adYouTubeId } from "@/lib/youtube";
import { AdMediaView, type MediaMode, type Preload } from "./AdMediaView";
import { BrandAvatar, TIER_COLOR } from "./Bits";
import { BookmarkIcon, FlameIcon, InfoIcon, MuteIcon, ShareIcon, VolumeIcon } from "./Icons";
import { isBrandish } from "./TextCard";
import { useUI } from "./UIProvider";

const LONG_PRESS_MS = 550;

/**
 * One feed slide: the media is the hero. The default overlay is deliberately slim — brand +
 * longevity pill + one headline line bottom-left, a small icon rail on the right and a low
 * gradient. Everything else lives in the info sheet (`onInfo`). Long-press anywhere on the media
 * toggles "temiz mod" (`onLongPress`), which hides the overlay entirely; a plain tap still
 * pauses / plays the video.
 */
export function AdCard({
  ad,
  active,
  preload = active ? "auto" : "metadata",
  muted,
  onToggleMute,
  onInfo,
  clean = false,
  onLongPress,
}: {
  ad: Ad;
  active: boolean;
  preload?: Preload;
  muted: boolean;
  onToggleMute: () => void;
  onInfo: () => void;
  clean?: boolean;
  onLongPress?: () => void;
}) {
  const ui = useUI();
  const saved = useSaved();
  const isSaved = Boolean(saved.items[ad.id]);
  const [mode, setMode] = useState<MediaMode>(ad.media.length ? "image" : "text");
  const onMode = useCallback((m: MediaMode) => setMode(m), []);
  const bar = useRef<HTMLDivElement>(null);
  const last = useRef(0);
  const onProgress = useCallback((p: number) => {
    const el = bar.current;
    if (!el) return;
    const v = Math.max(0, Math.min(1, p));
    el.style.transitionDuration = v < last.current ? "0ms" : ""; // no backwards sweep on loop
    el.style.transform = `scaleX(${v})`;
    last.current = v;
  }, []);
  const press = useLongPress(onLongPress);
  const isYouTube = Boolean(adYouTubeId(ad));
  const hasVideo = mode === "video";
  const textMode = mode === "text";
  const line = !textMode ? overlayLine(ad) : undefined;

  return (
    <article
      className="relative h-full w-full select-none overflow-hidden bg-ink [-webkit-touch-callout:none]"
      aria-label={`${ad.brand.name} reklamı`}
      data-clean={clean ? "" : undefined}
    >
      <div className="absolute inset-0" {...press}>
        <AdMediaView ad={ad} active={active} preload={preload} muted={muted} onMode={onMode} onProgress={onProgress} />
      </div>

      {!clean && (
        <>
          {/* low legibility gradient — bottom ~18% only */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[18%] bg-gradient-to-t from-black/70 via-black/25 to-transparent" />

          {/* right action rail */}
          <div className="absolute bottom-4 right-2 z-20 flex flex-col items-center gap-2.5" data-rail="">
            <RailButton
              label={isSaved ? "Kayıtlı" : "Kaydet"}
              active={isSaved}
              onClick={() => ui.toggleSave(ad)}
              onContextMenu={(e) => {
                e.preventDefault();
                ui.openSave(ad);
              }}
            >
              <BookmarkIcon size={19} filled={isSaved} className={isSaved ? "animate-pop text-volt" : ""} />
            </RailButton>
            <RailButton label="Paylaş" onClick={() => ui.share(ad)}>
              <ShareIcon size={18} />
            </RailButton>
            <RailButton label="Detaylar" onClick={onInfo} badge={<ScoreBadge ad={ad} />}>
              <InfoIcon size={20} />
            </RailButton>
            {hasVideo && (
              <RailButton label={muted ? "Sesi aç" : "Sesi kapat"} onClick={onToggleMute}>
                {muted ? <MuteIcon size={19} /> : <VolumeIcon size={19} />}
              </RailButton>
            )}
          </div>

          {/* bottom-left: brand · longevity, one headline line */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 pb-4 pr-14" data-overlay="">
            <div className="pointer-events-auto flex min-w-0 items-center gap-2">
              <Link href={brandFeedPath(ad.brand.name)} className="flex min-w-0 items-center gap-2" aria-label={`${ad.brand.name} reklamları`}>
                <BrandAvatar name={ad.brand.name} logoUrl={ad.brand.logoUrl} size={26} className="!ring-1" />
                <span className="text-shadow truncate text-[14px] font-bold leading-tight">{ad.brand.name}</span>
              </Link>
              <DaysPill ad={ad} />
            </div>
            {line && (
              <button
                type="button"
                onClick={onInfo}
                className="text-shadow pointer-events-auto mt-1 block w-full truncate text-left text-[13px] leading-snug text-white/85"
                aria-label={`Detaylar: ${line}`}
              >
                {line}
              </button>
            )}
          </div>
        </>
      )}

      {/* TikTok-style playback progress, above every overlay */}
      {hasVideo && !isYouTube && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-[2px] bg-white/15" aria-hidden="true">
          <div ref={bar} className="h-full origin-left bg-white/90 transition-transform duration-300 ease-linear" style={{ transform: "scaleX(0)" }} />
        </div>
      )}
    </article>
  );
}

/** The one line of copy shown on the slide: the headline, or the body's first line when the headline is just the brand. */
function overlayLine(ad: Ad): string | undefined {
  if (ad.headline && !isBrandish(ad.headline, ad.brand.name)) return ad.headline;
  return firstLine(ad.body) ?? ad.headline;
}

/** Always-visible longevity signal ("🔥 204 gün"); curated classics without dates get "Efsane". */
export function DaysPill({ ad }: { ad: Ad }) {
  if (ad.activeDays !== undefined) {
    return (
      <span
        title={daysLabel(ad)}
        className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-black/45 px-1.5 py-[3px] text-[11px] font-bold leading-none text-orange-200 ring-1 ring-white/10 backdrop-blur-sm"
        data-days=""
      >
        <FlameIcon size={11} filled className="text-orange-400" /> {ad.activeDays} gün
      </span>
    );
  }
  if (ad.source === "curated") {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-amber-300/90 px-1.5 py-[3px] text-[11px] font-bold leading-none text-black" data-days="">
        ★ Efsane
      </span>
    );
  }
  return null;
}

function ScoreBadge({ ad }: { ad: Ad }) {
  if (ad.source === "curated") {
    return <span className="rounded-full bg-amber-300 px-1 text-[9px] font-black leading-[13px] text-black">★</span>;
  }
  const s = ad.performance.score;
  return (
    <span className="rounded-full bg-black/80 px-1 text-[9px] font-black tabular-nums leading-[13px] ring-1 ring-white/10" style={{ color: TIER_COLOR[scoreTier(s)] }}>
      {s}
    </span>
  );
}

function RailButton({
  label,
  active,
  badge,
  children,
  onClick,
  onContextMenu,
}: {
  label: string;
  active?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`relative grid size-9 place-items-center rounded-full text-white ring-1 backdrop-blur-sm transition ${active ? "bg-volt/15 ring-volt/40" : "bg-black/30 ring-white/10 hover:bg-black/50"}`}
    >
      {children}
      {badge && <span className="pointer-events-none absolute -bottom-1.5 left-1/2 -translate-x-1/2">{badge}</span>}
    </button>
  );
}

/**
 * Long-press on the media fires `cb` once and swallows the click that follows, so tap-to-pause
 * keeps working for short taps. Moving (scrolling) cancels the press.
 */
function useLongPress(cb?: () => void) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cbRef = useRef(cb);
  useEffect(() => {
    cbRef.current = cb;
  });
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const cancel = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    start.current = null;
  };
  if (!cb) return {};
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button, a")) return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        fired.current = true;
        timer.current = undefined;
        cbRef.current?.();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture: (e: React.MouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
    onContextMenu: (e: React.MouseEvent) => {
      // Touch long-press would otherwise open the browser's image/video menu.
      if (timer.current !== undefined || fired.current) e.preventDefault();
    },
  };
}
