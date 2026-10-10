"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { Ad } from "@/lib/types";
import { daysLabel, libraryLabel, scoreText } from "@/lib/format";
import { useSaved } from "@/lib/saved";
import { beatenBy, canUndoPick, filtersLabel, resolveAd, undoPick, type TinderSession } from "@/lib/tinder";
import { AdMediaView, type MediaMode } from "../AdMediaView";
import { AdInfoSheet } from "../AdInfoSheet";
import { AdScore, BrandAvatar } from "../Bits";
import { BookmarkIcon, ExternalIcon, InfoIcon, MuteIcon, ShareIcon, TrophyIcon, VolumeIcon } from "../Icons";
import { useUI } from "../UIProvider";
import { AdTile, DaysBadge, UndoIcon } from "./bits";

const CONFETTI = ["#c8ff2e", "#ffc53d", "#fb7185", "#fb923c", "#ffffff", "#a3e635"];

export function WinnerView({
  session,
  live,
  onChange,
  onNew,
}: {
  session: TinderSession;
  live: ReadonlyMap<string, Ad>;
  onChange: (s: TinderSession) => void;
  onNew: () => void;
}) {
  const ui = useUI();
  const saved = useSaved();
  const [muted, setMuted] = useState(true);
  const [mode, setMode] = useState<MediaMode>("image");
  const onMode = useCallback((m: MediaMode) => setMode(m), []);
  const [infoAd, setInfoAd] = useState<Ad | null>(null);
  const ad = session.winner ? resolveAd(session, session.winner, live) : undefined;
  if (!ad) return null;
  const isSaved = Boolean(saved.items[ad.id]);
  const path = beatenBy(session, ad.id)
    .map((x) => ({ ...x, ad: resolveAd(session, x.opponent, live) }))
    .filter((x): x is { round: number; opponent: string; ad: Ad } => Boolean(x.ad));
  const days = daysLabel(ad);

  return (
    <div className="relative mx-auto max-w-5xl overflow-hidden px-4 pb-16 pt-4 lg:px-8 lg:pt-10" data-stage="done">
      <style>{`
        @keyframes tdr-fall { 0% { transform: translate3d(0,-20px,0) rotate(0deg); opacity: 0 } 10% { opacity: 1 } 100% { transform: translate3d(var(--dx), 420px, 0) rotate(540deg); opacity: 0 } }
        @keyframes tdr-rise { from { transform: translateY(14px) scale(.96); opacity: 0 } to { transform: none; opacity: 1 } }
        .tdr-rise { animation: tdr-rise 520ms cubic-bezier(.2,.9,.3,1.1) both }
      `}</style>
      {/* tasteful confetti: a single short burst */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px]" aria-hidden="true">
        {Array.from({ length: 22 }, (_, i) => (
          <span
            key={i}
            className="absolute top-0 block rounded-[2px]"
            style={
              {
                left: `${(i * 37) % 100}%`,
                width: i % 3 ? 6 : 8,
                height: i % 3 ? 10 : 6,
                background: CONFETTI[i % CONFETTI.length],
                animation: `tdr-fall ${1600 + ((i * 173) % 900)}ms ${(i * 61) % 500}ms cubic-bezier(.25,.6,.4,1) both`,
                "--dx": `${((i * 53) % 120) - 60}px`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <header className="tdr-rise relative text-center">
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-gradient-to-br from-amber-200 to-amber-400 text-black shadow-[0_0_60px_-6px_rgba(255,197,61,0.65)]">
          <TrophyIcon size={30} strokeWidth={2.4} />
        </div>
        <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">🏆 Kazanan</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight lg:text-4xl" data-winner-brand="">
          {ad.brand.name}
        </h1>
        <p className="mt-1 text-sm text-mist">
          {session.pool.length} reklam · {session.round1.liked.length} beğeni · {1 + session.rounds.length} tur · {filtersLabel(session.filters)}
        </p>
      </header>

      <div className="tdr-rise relative mt-6 grid items-start gap-6 lg:grid-cols-[auto_1fr]" style={{ animationDelay: "120ms" }}>
        <div className="relative mx-auto aspect-[9/16] h-[62dvh] max-h-[760px] max-w-full overflow-hidden lg:h-[72dvh] rounded-[1.75rem] bg-ink-2 shadow-[0_30px_100px_-20px_rgba(255,197,61,0.35)] ring-2 ring-amber-300/60">
          <AdMediaView ad={ad} active preload="auto" muted={muted} onMode={onMode} />
          {mode === "video" && (
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? "Sesi aç" : "Sesi kapat"}
              className="absolute right-3 top-3 z-20 grid size-9 place-items-center rounded-full bg-black/45 text-white ring-1 ring-white/10 backdrop-blur-sm"
            >
              {muted ? <MuteIcon size={17} /> : <VolumeIcon size={17} />}
            </button>
          )}
          <span className="absolute left-3 top-3 z-20 rounded-full bg-amber-300 px-2.5 py-1 text-[11px] font-black text-black shadow">🏆 Kazanan</span>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-3xl border border-line bg-ink-2 p-4">
            <BrandAvatar name={ad.brand.name} logoUrl={ad.brand.logoUrl} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold">{ad.brand.name}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-mist">
                <DaysBadge ad={ad} />
                {days && <span>{days}</span>}
                <span>· {scoreText(ad)}</span>
              </p>
            </div>
            <AdScore ad={ad} size={48} />
          </div>
          {(ad.headline || ad.body) && (
            <div className="rounded-3xl border border-line bg-ink-2 p-4">
              {ad.headline && <p className="font-bold leading-snug">{ad.headline}</p>}
              {ad.body && <p className="mt-1 line-clamp-4 whitespace-pre-line text-sm leading-relaxed text-zinc-300">{ad.body}</p>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => ui.toggleSave(ad)}
              aria-pressed={isSaved}
              className={`flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-bold transition ${isSaved ? "bg-volt text-black" : "bg-white text-black hover:bg-volt"}`}
            >
              <BookmarkIcon size={18} filled={isSaved} /> {isSaved ? "Kaydedildi" : "Kaydet"}
            </button>
            <button
              type="button"
              onClick={() => ui.share(ad)}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/[0.07] text-sm font-semibold ring-1 ring-white/10 transition hover:bg-white/[0.12]"
            >
              <ShareIcon size={18} /> Paylaş
            </button>
            <a
              href={ad.libraryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/[0.07] text-sm font-semibold ring-1 ring-white/10 transition hover:bg-white/[0.12]"
            >
              {libraryLabel(ad)} <ExternalIcon size={16} />
            </a>
            <button
              type="button"
              onClick={onNew}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500 to-orange-400 text-sm font-black text-white transition hover:brightness-110"
            >
              Yeni Tinder
            </button>
          </div>
          <div className="flex items-center justify-center gap-5 text-xs font-semibold text-zinc-400">
            <button type="button" onClick={() => setInfoAd(ad)} className="flex items-center gap-1.5 hover:text-white">
              <InfoIcon size={14} /> Detaylar
            </button>
            {canUndoPick(session) && (
              <button type="button" onClick={() => onChange(undoPick(session))} className="flex items-center gap-1.5 hover:text-white">
                <UndoIcon size={14} /> Son seçimi geri al
              </button>
            )}
            <Link href="/tinder/history" className="hover:text-white">
              Tinder özetleri →
            </Link>
          </div>

          {path.length > 0 && (
            <section className="pt-2">
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Turnuva yolu · yendikleri</h2>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {path.map((x) => (
                  <AdTile key={`${x.round}:${x.opponent}`} ad={x.ad} onOpen={setInfoAd} tag={x.round === 1 + session.rounds.length ? "Final" : `R${x.round}`} />
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
      <AdInfoSheet ad={infoAd} onClose={() => setInfoAd(null)} />
    </div>
  );
}
