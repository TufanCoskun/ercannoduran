"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Ad } from "@/lib/types";
import { adTitle, firstLine } from "@/lib/format";
import { decide, lastSwipe, remainingIds, resolveAd, undoSwipe, type SwipeDir, type TinderSession } from "@/lib/tinder";
import { AdMediaView, type MediaMode, type Preload } from "../AdMediaView";
import { AdInfoSheet } from "../AdInfoSheet";
import { InfoIcon, MuteIcon, VolumeIcon, XIcon } from "../Icons";
import { useUI } from "../UIProvider";
import { BrandLine, CrossIcon, HeartIcon, SaveShareIcons, UndoIcon } from "./bits";

/** Carousel arrows sit under the gesture layer and can't be clicked here — hide them. */
const NO_ARROWS = "[&_button[aria-label$='görsel']]:!hidden";
const FLING_MS = 260;

type CardApi = { fling: (dir: SwipeDir, from?: { dx: number; dy: number; vx?: number }) => void };

/**
 * Round 1: a Tinder-style card stack. Only the top card is live (video autoplays muted, tap toggles
 * sound); the next one sits behind it fully preloaded and the third preloads metadata.
 */
export function SwipeDeck({
  session,
  live,
  onChange,
  onExit,
}: {
  session: TinderSession;
  live: ReadonlyMap<string, Ad>;
  onChange: (s: TinderSession) => void;
  onExit: () => void;
}) {
  const ui = useUI();
  const [muted, setMuted] = useState(true);
  const [infoAd, setInfoAd] = useState<Ad | null>(null);
  const [enter, setEnter] = useState<{ id: string; dir: SwipeDir } | null>(null);
  const [flash, setFlash] = useState<{ dir: SwipeDir; n: number } | null>(null);
  const clearEnter = useCallback(() => setEnter(null), []);
  const busy = useRef(false);
  const top = useRef<CardApi | null>(null);
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  });

  const deck = useMemo(
    () =>
      remainingIds(session)
        .slice(0, 3)
        .map((id) => resolveAd(session, id, live))
        .filter((a): a is Ad => Boolean(a)),
    [session, live],
  );
  const total = session.pool.length;
  const decided = session.round1.liked.length + session.round1.passed.length;
  const liked = session.round1.liked.length;
  const current = deck[0];
  const canUndo = decided > 0;

  const commit = useCallback(
    (ad: Ad, dir: SwipeDir) => {
      onChange(decide(sessionRef.current, ad.id, dir, ad));
      setFlash((f) => ({ dir, n: (f?.n ?? 0) + 1 }));
      busy.current = false;
    },
    [onChange],
  );

  const swipe = useCallback(
    (dir: SwipeDir) => {
      if (busy.current || !current) return;
      busy.current = true;
      if (top.current) top.current.fling(dir);
      else commit(current, dir);
    },
    [current, commit],
  );

  const undo = useCallback(() => {
    if (busy.current) return;
    const last = lastSwipe(sessionRef.current);
    if (!last) return;
    setEnter({ id: last.id, dir: last.dir });
    onChange(undoSwipe(sessionRef.current));
  }, [onChange]);

  // Keyboard: ←/→ swipe, Backspace/Z undo, M sound, I details, S save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      const k = e.key;
      if (k === "ArrowRight") {
        e.preventDefault();
        swipe("like");
      } else if (k === "ArrowLeft") {
        e.preventDefault();
        swipe("pass");
      } else if (k === "Backspace" || k === "z" || k === "Z") {
        e.preventDefault();
        undo();
      } else if (k === "m" || k === "M") {
        setMuted((m) => !m);
      } else if ((k === "i" || k === "I") && current) {
        setInfoAd(current);
      } else if ((k === "s" || k === "S") && current) {
        ui.toggleSave(current);
      } else if (k === "Escape") {
        onExit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [swipe, undo, current, ui, onExit]);

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-ink lg:left-60" data-stage="swipe">
      <div className="mx-auto flex h-full w-full max-w-[520px] flex-col px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))] lg:py-6">
        {/* header: exit · progress · likes */}
        <div className="flex items-center gap-3 px-1 pb-2">
          <button type="button" onClick={onExit} aria-label="Tinder'dan çık" className="grid size-9 shrink-0 place-items-center rounded-full bg-white/[0.06] text-zinc-300 ring-1 ring-white/10 hover:bg-white/10">
            <XIcon size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-baseline justify-between text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">
              <span>Round 1</span>
              <span className="tabular-nums text-zinc-300" data-progress="">
                {Math.min(decided + 1, total)}/{total}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-rose-500 to-orange-400 transition-[width] duration-300" style={{ width: `${(decided / Math.max(1, total)) * 100}%` }} />
            </div>
          </div>
          <span
            key={flash?.dir === "like" ? flash.n : "x"}
            className={`flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-sm font-black tabular-nums text-emerald-300 ring-1 ring-emerald-400/30 ${flash?.dir === "like" ? "animate-pop" : ""}`}
            aria-label={`${liked} beğeni`}
            data-likes={liked}
          >
            <HeartIcon size={14} filled /> {liked}
          </span>
        </div>

        {/* card stack */}
        <div className="relative min-h-0 flex-1">
          <div className="relative mx-auto h-full w-full lg:aspect-[9/16] lg:w-auto lg:max-w-full">
            {deck.map((ad, i) => (
              <SwipeCard
                key={ad.id}
                ad={ad}
                depth={i}
                muted={muted}
                onToggleMute={() => setMuted((m) => !m)}
                onInfo={() => setInfoAd(ad)}
                onDecide={(dir) => commit(ad, dir)}
                onDragStart={() => !busy.current}
                onDragFling={() => {
                  busy.current = true;
                }}
                enterFrom={enter?.id === ad.id ? enter.dir : undefined}
                onEntered={clearEnter}
                apiRef={i === 0 ? top : undefined}
              />
            ))}
            {!deck.length && <div className="grid h-full place-items-center text-sm text-zinc-500">Yükleniyor…</div>}
          </div>
        </div>

        {/* controls */}
        <div className="flex items-center justify-center gap-4 pt-3">
          <RoundButton label="Geri al" size="sm" onClick={undo} disabled={!canUndo}>
            <UndoIcon size={18} />
          </RoundButton>
          <RoundButton label="Geç" size="lg" tone="pass" onClick={() => swipe("pass")} disabled={!current}>
            <CrossIcon size={28} />
          </RoundButton>
          <RoundButton label="Beğen" size="lg" tone="like" onClick={() => swipe("like")} disabled={!current}>
            <HeartIcon size={30} filled />
          </RoundButton>
          <RoundButton label="Detaylar" size="sm" onClick={() => current && setInfoAd(current)} disabled={!current}>
            <InfoIcon size={19} />
          </RoundButton>
        </div>
        <p className="mt-2 hidden text-center text-[11px] text-zinc-500 lg:block">
          <Kbd>←</Kbd> geç · <Kbd>→</Kbd> beğen · <Kbd>⌫</Kbd> geri al · <Kbd>M</Kbd> ses · <Kbd>I</Kbd> detay · <Kbd>S</Kbd> kaydet
        </p>
      </div>
      <AdInfoSheet ad={infoAd} onClose={() => setInfoAd(null)} />
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-white/15 px-1 font-mono text-[10px] text-zinc-300">{children}</kbd>;
}

function RoundButton({
  label,
  size,
  tone,
  disabled,
  onClick,
  children,
}: {
  label: string;
  size: "sm" | "lg";
  tone?: "like" | "pass";
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const tones = {
    like: "text-emerald-400 ring-emerald-400/40 hover:bg-emerald-400/10 active:bg-emerald-400/20",
    pass: "text-rose-400 ring-rose-400/40 hover:bg-rose-400/10 active:bg-rose-400/20",
    none: "text-zinc-300 ring-white/15 hover:bg-white/[0.08]",
  } as const;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid place-items-center rounded-full bg-ink-2 shadow-lg shadow-black/40 ring-2 transition active:scale-95 disabled:opacity-35 ${size === "lg" ? "size-16" : "size-11"} ${tones[tone ?? "none"]}`}
    >
      {children}
    </button>
  );
}

const DEPTH_STYLE = [
  { transform: "none", opacity: 1 },
  { transform: "translateY(12px) scale(0.95)", opacity: 1 },
  { transform: "translateY(24px) scale(0.9)", opacity: 0 },
];

function SwipeCard({
  ad,
  depth,
  muted,
  onToggleMute,
  onInfo,
  onDecide,
  onDragStart,
  onDragFling,
  enterFrom,
  onEntered,
  apiRef,
}: {
  ad: Ad;
  depth: number;
  muted: boolean;
  onToggleMute: () => void;
  onInfo: () => void;
  onDecide: (dir: SwipeDir) => void;
  onDragStart: () => boolean;
  onDragFling: () => void;
  enterFrom?: SwipeDir;
  onEntered: () => void;
  apiRef?: React.RefObject<CardApi | null>;
}) {
  const card = useRef<HTMLDivElement>(null);
  const likeStamp = useRef<HTMLDivElement>(null);
  const passStamp = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; t: number; id: number; dx: number; dy: number; lx: number; lt: number; vx: number } | null>(null);
  const [mode, setMode] = useState<MediaMode>(ad.media.length ? "image" : "text");
  const onMode = useCallback((m: MediaMode) => setMode(m), []);
  const isTop = depth === 0;
  const preload: Preload = depth <= 1 ? "auto" : "metadata";
  const decideRef = useRef(onDecide);
  useEffect(() => {
    decideRef.current = onDecide;
  });

  const setStamps = useCallback((dx: number) => {
    const p = Math.max(0, Math.min(1, Math.abs(dx) / 90));
    if (likeStamp.current) likeStamp.current.style.opacity = dx > 0 ? String(p) : "0";
    if (passStamp.current) passStamp.current.style.opacity = dx < 0 ? String(p) : "0";
  }, []);

  const fling = useCallback(
    (dir: SwipeDir, from?: { dx: number; dy: number; vx?: number }) => {
      const el = card.current;
      if (!el) {
        decideRef.current(dir);
        return;
      }
      const w = el.offsetWidth || 360;
      const sign = dir === "like" ? 1 : -1;
      const dy = from?.dy ?? 0;
      setStamps(sign * 200);
      el.style.transition = `transform ${FLING_MS}ms cubic-bezier(.3,.7,.4,1)`;
      el.style.transform = `translate(${sign * w * 1.5}px, ${dy * 0.4 + 40}px) rotate(${sign * 28}deg)`;
      window.setTimeout(() => decideRef.current(dir), FLING_MS - 20);
    },
    [setStamps],
  );

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { fling };
    return () => {
      if (apiRef.current?.fling === fling) apiRef.current = null;
    };
  }, [apiRef, fling]);

  // Undo: the restored card flies back in from the side it left.
  const entered = useRef(false);
  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !enterFrom || entered.current) return;
    entered.current = true;
    const sign = enterFrom === "like" ? 1 : -1;
    el.style.transition = "none";
    el.style.transform = `translate(${sign * el.offsetWidth * 1.3}px, 40px) rotate(${sign * 24}deg)`;
    void el.offsetWidth;
    el.style.transition = "transform 320ms cubic-bezier(.2,.9,.3,1.1)";
    el.style.transform = "";
    const t = window.setTimeout(onEntered, 330);
    return () => window.clearTimeout(t);
  }, [enterFrom, onEntered]);

  const springBack = () => {
    const el = card.current;
    if (!el) return;
    el.style.transition = "transform 320ms cubic-bezier(.2,.9,.3,1.25)";
    el.style.transform = "";
    setStamps(0);
  };

  const gesture = isTop
    ? {
        onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
          if (e.button !== 0 || !onDragStart()) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const now = performance.now();
          drag.current = { x: e.clientX, y: e.clientY, t: now, id: e.pointerId, dx: 0, dy: 0, lx: e.clientX, lt: now, vx: 0 };
          if (card.current) card.current.style.transition = "none";
        },
        onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          d.dx = e.clientX - d.x;
          d.dy = e.clientY - d.y;
          const now = performance.now();
          if (now - d.lt > 0) {
            d.vx = 0.7 * ((e.clientX - d.lx) / (now - d.lt)) + 0.3 * d.vx;
            d.lx = e.clientX;
            d.lt = now;
          }
          if (card.current) card.current.style.transform = `translate(${d.dx}px, ${d.dy * 0.4}px) rotate(${d.dx / 18}deg)`;
          setStamps(d.dx);
        },
        onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          drag.current = null;
          const w = card.current?.offsetWidth ?? 360;
          const moved = Math.hypot(d.dx, d.dy);
          const quick = Math.abs(d.vx) > 0.55 && Math.abs(d.dx) > 30 && Math.sign(d.vx) === Math.sign(d.dx);
          if (Math.abs(d.dx) > w * 0.28 || quick) {
            onDragFling();
            fling(d.dx > 0 ? "like" : "pass", { dx: d.dx, dy: d.dy, vx: d.vx });
          } else {
            springBack();
            if (moved < 8 && performance.now() - d.t < 400 && mode === "video") onToggleMute();
          }
        },
        onPointerCancel: () => {
          drag.current = null;
          springBack();
        },
      }
    : {};

  const line = firstLine(ad.headline && ad.headline !== ad.brand.name ? ad.headline : (ad.body ?? adTitle(ad)), 90);
  const ds = DEPTH_STYLE[Math.min(depth, 2)];

  return (
    <div
      className="absolute inset-0 transition-[transform,opacity] duration-300 ease-out"
      style={{ zIndex: 10 - depth, transform: ds.transform, opacity: ds.opacity, pointerEvents: isTop ? "auto" : "none" }}
      aria-hidden={!isTop}
      data-card={ad.id}
      data-depth={depth}
    >
      <div ref={card} className="relative h-full w-full overflow-hidden rounded-[1.75rem] bg-ink-2 shadow-2xl shadow-black/60 ring-1 ring-white/10 will-change-transform">
        <div className={`absolute inset-0 ${NO_ARROWS}`}>
          <AdMediaView ad={ad} active={isTop} preload={preload} muted={muted || !isTop} onMode={onMode} />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[30%] bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

        {/* gesture layer: drag to swipe, tap to toggle sound */}
        <div className="absolute inset-0 z-10 cursor-grab touch-none select-none active:cursor-grabbing" {...gesture} data-gesture="" />

        {/* stamps */}
        <div
          ref={likeStamp}
          className="pointer-events-none absolute left-5 top-8 z-20 -rotate-[14deg] rounded-xl border-4 border-emerald-400 px-3 py-1 text-3xl font-black tracking-wider text-emerald-400 opacity-0"
          style={{ textShadow: "0 2px 12px rgba(0,0,0,.4)" }}
          data-stamp="like"
        >
          BEĞEN
        </div>
        <div
          ref={passStamp}
          className="pointer-events-none absolute right-5 top-8 z-20 rotate-[14deg] rounded-xl border-4 border-rose-500 px-3 py-1 text-3xl font-black tracking-wider text-rose-500 opacity-0"
          style={{ textShadow: "0 2px 12px rgba(0,0,0,.4)" }}
          data-stamp="pass"
        >
          GEÇ
        </div>

        {isTop && mode === "video" && (
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? "Sesi aç" : "Sesi kapat"}
            className="absolute right-3 top-3 z-20 grid size-9 place-items-center rounded-full bg-black/40 text-white ring-1 ring-white/10 backdrop-blur-sm"
          >
            {muted ? <MuteIcon size={17} /> : <VolumeIcon size={17} />}
          </button>
        )}

        {/* minimal overlay: brand + days (always), one line, (i), save/share */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-4" data-overlay="">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <BrandLine ad={ad} />
              {line && <p className="text-shadow mt-1 truncate text-[13px] leading-snug text-white/85">{line}</p>}
            </div>
            <span className="pointer-events-auto flex items-center gap-1.5">
              <SaveShareIcons ad={ad} dark />
              <button
                type="button"
                onClick={onInfo}
                aria-label="Detaylar"
                className="grid size-8 place-items-center rounded-full bg-black/40 text-white ring-1 ring-white/10 backdrop-blur-sm hover:bg-black/60"
              >
                <InfoIcon size={17} />
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
