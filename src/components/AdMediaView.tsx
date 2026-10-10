"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Ad } from "@/lib/types";
import { TextCard } from "./TextCard";
import { ChevronDownIcon, PlaySolidIcon } from "./Icons";
import { adYouTubeId, ytEmbedUrl, ytPoster } from "@/lib/youtube";

export type MediaMode = "text" | "image" | "video";
export type Preload = "auto" | "metadata" | "none";

type Slide = { kind: "video"; src: string; poster?: string } | { kind: "image"; src: string };

/**
 * Renders an ad's media inline. Every slide degrades silently: a video that fails (expired
 * fbcdn / tiktokcdn URL) becomes its poster image, an image that fails tries its thumbnail
 * (we host a copy under /media/meta), and when nothing is left the styled TextCard is shown.
 *
 * Fit: near-9:16 media fills the slide (object-cover); other aspects are shown whole over a blurred copy.
 *
 * Video: autoplays muted (playsInline) while `active`, tap = pause/play, mute state comes from
 * the parent so unmuting persists across slides. Playback progress is reported through
 * `onProgress` (0..1) so the card can draw a TikTok-style bar above its own overlays.
 */
export function AdMediaView({
  ad,
  active,
  preload,
  muted,
  onMode,
  onProgress,
}: {
  ad: Ad;
  active: boolean;
  preload: Preload;
  muted: boolean;
  onMode?: (mode: MediaMode) => void;
  onProgress?: (p: number) => void;
}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const fail = useCallback((src: string) => setFailed((f) => (f.has(src) ? f : new Set(f).add(src))), []);

  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [];
    const used = new Set<string>();
    const ok = (u?: string) => (u && !failed.has(u) && !used.has(u) ? u : undefined);
    for (const m of ad.media) {
      if (m.type === "video" && ok(m.url)) {
        const poster = m.thumbnailUrl && !failed.has(m.thumbnailUrl) ? m.thumbnailUrl : undefined;
        used.add(m.url);
        out.push(poster ? { kind: "video", src: m.url, poster } : { kind: "video", src: m.url });
        continue;
      }
      const src = m.type === "video" ? ok(m.thumbnailUrl) : (ok(m.url) ?? ok(m.thumbnailUrl));
      if (src) {
        used.add(src);
        out.push({ kind: "image", src });
      }
    }
    return out;
  }, [ad.media, failed]);

  const yt = adYouTubeId(ad);
  const ytOk = Boolean(yt) && !failed.has(`yt:${yt}`);
  const mode: MediaMode = ytOk ? "video" : !slides.length ? "text" : slides.some((s) => s.kind === "video") ? "video" : "image";
  useEffect(() => {
    onMode?.(mode);
  }, [mode, onMode]);

  if (yt && ytOk) return <YouTubeSlide id={yt} active={active} muted={muted} onFail={() => fail(`yt:${yt}`)} />;
  if (!slides.length) return <TextCard ad={ad} reason={ad.media.length ? "expired" : "missing"} />;
  if (slides.length === 1) {
    const s = slides[0];
    return s.kind === "video" ? (
      <VideoSlide slide={s} active={active} preload={preload} muted={muted} onFail={fail} onProgress={onProgress} />
    ) : (
      <ImageSlide src={s.src} eager={preload !== "none"} onFail={fail} />
    );
  }
  return <Carousel slides={slides} active={active} preload={preload} muted={muted} onFail={fail} onProgress={onProgress} />;
}

/**
 * Fill vs. fit: media whose aspect is close to the slide's (e.g. 9:16 on a phone) is cropped to
 * fill the screen like TikTok/Reels; anything else (1:1, 4:5, 16:9) is shown whole (contain) over a
 * blurred, scaled copy of itself so nothing important gets cut off.
 */
const COVER_TOLERANCE = 1.25; // fill when at most ~20% of either side would be cropped

function useFit() {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState(0);
  const [media, setMedia] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => el.clientWidth && el.clientHeight && setBox(el.clientWidth / el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const strong = useRef(false);
  /** `weak` sizes (a video's poster) never override the real media's own dimensions. */
  const setSize = useCallback((w: number, h: number, weak = false) => {
    if (!(w > 0 && h > 0) || (weak && strong.current)) return;
    if (!weak) strong.current = true;
    setMedia(w / h);
  }, []);
  const r = box && media ? media / box : 0;
  const cover = r > 0 && r <= COVER_TOLERANCE && r >= 1 / COVER_TOLERANCE;
  return { ref, setSize, cover, known: r > 0 };
}

function Backdrop({ src }: { src?: string }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      referrerPolicy="no-referrer"
      data-backdrop=""
      className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-2xl"
      onError={() => setBad(true)}
    />
  );
}

function ImageSlide({ src, eager, onFail }: { src: string; eager: boolean; onFail: (src: string) => void }) {
  const [loaded, setLoaded] = useState(false);
  const fit = useFit();
  const img = useRef<HTMLImageElement>(null);
  const { setSize } = fit;
  // SSR'd pages (/ad/[id]): the image may finish loading before hydration attaches onLoad.
  useEffect(() => {
    const el = img.current;
    if (el?.complete && el.naturalWidth) {
      setSize(el.naturalWidth, el.naturalHeight);
      setLoaded(true);
    }
  }, [setSize]);
  return (
    <div ref={fit.ref} className="relative h-full w-full overflow-hidden bg-ink-3" data-fit={fit.known ? (fit.cover ? "cover" : "contain") : undefined}>
      {!loaded && <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-white/[0.04] to-transparent" />}
      {!fit.cover && (
        <>
          <Backdrop src={src} />
          <div className="pointer-events-none absolute inset-0 bg-black/25" />
        </>
      )}
      <img
        ref={img}
        src={src}
        alt=""
        draggable={false}
        loading={eager ? "eager" : "lazy"}
        referrerPolicy="no-referrer"
        onLoad={(e) => {
          fit.setSize(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
          setLoaded(true);
        }}
        onError={() => onFail(src)}
        className={`relative h-full w-full select-none transition-opacity duration-300 ${fit.cover ? "object-cover" : "object-contain"} ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}

function VideoSlide({
  slide,
  active,
  preload,
  muted,
  onFail,
  onProgress,
}: {
  slide: Extract<Slide, { kind: "video" }>;
  active: boolean;
  preload: Preload;
  muted: boolean;
  onFail: (src: string) => void;
  onProgress?: (p: number) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLCanvasElement>(null);
  const posterRef = useRef<HTMLImageElement>(null);
  const fit = useFit();
  const { setSize } = fit;
  // SSR'd pages (/ad/[id]): metadata / poster may be ready before hydration attaches the handlers.
  useEffect(() => {
    const v = ref.current;
    const p = posterRef.current;
    if (v && v.readyState >= 1 && v.videoWidth) setSize(v.videoWidth, v.videoHeight);
    else if (p?.complete && p.naturalWidth) setSize(p.naturalWidth, p.naturalHeight, true);
  }, [setSize]);
  const [playing, setPlaying] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  // Autoplay with sound can be refused without a fresh gesture (iOS); then we play muted locally.
  const [forcedMute, setForcedMute] = useState(false);
  const effectiveMuted = muted || forcedMute;

  // Unmuting from a tap is a user gesture — drop the local fallback mute.
  useEffect(() => {
    if (muted) setForcedMute(false);
  }, [muted]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = effectiveMuted;
    v.defaultMuted = true;
  }, [effectiveMuted]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active && !userPaused) {
      v.muted = effectiveMuted;
      const p = v.play();
      if (p)
        p.catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "NotAllowedError" && !v.muted) {
            v.muted = true;
            setForcedMute(true);
            v.play().catch(() => {
              /* still blocked — poster stays, tap plays */
            });
          }
          /* AbortError (src swapped / paused while loading) is harmless */
        });
    } else {
      v.pause();
    }
  }, [active, userPaused, effectiveMuted]);

  // Leaving the slide: rewind and forget the manual pause.
  useEffect(() => {
    if (active) return;
    setUserPaused(false);
    const v = ref.current;
    if (v && v.currentTime > 0) v.currentTime = 0;
    onProgress?.(0);
  }, [active, onProgress]);

  return (
    <div
      ref={fit.ref}
      className="relative h-full w-full overflow-hidden bg-black"
      data-fit={fit.known ? (fit.cover ? "cover" : "contain") : undefined}
      onClick={() => {
        if (!active) return;
        if (forcedMute) {
          // This tap is the gesture the browser wanted: play with sound now.
          setForcedMute(false);
          setUserPaused(false);
          const v = ref.current;
          if (v) {
            v.muted = false;
            v.play().catch(() => {});
          }
          return;
        }
        setUserPaused((x) => !x);
      }}
      data-video-slide=""
    >
      {/* No poster: a tiny copy of the first frame, blurred, is the backdrop (always mounted so it can be drawn). */}
      {!slide.poster && (
        <canvas
          ref={frame}
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-2xl ${fit.cover ? "hidden" : ""}`}
        />
      )}
      {!fit.cover && (
        <>
          {slide.poster && <Backdrop src={slide.poster} />}
          <div className="pointer-events-none absolute inset-0 bg-black/25" />
        </>
      )}
      {/* poster as a real <img>: no black/broken frame while the video loads or if it fails */}
      {slide.poster && !playing && (
        <img
          ref={posterRef}
          src={slide.poster}
          alt=""
          aria-hidden="true"
          referrerPolicy="no-referrer"
          onLoad={(e) => fit.setSize(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight, true)}
          className={`absolute inset-0 h-full w-full ${fit.cover ? "object-cover" : "object-contain"}`}
        />
      )}
      {!slide.poster && !playing && <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-white/[0.05] to-transparent" />}
      <video
        ref={ref}
        src={slide.src}
        muted
        loop
        playsInline
        disablePictureInPicture
        controlsList="nodownload noplaybackrate noremoteplayback"
        preload={preload}
        onPlaying={() => setPlaying(true)}
        onLoadedMetadata={(e) => fit.setSize(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
        onLoadedData={(e) => {
          const c = frame.current;
          const v = e.currentTarget;
          if (!c || !v.videoWidth) return;
          c.width = 32;
          c.height = Math.max(1, Math.round((32 * v.videoHeight) / v.videoWidth));
          try {
            c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
          } catch {
            /* drawing is best-effort */
          }
        }}
        onError={() => onFail(slide.src)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (active && v.duration) onProgress?.(v.currentTime / v.duration);
        }}
        className={`relative h-full w-full transition-opacity duration-200 ${fit.cover ? "object-cover" : "object-contain"} ${playing ? "opacity-100" : "opacity-0"}`}
      />
      {active && userPaused && (
        <span className="pointer-events-none absolute left-1/2 top-1/2 grid size-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
          <PlaySolidIcon size={34} className="translate-x-0.5" />
        </span>
      )}
      {active && effectiveMuted && !muted && (
        <span className="pointer-events-none absolute left-1/2 top-1/2 mt-14 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-[11px] font-semibold text-white/85 backdrop-blur">
          Ses için dokun
        </span>
      )}
    </div>
  );
}

function Carousel({
  slides,
  active,
  preload,
  muted,
  onFail,
  onProgress,
}: {
  slides: Slide[];
  active: boolean;
  preload: Preload;
  muted: boolean;
  onFail: (src: string) => void;
  onProgress?: (p: number) => void;
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
        {slides.map((s, i) => {
          // Only the visible slide (and its right neighbour) gets to load eagerly.
          const slidePreload: Preload = i === current ? preload : i === current + 1 && preload !== "none" ? "metadata" : "none";
          return (
            <div key={s.src + i} className="h-full w-full shrink-0 snap-center snap-always">
              {s.kind === "video" ? (
                <VideoSlide slide={s} active={active && i === current} preload={slidePreload} muted={muted} onFail={onFail} onProgress={onProgress} />
              ) : (
                <ImageSlide src={s.src} eager={preload !== "none" && i <= current + 1} onFail={onFail} />
              )}
            </div>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-[calc(max(0.75rem,env(safe-area-inset-top))+0.9rem)] flex justify-center gap-1.5" data-carousel-dots="">
        {slides.length <= 12 ? (
          slides.map((s, i) => <span key={s.src + i} className={`h-1 rounded-full shadow transition-all ${i === current ? "w-4 bg-white" : "w-1 bg-white/45"}`} />)
        ) : (
          <span className="-mt-1.5 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white/90 backdrop-blur">
            {current + 1}/{slides.length}
          </span>
        )}
      </div>
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

/**
 * YouTube creatives (curated classics): poster until active, then a privacy-enhanced embed that
 * autoplays muted. Mute state is synced through the IFrame API (postMessage), no reload needed.
 */
function YouTubeSlide({ id, active, muted, onFail }: { id: string; active: boolean; muted: boolean; onFail: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [src] = useState(() => ytEmbedUrl(id, true));
  const poster = ytPoster(id);

  useEffect(() => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    const cmd = (func: string) => w.postMessage(JSON.stringify({ event: "command", func, args: [] }), "*");
    cmd(muted ? "mute" : "unMute");
    if (!muted) cmd("playVideo");
  }, [muted, active]);

  return (
    <div className="relative grid h-full w-full place-items-center overflow-hidden bg-black pb-12 pt-12" data-fit="contain">
      <Backdrop src={poster} />
      <div className="pointer-events-none absolute inset-0 bg-black/25" />
      <div className="relative aspect-video w-full overflow-hidden shadow-2xl shadow-black/60">
        <img src={poster} alt="" referrerPolicy="no-referrer" onError={onFail} className="absolute inset-0 h-full w-full object-cover" />
        {active && (
          <iframe
            ref={frame}
            src={src}
            title="YouTube video"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => {
              const w = frame.current?.contentWindow;
              if (w && !muted) w.postMessage(JSON.stringify({ event: "command", func: "unMute", args: [] }), "*");
            }}
            className="absolute inset-0 h-full w-full border-0"
          />
        )}
      </div>
    </div>
  );
}
