"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Ad } from "@/lib/types";
import { adTitle, firstLine } from "@/lib/format";
import { canUndoPick, currentMatch, currentRound, pick, resolveAd, undoPick, type TinderSession } from "@/lib/tinder";
import { AdMediaView, type MediaMode } from "../AdMediaView";
import { AdInfoSheet } from "../AdInfoSheet";
import { InfoIcon, MuteIcon, TrophyIcon, VolumeIcon, XIcon } from "../Icons";
import { BrandLine, SaveShareIcons, TileThumb, UndoIcon } from "./bits";

/** Carousel arrows sit under the gesture layer and can't be clicked here — hide them. */
const NO_ARROWS = "[&_button[aria-label$='görsel']]:!hidden";
const PICK_MS = 420;

/**
 * Round 2+: two ads at a time — stacked top/bottom on phones, side by side from lg (1024px).
 * Tap a card (or "Bunu seç") to pick; ↑/← = first, ↓/→ = second; ⌫ undoes the last pick.
 */
export function Bracket({
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
  const match = currentMatch(session);
  const round = currentRound(session);
  const [sound, setSound] = useState<0 | 1 | null>(null);
  const [chosen, setChosen] = useState<0 | 1 | null>(null);
  const [infoAd, setInfoAd] = useState<Ad | null>(null);
  // Round intros (Round 3+ / Final) are shown once per round in this tab.
  const [introDone, setIntroDone] = useState<Record<string, boolean>>({});
  const busy = useRef(false);
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  });

  const a = match ? resolveAd(session, match.pair[0], live) : undefined;
  const b = match ? resolveAd(session, match.pair[1], live) : undefined;
  const introKey = round ? `${session.id}:${round.round}` : "";
  const showIntro = Boolean(round && match && round.round >= 3 && round.winners.length === 0 && !introDone[introKey]);

  const choose = useCallback(
    (side: 0 | 1) => {
      const m = currentMatch(sessionRef.current);
      if (!m || busy.current) return;
      busy.current = true;
      setChosen(side);
      window.setTimeout(() => {
        onChange(pick(sessionRef.current, m.pair[side]));
        setChosen(null);
        setSound(null);
        busy.current = false;
      }, PICK_MS);
    },
    [onChange],
  );

  const undo = useCallback(() => {
    if (busy.current || !canUndoPick(sessionRef.current)) return;
    setSound(null);
    onChange(undoPick(sessionRef.current));
  }, [onChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      const k = e.key;
      if (showIntro) {
        if (k === "Enter" || k === " ") {
          e.preventDefault();
          setIntroDone((d) => ({ ...d, [introKey]: true }));
        }
        return;
      }
      if (k === "ArrowUp" || k === "ArrowLeft") {
        e.preventDefault();
        choose(0);
      } else if (k === "ArrowDown" || k === "ArrowRight") {
        e.preventDefault();
        choose(1);
      } else if (k === "Backspace" || k === "z" || k === "Z") {
        e.preventDefault();
        undo();
      } else if (k === "Escape") {
        onExit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choose, undo, onExit, showIntro, introKey]);

  if (!match || !round || !a || !b) {
    return <div className="fixed inset-0 z-30 grid place-items-center bg-ink text-sm text-zinc-500 lg:left-60">Yükleniyor…</div>;
  }
  const byeAd = match.bye ? resolveAd(session, match.bye, live) : undefined;
  const title = match.isFinal ? "Final" : `Round ${match.round}`;

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-ink lg:left-60" data-stage="bracket">
      <div className="mx-auto flex h-full w-full max-w-[1100px] flex-col px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))] lg:px-6 lg:py-6">
        <div className="flex items-center gap-3 px-1 pb-2">
          <button type="button" onClick={onExit} aria-label="Tinder'dan çık" className="grid size-9 shrink-0 place-items-center rounded-full bg-white/[0.06] text-zinc-300 ring-1 ring-white/10 hover:bg-white/10">
            <XIcon size={18} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-[15px] font-black tracking-tight" data-match-title="">
              {match.isFinal ? (
                <span className="inline-flex items-center gap-1.5 text-amber-300">
                  <TrophyIcon size={16} /> Final
                </span>
              ) : (
                <>
                  {title} <span className="text-zinc-500">·</span> Eşleşme {match.index + 1}/{match.total}
                </>
              )}
            </p>
            <p className="truncate text-[11px] text-zinc-500">
              {byeAd ? `${byeAd.brand.name} tur atladı · ` : ""}
              {match.entrants} reklam kaldı
            </p>
          </div>
          <button
            type="button"
            onClick={undo}
            disabled={!canUndoPick(session)}
            aria-label="Son seçimi geri al"
            title="Geri al"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-white/[0.06] text-zinc-300 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-30"
          >
            <UndoIcon size={17} />
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col gap-2 lg:flex-row lg:gap-4">
          {[a, b].map((ad, i) => (
            <Half
              key={`${match.round}:${match.index}:${ad.id}`}
              ad={ad}
              side={i as 0 | 1}
              soundOn={sound === i}
              onToggleSound={() => setSound((s) => (s === i ? null : (i as 0 | 1)))}
              chosen={chosen}
              onChoose={() => choose(i as 0 | 1)}
              onInfo={() => setInfoAd(ad)}
              paused={showIntro}
            />
          ))}
          <span
            className={`pointer-events-none absolute left-1/2 top-1/2 z-20 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-ink text-sm font-black italic tracking-tight text-white ring-4 ring-ink shadow-xl transition-opacity ${chosen !== null ? "opacity-0" : ""}`}
            aria-hidden="true"
          >
            <span className="grid size-full place-items-center rounded-full bg-gradient-to-br from-rose-500 to-orange-400">VS</span>
          </span>
        </div>
        <p className="mt-2 hidden text-center text-[11px] text-zinc-500 lg:block">
          <Kbd>←</Kbd> soldaki · <Kbd>→</Kbd> sağdaki · <Kbd>⌫</Kbd> geri al
        </p>
      </div>

      {showIntro && (
        <div className="animate-fade-in absolute inset-0 z-40 grid place-items-center bg-ink/85 p-6 backdrop-blur-md lg:left-0" data-intro="">
          <div className="w-full max-w-sm text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">{match.isFinal ? "Son düello" : "Sıradaki tur"}</p>
            <h2 className={`mt-2 text-5xl font-black tracking-tight ${match.isFinal ? "text-amber-300" : ""}`}>{title}</h2>
            <p className="mt-2 text-sm text-mist">
              {match.entrants} reklam · {match.total} eşleşme
              {byeAd ? ` · ${byeAd.brand.name} tur atlıyor` : ""}
            </p>
            <ul className="mx-auto mt-5 flex max-w-xs flex-wrap justify-center gap-2">
              {round.entrants.slice(0, 8).map((id) => {
                const e = resolveAd(session, id, live);
                return e ? (
                  <li key={id} className={`w-14 overflow-hidden rounded-xl ring-1 ${id === round.bye ? "ring-amber-300/70" : "ring-white/10"}`}>
                    <TileThumb ad={e} />
                  </li>
                ) : null;
              })}
            </ul>
            <button
              type="button"
              autoFocus
              onClick={() => setIntroDone((d) => ({ ...d, [introKey]: true }))}
              className={`mt-6 h-12 w-full rounded-2xl text-base font-black text-black ${match.isFinal ? "bg-amber-300" : "bg-volt"}`}
            >
              Başla
            </button>
          </div>
        </div>
      )}
      <AdInfoSheet ad={infoAd} onClose={() => setInfoAd(null)} />
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-white/15 px-1 font-mono text-[10px] text-zinc-300">{children}</kbd>;
}

function Half({
  ad,
  side,
  soundOn,
  onToggleSound,
  chosen,
  onChoose,
  onInfo,
  paused,
}: {
  ad: Ad;
  side: 0 | 1;
  soundOn: boolean;
  onToggleSound: () => void;
  chosen: 0 | 1 | null;
  onChoose: () => void;
  onInfo: () => void;
  paused: boolean;
}) {
  const [mode, setMode] = useState<MediaMode>(ad.media.length ? "image" : "text");
  const onMode = useCallback((m: MediaMode) => setMode(m), []);
  const won = chosen === side;
  const lost = chosen !== null && !won;
  const line = firstLine(ad.headline && ad.headline !== ad.brand.name ? ad.headline : (ad.body ?? adTitle(ad)), 80);

  return (
    <div
      className={`relative min-h-0 flex-1 overflow-hidden rounded-[1.5rem] bg-ink-2 ring-1 transition duration-300 ${won ? "z-10 scale-[1.015] ring-4 ring-volt" : "ring-white/10"} ${lost ? "scale-[0.97] opacity-30" : ""}`}
      data-half={side}
      data-ad={ad.id}
    >
      <div className={`absolute inset-0 ${NO_ARROWS}`}>
        <AdMediaView ad={ad} active={!paused} preload="auto" muted={!soundOn} onMode={onMode} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
      {/* the whole card picks */}
      <button type="button" onClick={onChoose} aria-label={`${ad.brand.name} seç`} className="absolute inset-0 z-10 cursor-pointer" data-pick="" />

      {mode === "video" && (
        <button
          type="button"
          onClick={onToggleSound}
          aria-label={soundOn ? "Sesi kapat" : "Sesi aç"}
          aria-pressed={soundOn}
          className={`absolute right-3 top-3 z-20 grid size-9 place-items-center rounded-full ring-1 backdrop-blur-sm transition ${soundOn ? "bg-volt text-black ring-volt" : "bg-black/45 text-white ring-white/10"}`}
        >
          {soundOn ? <VolumeIcon size={17} /> : <MuteIcon size={17} />}
        </button>
      )}

      {won && (
        <span className="animate-pop absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-volt px-4 py-2 text-sm font-black text-black shadow-xl">Seçildi ✓</span>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end gap-2 px-3 pb-3">
        <div className="min-w-0 flex-1">
          <BrandLine ad={ad} size={24} />
          {line && <p className="text-shadow mt-1 hidden truncate text-[13px] text-white/85 sm:block">{line}</p>}
          <span className="pointer-events-auto mt-2 flex items-center gap-1.5">
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
        <button
          type="button"
          onClick={onChoose}
          className="pointer-events-auto shrink-0 rounded-full bg-white px-4 py-2.5 text-sm font-black text-black shadow-lg shadow-black/40 transition hover:bg-volt active:scale-95"
        >
          Bunu seç
        </button>
      </div>
    </div>
  );
}
