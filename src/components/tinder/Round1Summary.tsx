"use client";

import { useState } from "react";
import type { Ad } from "@/lib/types";
import { adPath } from "@/lib/format";
import { createCollection, isSaved, saveAd, savedStore, useSaved } from "@/lib/saved";
import { collectionName, filtersLabel, resolveAd, startBracket, undoSwipe, type TinderSession } from "@/lib/tinder";
import { AdInfoSheet } from "../AdInfoSheet";
import { BookmarkIcon, CheckIcon, ShareIcon, TrophyIcon } from "../Icons";
import { useUI } from "../UIProvider";
import { AdTile, HeartIcon, UndoIcon } from "./bits";

export function listShareText(title: string, ads: Ad[]): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return [title, ...ads.map((a, i) => `${i + 1}. ${a.brand.name} — ${origin}${adPath(a.id)}`)].join("\n");
}

/** Native share sheet on touch devices, clipboard elsewhere. */
export async function shareList(title: string, ads: Ad[], toast: (t: string) => void) {
  const text = listShareText(title, ads);
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  if (coarse && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Liste kopyalandı");
  } catch {
    toast("Kopyalanamadı");
  }
}

/** Saves the liked ads into one collection ("Tinder · 10 Eki · US DTC"); ads already saved elsewhere stay put. */
export function saveLikedToCollection(session: TinderSession, ads: Ad[]): { session: TinderSession; added: number; kept: number; name: string } {
  const name = collectionName(session);
  const existing = session.savedCollectionId && savedStore.read().collections.some((c) => c.id === session.savedCollectionId) ? session.savedCollectionId : undefined;
  const cid = existing ?? createCollection(name);
  let added = 0;
  let kept = 0;
  for (const ad of ads) {
    if (isSaved(ad.id)) {
      if (savedStore.read().items[ad.id]?.collectionId !== cid) kept++;
      continue;
    }
    saveAd(ad, cid);
    added++;
  }
  return { session: { ...session, savedCollectionId: cid }, added, kept, name };
}

export function Round1Summary({
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
  const [infoAd, setInfoAd] = useState<Ad | null>(null);
  const liked = session.round1.liked.map((id) => resolveAd(session, id, live)).filter((a): a is Ad => Boolean(a));
  const total = session.pool.length;
  const n = liked.length;
  const collection = session.savedCollectionId ? saved.collections.find((c) => c.id === session.savedCollectionId) : undefined;
  const allSaved = n > 0 && liked.every((a) => saved.items[a.id]);
  const matches = Math.floor(n / 2);

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-6 lg:px-8 lg:pt-10" data-stage="summary">
      <header className="text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Round 1 bitti · {filtersLabel(session.filters)}</p>
        <div className="mx-auto mt-4 grid size-20 place-items-center rounded-full bg-gradient-to-br from-rose-500 to-orange-400 text-white shadow-[0_16px_60px_-14px_rgba(244,63,94,0.8)]">
          <HeartIcon size={36} filled />
        </div>
        <h1 className="mt-4 text-3xl font-black tracking-tight text-balance lg:text-4xl" data-summary-title="">
          {total} reklamdan {n}&apos;{suffix(n)} beğendin
        </h1>
        <p className="mt-1 text-sm text-mist">
          {n >= 2
            ? `Round 2: ${matches} eşleşme${n % 2 ? " · 1 reklam tur atlar" : ""} — kafa kafaya seç, sonunda tek kazanan kalsın.`
            : n === 1
              ? "Tek beğeni — doğrudan kazanan o."
              : "Hiç beğeni yok. Yeni bir deste dene."}
        </p>
      </header>

      <div className="mx-auto mt-6 grid max-w-md gap-2">
        {n >= 2 && (
          <button
            type="button"
            onClick={() => onChange(startBracket(session))}
            className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-volt text-lg font-black text-black shadow-[0_16px_50px_-16px_rgba(200,255,46,0.7)] transition hover:brightness-105 active:scale-[0.99]"
          >
            Round 2&apos;ye geç <span aria-hidden="true">→</span>
          </button>
        )}
        {n === 1 && (
          <button type="button" onClick={() => onChange(startBracket(session))} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-amber-300 text-lg font-black text-black">
            <TrophyIcon size={20} /> Kazananı gör
          </button>
        )}
        {n === 0 && (
          <button type="button" onClick={onNew} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-volt text-lg font-black text-black">
            Yeni Tinder
          </button>
        )}
        {n > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                const r = saveLikedToCollection(session, liked);
                onChange(r.session);
                ui.toast(`“${r.name}” · ${r.added} reklam kaydedildi${r.kept ? ` · ${r.kept} zaten kayıtlıydı` : ""}`);
              }}
              className={`flex h-11 items-center justify-center gap-2 rounded-2xl text-sm font-semibold ring-1 transition ${collection && allSaved ? "bg-volt/15 text-volt ring-volt/40" : "bg-white/[0.07] ring-white/10 hover:bg-white/[0.12]"}`}
            >
              {collection && allSaved ? <CheckIcon size={16} /> : <BookmarkIcon size={16} />}
              {collection && allSaved ? "Kaydedildi" : "Beğenilenleri kaydet"}
            </button>
            <button
              type="button"
              onClick={() => shareList(`AdGym Tinder · ${filtersLabel(session.filters)} · beğendiklerim`, liked, ui.toast)}
              className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-white/[0.07] text-sm font-semibold ring-1 ring-white/10 transition hover:bg-white/[0.12]"
            >
              <ShareIcon size={16} /> Listeyi paylaş
            </button>
          </div>
        )}
        {collection && <p className="text-center text-xs text-mist">Koleksiyon: {collection.name}</p>}
        <div className="flex items-center justify-center gap-4 pt-1">
          <button type="button" onClick={() => onChange(undoSwipe(session))} className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-white">
            <UndoIcon size={14} /> Son kaydırmayı geri al
          </button>
          {n > 0 && (
            <button type="button" onClick={onNew} className="text-xs font-semibold text-zinc-400 hover:text-white">
              Yeni Tinder
            </button>
          )}
        </div>
      </div>

      {n > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Beğendiklerin · {n}</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {liked.map((ad) => (
              <AdTile key={ad.id} ad={ad} onOpen={setInfoAd} />
            ))}
          </ul>
        </section>
      )}
      <AdInfoSheet ad={infoAd} onClose={() => setInfoAd(null)} />
    </div>
  );
}

/** Turkish accusative suffix after a number: 10'unu, 3'ünü, 1'ini, 6'sını … */
export function suffix(n: number): string {
  const last = n % 10;
  const tens = Math.floor(n / 10) % 10;
  if (n === 0) return "ını";
  if (last === 0) {
    // 10 on-u, 20 yirmi-si, 30 otuz-u, 40 kırk-ı, 50 elli-si, 60 altmış-ı, 70 yetmiş-i, 80 seksen-i, 90 doksan-ı, 100 yüz-ü
    if (n % 100 === 0) return n % 1000 === 0 ? "ini" : "ünü";
    return ["", "unu", "sini", "unu", "ını", "sini", "ını", "ini", "ini", "ını"][tens];
  }
  return ["", "ini", "sini", "ünü", "ünü", "ini", "sını", "sini", "ini", "unu"][last];
}
