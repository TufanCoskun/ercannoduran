"use client";

import Link from "next/link";
import { useState } from "react";
import type { Ad } from "@/lib/types";
import { useHydrated } from "@/lib/store";
import {
  deleteSession,
  filtersLabel,
  historySessions,
  roundAdvancers,
  roundComplete,
  sessionDate,
  stageOf,
  useTinder,
  type TinderSession,
} from "@/lib/tinder";
import { AdInfoSheet } from "../AdInfoSheet";
import { AdThumb } from "../AdThumb";
import { ChevronDownIcon, ShareIcon, TrashIcon, TrophyIcon } from "../Icons";
import { Sheet } from "../Sheet";
import { useUI } from "../UIProvider";
import { AdTile, CardsIcon, HeartIcon } from "./bits";
import { shareList } from "./Round1Summary";

/**
 * "Tinder özetleri" — every Tinder session on this device: date, filters, counts; expands into
 * Round 1 kazananları, Round 2 kazananları, … and 🏆 Kazanan. Works purely from the stored
 * snapshots, so it can be mounted anywhere (Kayıtlı tab, /tinder/history).
 */
export function TinderHistory({ className = "" }: { className?: string }) {
  const hydrated = useHydrated();
  const state = useTinder();
  const [open, setOpen] = useState<string | null>(null);
  const [infoAd, setInfoAd] = useState<Ad | null>(null);
  const [confirm, setConfirm] = useState<TinderSession | null>(null);
  const ui = useUI();
  const sessions = historySessions(state);

  if (!hydrated) {
    return (
      <div className={`space-y-3 ${className}`}>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-3xl bg-white/5" />
        ))}
      </div>
    );
  }

  if (!sessions.length) {
    return (
      <div className={`grid place-items-center rounded-3xl border border-dashed border-line py-16 text-center ${className}`} data-tinder-history="empty">
        <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-rose-500 to-orange-400 text-white">
          <CardsIcon size={24} />
        </div>
        <p className="font-bold">Henüz Tinder oynamadın</p>
        <p className="mt-1 max-w-xs text-sm text-mist">Rastgele bir deste seç, sağa/sola kaydır, sonra kafa kafaya turnuvayla kazananı bul.</p>
        <Link href="/tinder" className="mt-5 rounded-full bg-volt px-5 py-2.5 text-sm font-bold text-black">
          Tinder&apos;ı başlat
        </Link>
      </div>
    );
  }

  return (
    <div className={className} data-tinder-history="">
      <ul className="space-y-3">
        {sessions.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            open={open === s.id}
            active={state.activeId === s.id}
            onToggle={() => setOpen((o) => (o === s.id ? null : s.id))}
            onOpenAd={setInfoAd}
            onDelete={() => setConfirm(s)}
            onShare={(title, ads) => shareList(title, ads, ui.toast)}
          />
        ))}
      </ul>
      <AdInfoSheet ad={infoAd} onClose={() => setInfoAd(null)} />
      <Sheet open={Boolean(confirm)} onClose={() => setConfirm(null)} title="Oturum silinsin mi?">
        <p className="text-sm text-mist">
          {confirm ? `${sessionDate(confirm)} · ${filtersLabel(confirm.filters)}` : ""} özeti silinecek. Kaydettiğin reklamlar Kayıtlı&apos;da kalır.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setConfirm(null)} className="h-11 rounded-2xl bg-white/[0.07] text-sm font-semibold">
            Vazgeç
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm) deleteSession(confirm.id);
              setConfirm(null);
              ui.toast("Tinder özeti silindi");
            }}
            className="h-11 rounded-2xl bg-red-500 text-sm font-bold text-white"
          >
            Sil
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function SessionRow({
  session: s,
  open,
  active,
  onToggle,
  onOpenAd,
  onDelete,
  onShare,
}: {
  session: TinderSession;
  open: boolean;
  active: boolean;
  onToggle: () => void;
  onOpenAd: (ad: Ad) => void;
  onDelete: () => void;
  onShare: (title: string, ads: Ad[]) => void;
}) {
  const stage = stageOf(s);
  const ad = (id: string) => s.ads[id];
  const winner = s.winner ? ad(s.winner) : undefined;
  const liked = s.round1.liked.map(ad).filter((a): a is Ad => Boolean(a));
  const decided = s.round1.liked.length + s.round1.passed.length;
  const inProgress = stage !== "done";
  const label = filtersLabel(s.filters);
  // The final round's single advancer is the winner itself — no separate section for it.
  const rounds = s.rounds.filter((r) => !(roundComplete(r) && roundAdvancers(r).length === 1));
  const status =
    stage === "done" ? null : stage === "swipe" ? `Round 1 · ${decided}/${s.pool.length}` : stage === "summary" ? "Round 1 bitti" : `Round ${s.rounds[s.rounds.length - 1].round} devam ediyor`;

  return (
    <li className="overflow-hidden rounded-3xl border border-line bg-ink-2" data-session={s.id}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-white/[0.03]">
        <span className="relative w-12 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10">
          {winner ? (
            <AdThumb ad={winner} />
          ) : (
            <span className="grid aspect-[4/5] place-items-center bg-gradient-to-br from-rose-500/30 to-orange-400/20 text-rose-300">
              <HeartIcon size={18} filled />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500">
            {sessionDate(s)}
            {status && <span className="rounded-full bg-volt/15 px-1.5 py-px text-[10px] font-bold text-volt">{status}</span>}
          </span>
          <span className="block truncate font-bold">{label}</span>
          <span className="block truncate text-xs text-mist">
            {s.pool.length} reklam · ♥ {s.round1.liked.length} · {1 + s.rounds.length} tur
            {winner ? ` · 🏆 ${winner.brand.name}` : ""}
          </span>
        </span>
        <ChevronDownIcon size={18} className={`shrink-0 text-zinc-500 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-5 border-t border-line p-3 pb-4">
          <Section title="Round 1 kazananları" count={liked.length}>
            {liked.length ? (
              liked.map((a) => <AdTile key={a.id} ad={a} onOpen={onOpenAd} highlight={a.id === s.winner} />)
            ) : (
              <p className="col-span-full text-sm text-zinc-500">Hiç beğeni yok.</p>
            )}
          </Section>
          {rounds.map((r) => {
            const done = roundComplete(r);
            const ids = done ? roundAdvancers(r) : r.winners;
            const list = ids.map(ad).filter((a): a is Ad => Boolean(a));
            return (
              <Section key={r.round} title={`Round ${r.round} kazananları`} count={list.length} note={done ? undefined : "devam ediyor"}>
                {list.length ? (
                  list.map((a) => <AdTile key={a.id} ad={a} onOpen={onOpenAd} tag={a.id === r.bye ? "tur atladı" : undefined} highlight={a.id === s.winner} />)
                ) : (
                  <p className="col-span-full text-sm text-zinc-500">Henüz seçim yok.</p>
                )}
              </Section>
            );
          })}
          {winner && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-300">
                <TrophyIcon size={13} /> 🏆 Kazanan
              </h3>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                <AdTile ad={winner} onOpen={onOpenAd} highlight />
              </ul>
            </section>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            {inProgress && active && (
              <Link href="/tinder" className="rounded-full bg-volt px-4 py-2 text-xs font-bold text-black">
                Devam et
              </Link>
            )}
            {liked.length > 0 && (
              <button
                type="button"
                onClick={() => onShare(`AdGym Tinder · ${label}${winner ? ` · 🏆 ${winner.brand.name}` : ""}`, winner ? [winner, ...liked.filter((a) => a.id !== winner.id)] : liked)}
                className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-2 text-xs font-semibold ring-1 ring-white/10 hover:bg-white/[0.1]"
              >
                <ShareIcon size={14} /> Özeti paylaş
              </button>
            )}
            <button type="button" onClick={onDelete} className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10">
              <TrashIcon size={14} /> Oturumu sil
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function Section({ title, count, note, children }: { title: string; count: number; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
        {title} <span className="tabular-nums text-zinc-600">· {count}</span>
        {note && <span className="ml-1 normal-case tracking-normal text-volt">{note}</span>}
      </h3>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">{children}</ul>
    </section>
  );
}
