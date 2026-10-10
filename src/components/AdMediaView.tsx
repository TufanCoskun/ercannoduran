"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Ad } from "@/lib/types";
import { TextCard } from "./TextCard";
import { ChevronDownIcon } from "./Icons";

type Slide = { kind: "video"; src: string; poster?: string } | { kind: "image"; src: string };

/**
 * Renders an ad's media. Every slide degrades gracefully: a video that fails (expired fbcdn /
 * tiktokcdn URL) falls back to its thumbnail, an image that fails is dropped, and when nothing
 * is left we render the styled TextCard.
 */
export function AdMediaView({
  ad,
  active,
  near,
  muted,
  onToggleMute,
  onVideoState,
}: {
  ad: Ad;
  active: boolean;
  near: boolean;
  muted: boolean;
  onToggleMute?: () => void;
  onVideoState?: (hasVideo: boolean) => void;
}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const fail = useCallback((src: string) => setFailed((f) => (f.has(src) ? f : new Set(f).add(src))), []);

  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [];
    for (const m of ad.media) {
      if (m.type === "video") {
        if (!failed.has(m.url)) out.push({ kind: "video", src: m.url, poster: m.thumbnailUrl && !failed.has(m.thumbnailUrl) ? m.thumbnailUrl : undefined });
        else if (m.thumbnailUrl && !failed.has(m.thumbnailUrl)) out.push({ kind: "image", src: m.thumbnailUrl });
      } else if (!failed.has(m.url)) out.push({ kind: "image", src: m.url });
    }
    return out;
  }, [ad.media, failed]);

  const hasVideo = slides.some((s) => s.kind === "video");
  useEffect(() => {
    onVideoState?.(hasVideo);
  }, [hasVideo, onVideoState]);

  if (!slides.length) return <TextCard ad={ad} reason={ad.media.length ? "expired" : "missing"} />;
  if (slides.length === 1) {
    const s = slides[0];
    return s.kind === "video" ? (
      <VideoSlide slide={s} active={active} near={near} muted={muted} onFail={fail} onTap={onToggleMute} />
    ) : (
      <ImageSlide src={s.src} eager={near} onFail={fail} />
    );
  }
  return <Carousel slides={slides} active={active} near={near} muted={muted} onFail={fail} onToggleMute={onToggleMute} />;
}

function Backdrop({ src }: { src?: string }) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      referrerPolicy="no-referrer"
      className="absolute inset-0 h-full w-full scale-125 object-cover opacity-45 blur-2xl"
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  );
}

function ImageSlide({ src, eager, onFail }: { src: string; eager: boolean; onFail: (src: string) => void }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative h-full w-full overflow-hidden bg-ink-3">
      {!loaded && <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-white/[0.04] to-transparent" />}
      <Backdrop src={src} />
      <img
        src={src}
        alt=""
        draggable={false}
        loading={eager ? "eager" : "lazy"}
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        onError={() => onFail(src)}
        className={`relative h-full w-full select-none object-contain transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}

function VideoSlide({
  slide,
  active,
  near,
  muted,
  onFail,
  onTap,
}: {
  slide: Extract<Slide, { kind: "video" }>;
  active: boolean;
  near: boolean;
  muted: boolean;
  onFail: (src: string) => void;
  onTap?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active) {
      v.play().catch(() => {
        /* autoplay blocked — poster stays visible */
      });
    } else {
      v.pause();
      if (!near) v.currentTime = 0;
    }
  }, [active, near]);

  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
  }, [muted]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black" onClick={onTap}>
      <Backdrop src={slide.poster} />
      <video
        ref={ref}
        src={slide.src}
        poster={slide.poster}
        muted={muted}
        loop
        playsInline
        preload={near ? "auto" : "metadata"}
        onLoadedData={() => setReady(true)}
        onError={() => onFail(slide.src)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.duration) setProgress(v.currentTime / v.duration);
        }}
        className="relative h-full w-full object-contain"
      />
      {!ready && !slide.poster && <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-white/[0.05] to-transparent" />}
      <div className="absolute inset-x-0 bottom-0 z-10 h-0.5 bg-white/10">
        <div className="h-full bg-white/80 transition-[width] duration-200 ease-linear" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}

function Carousel({
  slides,
  active,
  near,
  muted,
  onFail,
  onToggleMute,
}: {
  slides: Slide[];
  active: boolean;
  near: boolean;
  muted: boolean;
  onFail: (src: string) => void;
  onToggleMute?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const current = Math.min(index, slides.length - 1);

  const go = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const next = Math.max(0, Math.min(slides.length - 1, i));
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  };

  return (
    <div className="group relative h-full w-full">
      <div
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className="no-scrollbar flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
      >
        {slides.map((s, i) => (
          <div key={s.src + i} className="h-full w-full shrink-0 snap-center snap-always">
            {s.kind === "video" ? (
              <VideoSlide slide={s} active={active && i === current} near={near} muted={muted} onFail={onFail} onTap={onToggleMute} />
            ) : (
              <ImageSlide src={s.src} eager={near && i <= 1} onFail={onFail} />
            )}
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-[4.5rem] flex justify-center gap-1.5">
        {slides.map((s, i) => (
          <span key={s.src + i} className={`h-1.5 rounded-full transition-all ${i === current ? "w-5 bg-white" : "w-1.5 bg-white/40"}`} />
        ))}
      </div>
      <span className="pointer-events-none absolute right-3 top-[4.25rem] rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white/90 backdrop-blur">
        {current + 1}/{slides.length}
      </span>
      {current > 0 && (
        <button
          type="button"
          aria-label="Önceki görsel"
          onClick={() => go(current - 1)}
          className="absolute left-2 top-1/2 hidden size-9 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white backdrop-blur hover:bg-black/70 md:grid"
        >
          <ChevronDownIcon size={18} className="rotate-90" />
        </button>
      )}
      {current < slides.length - 1 && (
        <button
          type="button"
          aria-label="Sonraki görsel"
          onClick={() => go(current + 1)}
          className="absolute right-2 top-1/2 hidden size-9 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white backdrop-blur hover:bg-black/70 md:grid"
        >
          <ChevronDownIcon size={18} className="-rotate-90" />
        </button>
      )}
    </div>
  );
}
