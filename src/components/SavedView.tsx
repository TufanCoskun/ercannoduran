"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  createCollection,
  DEFAULT_COLLECTION_ID,
  deleteCollection,
  moveAd,
  removeAd,
  renameCollection,
  setNote,
  useSaved,
  type SavedItem,
} from "@/lib/saved";
import { useHydrated } from "@/lib/store";
import { adPath, adTitle, libraryLabel, scoreText, truncate } from "@/lib/format";
import { SEGMENT_LABEL } from "@/lib/filters";
import { AdThumb } from "./AdThumb";
import { BookmarkIcon, CheckIcon, ExternalIcon, PencilIcon, PlusIcon, TrashIcon, XIcon } from "./Icons";
import { Sheet } from "./Sheet";
import { useUI } from "./UIProvider";

const ALL = "__all";

export function SavedView() {
  const hydrated = useHydrated();
  const state = useSaved();
  const ui = useUI();
  const [selected, setSelected] = useState<string>(ALL);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const items = useMemo(() => Object.values(state.items).sort((a, b) => b.savedAt.localeCompare(a.savedAt)), [state.items]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) c[it.collectionId] = (c[it.collectionId] ?? 0) + 1;
    return c;
  }, [items]);
  const current = state.collections.find((c) => c.id === selected);
  const sel = selected !== ALL && !current ? ALL : selected; // collection deleted elsewhere
  const visible = sel === ALL ? items : items.filter((it) => it.collectionId === sel);

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-6xl px-4 pt-6 lg:px-8 lg:pt-10">
        <div className="h-9 w-48 animate-pulse rounded-xl bg-white/5" />
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="aspect-[4/5] animate-pulse rounded-2xl bg-white/5" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-6 lg:px-8 lg:pt-10">
      <header className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight lg:text-4xl">Kaydedilenler</h1>
          <p className="mt-1 text-sm text-mist">
            {items.length} reklam · {state.collections.length} koleksiyon · bu cihazda saklanır
          </p>
        </div>
      </header>

      {/* collection tabs */}
      <div className="no-scrollbar -mx-4 mb-4 flex items-center gap-1.5 overflow-x-auto px-4 lg:-mx-8 lg:px-8">
        <Tab on={sel === ALL} onClick={() => setSelected(ALL)} count={items.length}>
          Tümü
        </Tab>
        {state.collections.map((c) => (
          <Tab key={c.id} on={sel === c.id} onClick={() => setSelected(c.id)} count={counts[c.id] ?? 0}>
            {c.name}
          </Tab>
        ))}
        <button
          type="button"
          onClick={() => {
            setName("");
            setCreating(true);
          }}
          className="flex shrink-0 items-center gap-1 rounded-full px-3 py-2 text-[13px] font-semibold text-volt hover:bg-volt/10"
        >
          <PlusIcon size={16} /> Yeni koleksiyon
        </button>
      </div>

      {current && (
        <div className="mb-5 flex items-center gap-2 rounded-2xl border border-line bg-ink-2 px-4 py-2.5">
          <p className="flex-1 truncate text-sm font-semibold">{current.name}</p>
          <button
            type="button"
            onClick={() => {
              setName(current.name);
              setRenaming(true);
            }}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/5"
          >
            <PencilIcon size={14} /> Yeniden adlandır
          </button>
          {current.id !== DEFAULT_COLLECTION_ID && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/10"
            >
              <TrashIcon size={14} /> Sil
            </button>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="grid place-items-center rounded-3xl border border-dashed border-line py-20 text-center">
          <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-white/5 text-volt">
            <BookmarkIcon size={24} />
          </div>
          <p className="font-bold">{items.length ? "Bu koleksiyon boş" : "Henüz kayıt yok"}</p>
          <p className="mt-1 max-w-xs text-sm text-mist">
            Akışta beğendiğin reklamı yer imi ikonuyla (ya da masaüstünde <kbd className="rounded border border-white/15 px-1 font-mono text-xs">s</kbd> tuşuyla) kaydet.
          </p>
          <Link href="/" className="mt-5 rounded-full bg-volt px-5 py-2.5 text-sm font-bold text-black">
            Akışa git
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((it) => (
            <SavedCard
              key={it.ad.id}
              item={it}
              collections={state.collections}
              onRemove={() => {
                removeAd(it.ad.id);
                ui.toast("Kaydedilenlerden çıkarıldı");
              }}
            />
          ))}
        </ul>
      )}

      <Sheet open={creating || renaming} onClose={() => {
          setCreating(false);
          setRenaming(false);
        }} title={creating ? "Yeni koleksiyon" : "Koleksiyonu yeniden adlandır"}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            if (creating) {
              const id = createCollection(name);
              setSelected(id);
              ui.toast(`“${name.trim()}” oluşturuldu`);
            } else if (current) {
              renameCollection(current.id, name);
              ui.toast("Koleksiyon güncellendi");
            }
            setCreating(false);
            setRenaming(false);
          }}
          className="space-y-3"
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="ör. Otel hook'ları, UGC örnekleri"
            className="w-full rounded-2xl border border-line bg-white/[0.03] px-4 py-3 text-sm outline-none placeholder:text-zinc-500 focus:border-volt/60"
          />
          <button type="submit" disabled={!name.trim()} className="h-12 w-full rounded-2xl bg-volt text-sm font-bold text-black disabled:opacity-40">
            {creating ? "Oluştur" : "Kaydet"}
          </button>
        </form>
      </Sheet>

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Koleksiyon silinsin mi?">
        <p className="text-sm text-mist">
          “{current?.name}” silinecek. İçindeki {current ? (counts[current.id] ?? 0) : 0} reklam “{state.collections.find((c) => c.id === DEFAULT_COLLECTION_ID)?.name}” koleksiyonuna taşınır.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setConfirmDelete(false)} className="h-11 rounded-2xl bg-white/[0.07] text-sm font-semibold">
            Vazgeç
          </button>
          <button
            type="button"
            onClick={() => {
              if (current) deleteCollection(current.id);
              setSelected(ALL);
              setConfirmDelete(false);
              ui.toast("Koleksiyon silindi");
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

function Tab({ on, onClick, count, children }: { on: boolean; onClick: () => void; count: number; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold transition ${on ? "bg-white text-black" : "bg-white/[0.06] text-zinc-300 ring-1 ring-white/10 hover:bg-white/[0.1]"}`}
    >
      <span className="max-w-[160px] truncate">{children}</span>
      <span className={`text-[11px] tabular-nums ${on ? "text-black/50" : "text-zinc-500"}`}>{count}</span>
    </button>
  );
}

function SavedCard({ item, collections, onRemove }: { item: SavedItem; collections: { id: string; name: string }[]; onRemove: () => void }) {
  const { ad } = item;
  const [note, setLocalNote] = useState(item.note ?? "");
  const [savedFlash, setSavedFlash] = useState(false);
  const dirty = note !== (item.note ?? "");

  const commit = () => {
    if (!dirty) return;
    setNote(ad.id, note);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1200);
  };

  return (
    <li className="flex flex-col overflow-hidden rounded-3xl border border-line bg-ink-2">
      <div className="flex gap-3 p-3">
        <Link href={adPath(ad.id)} className="w-28 shrink-0 overflow-hidden rounded-2xl">
          <AdThumb ad={ad} />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col">
          <Link href={adPath(ad.id)} className="truncate font-bold hover:underline">
            {ad.brand.name}
          </Link>
          <p className="line-clamp-2 text-[13px] leading-snug text-zinc-400">{truncate(adTitle(ad), 90)}</p>
          <p className="mt-1 text-[11px] font-semibold text-zinc-500">
            {SEGMENT_LABEL[ad.segment]} · {ad.market} · {scoreText(ad)}
          </p>
          <div className="mt-auto flex items-center gap-1.5 pt-2">
            <select
              value={item.collectionId}
              onChange={(e) => moveAd(ad.id, e.target.value)}
              aria-label="Koleksiyona taşı"
              className="min-w-0 flex-1 truncate rounded-xl border border-line bg-ink-3 px-2 py-1.5 text-xs font-semibold text-zinc-200 outline-none focus:border-volt/60"
            >
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <a
              href={ad.libraryUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={libraryLabel(ad)}
              aria-label={libraryLabel(ad)}
              className="grid size-8 shrink-0 place-items-center rounded-xl text-zinc-400 hover:bg-white/5 hover:text-white"
            >
              <ExternalIcon size={15} />
            </a>
            <button
              type="button"
              onClick={onRemove}
              title="Kaldır"
              aria-label="Kaydedilenlerden çıkar"
              className="grid size-8 shrink-0 place-items-center rounded-xl text-zinc-400 hover:bg-red-500/10 hover:text-red-300"
            >
              <XIcon size={16} />
            </button>
          </div>
        </div>
      </div>
      <div className="border-t border-line px-3 pb-3 pt-2.5">
        <label className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-volt">
          Neden çalışıyor?
          {savedFlash && (
            <span className="flex items-center gap-1 normal-case tracking-normal text-zinc-400">
              <CheckIcon size={12} /> kaydedildi
            </span>
          )}
        </label>
        <textarea
          value={note}
          onChange={(e) => setLocalNote(e.target.value)}
          onBlur={commit}
          rows={2}
          placeholder="Hook, teklif, sosyal kanıt… kendi notun"
          className="w-full resize-y rounded-xl border border-line bg-white/[0.03] px-3 py-2 text-[13px] leading-relaxed outline-none placeholder:text-zinc-600 focus:border-volt/50"
        />
        {dirty && (
          <button type="button" onClick={commit} className="mt-1.5 rounded-full bg-volt px-3 py-1 text-xs font-bold text-black">
            Notu kaydet
          </button>
        )}
      </div>
    </li>
  );
}
