"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createCollection,
  DEFAULT_COLLECTION_ID,
  deleteCollection,
  exportSaved,
  importSaved,
  removeAd,
  renameCollection,
  restoreItem,
  useSaved,
  type SavedItem,
} from "@/lib/saved";
import { useHydrated } from "@/lib/store";
import { adTitle, scoreText, truncate } from "@/lib/format";
import { SEGMENT_LABEL } from "@/lib/filters";
import { AdThumb } from "./AdThumb";
import { AnalyzeButton } from "./AnalyzeButton";
import { SavedDetail } from "./SavedDetail";
import { BookmarkIcon, PencilIcon, PlusIcon, TrashIcon, XIcon } from "./Icons";
import { Sheet } from "./Sheet";
import { useUI } from "./UIProvider";

const ALL = "__all";
const ANALYZED = "__analyzed";

export function SavedView() {
  const hydrated = useHydrated();
  const state = useSaved();
  const ui = useUI();
  const [selected, setSelected] = useState<string>(ALL);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);

  // Deep links: /saved?ad=<id> opens a detail, /saved?tab=ozetler opens the "Özetler" tab.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ad = q.get("ad");
    if (ad) setOpenId(ad);
    if (q.get("tab") === "ozetler") setSelected(ANALYZED);
  }, []);

  const items = useMemo(() => Object.values(state.items).sort((a, b) => b.savedAt.localeCompare(a.savedAt)), [state.items]);
  const analyzed = useMemo(
    () => items.filter((it) => it.analysis).sort((a, b) => (b.analysis?.createdAt ?? "").localeCompare(a.analysis?.createdAt ?? "")),
    [items],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of items) c[it.collectionId] = (c[it.collectionId] ?? 0) + 1;
    return c;
  }, [items]);
  const current = state.collections.find((c) => c.id === selected);
  const sel = selected !== ALL && selected !== ANALYZED && !current ? ALL : selected; // collection deleted elsewhere
  const visible = sel === ALL ? items : sel === ANALYZED ? analyzed : items.filter((it) => it.collectionId === sel);
  const openItem = openId ? state.items[openId] : undefined;

  const closeDetail = () => {
    setOpenId(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has("ad")) {
      url.searchParams.delete("ad");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  };

  const remove = (it: SavedItem) => {
    removeAd(it.ad.id);
    if (openId === it.ad.id) closeDetail();
    ui.toast("Kaydedilenlerden çıkarıldı", { label: "Geri al", onClick: () => restoreItem(it) });
  };

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
        <div className="min-w-0">
          <h1 className="text-3xl font-black tracking-tight lg:text-4xl">Kaydedilenler</h1>
          <p className="mt-1 text-sm text-mist">
            {items.length} reklam · {analyzed.length} özet · bu cihazda saklanır
          </p>
        </div>
        <button
          type="button"
          onClick={() => setBackupOpen(true)}
          className="shrink-0 rounded-full bg-white/[0.06] px-3.5 py-2 text-[13px] font-semibold text-zinc-200 ring-1 ring-white/10 hover:bg-white/[0.1]"
        >
          Yedekle / Geri yükle
        </button>
      </header>

      {/* tabs: all · analyzed · collections */}
      <div className="no-scrollbar -mx-4 mb-4 flex items-center gap-1.5 overflow-x-auto px-4 lg:-mx-8 lg:px-8">
        <Tab on={sel === ALL} onClick={() => setSelected(ALL)} count={items.length}>
          Tümü
        </Tab>
        <Tab on={sel === ANALYZED} onClick={() => setSelected(ANALYZED)} count={analyzed.length} accent>
          ✨ Özetler
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
        sel === ANALYZED ? (
          <div className="grid place-items-center rounded-3xl border border-dashed border-line px-6 py-16 text-center">
            <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-volt/10 text-2xl">✨</div>
            <p className="font-bold">Henüz özet yok</p>
            <p className="mt-1 max-w-xs text-sm text-mist">
              Kaydettiğin bir reklamda <b className="text-zinc-200">✨ Özetle</b>&apos;ye bas: Gemini videoyu sahne sahne çözer, hook&apos;u ve yapıyı çıkarır.
            </p>
          </div>
        ) : (
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
        )
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((it) => (
            <SavedCard key={it.ad.id} item={it} showHook={sel === ANALYZED} onOpen={() => setOpenId(it.ad.id)} onRemove={() => remove(it)} />
          ))}
        </ul>
      )}

      <Sheet open={Boolean(openItem)} onClose={closeDetail} title={openItem?.ad.brand.name} wide>
        {openItem && <SavedDetail key={openItem.ad.id} item={openItem} collections={state.collections} onRemove={() => remove(openItem)} />}
      </Sheet>

      <BackupSheet open={backupOpen} onClose={() => setBackupOpen(false)} toast={ui.toast} />

      <Sheet
        open={creating || renaming}
        onClose={() => {
          setCreating(false);
          setRenaming(false);
        }}
        title={creating ? "Yeni koleksiyon" : "Koleksiyonu yeniden adlandır"}
      >
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

function Tab({ on, onClick, count, accent, children }: { on: boolean; onClick: () => void; count: number; accent?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold transition ${
        on ? (accent ? "bg-volt text-black" : "bg-white text-black") : accent ? "bg-volt/10 text-volt ring-1 ring-volt/25 hover:bg-volt/15" : "bg-white/[0.06] text-zinc-300 ring-1 ring-white/10 hover:bg-white/[0.1]"
      }`}
    >
      <span className="max-w-[160px] truncate">{children}</span>
      <span className={`text-[11px] tabular-nums ${on ? "text-black/50" : accent ? "text-volt/60" : "text-zinc-500"}`}>{count}</span>
    </button>
  );
}

function SavedCard({ item, showHook, onOpen, onRemove }: { item: SavedItem; showHook: boolean; onOpen: () => void; onRemove: () => void }) {
  const { ad, analysis, notes } = item;
  const lastNote = notes[notes.length - 1];

  return (
    <li className="flex flex-col overflow-hidden rounded-3xl border border-line bg-ink-2">
      <div className="flex gap-3 p-3">
        <button type="button" onClick={onOpen} aria-label={`${ad.brand.name} detayını aç`} className="w-24 shrink-0 overflow-hidden rounded-2xl text-left sm:w-28">
          <AdThumb ad={ad} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start gap-1">
            <button type="button" onClick={onOpen} className="min-w-0 flex-1 truncate text-left font-bold hover:underline">
              {ad.brand.name}
            </button>
            <button
              type="button"
              onClick={onRemove}
              title="Kaldır"
              aria-label="Kaydedilenlerden çıkar"
              className="-mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-xl text-zinc-500 hover:bg-red-500/10 hover:text-red-300"
            >
              <XIcon size={16} />
            </button>
          </div>
          <p className="line-clamp-2 text-[13px] leading-snug text-zinc-400">{truncate(adTitle(ad), 90)}</p>
          <p className="mt-1 text-[11px] font-semibold text-zinc-500">
            {SEGMENT_LABEL[ad.segment]} · {ad.market} · {scoreText(ad)}
            {ad.activeDays !== undefined ? ` · ${ad.activeDays} gün` : ""}
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
            <AnalyzeButton adId={ad.id} onOpen={onOpen} />
            <button
              type="button"
              onClick={onOpen}
              className="inline-flex h-9 items-center rounded-full bg-white/[0.06] px-3 text-[12.5px] font-semibold text-zinc-300 ring-1 ring-white/10 hover:bg-white/[0.1]"
            >
              Notlar{notes.length ? ` · ${notes.length}` : ""}
            </button>
          </div>
        </div>
      </div>
      {(showHook || analysis) && analysis?.data.hook.text ? (
        <button type="button" onClick={onOpen} className="border-t border-line px-3 pb-3 pt-2.5 text-left hover:bg-white/[0.02]">
          <p className="text-[10.5px] font-black uppercase tracking-[0.16em] text-volt">Hook{analysis.data.hook.timestamp ? ` · ${analysis.data.hook.timestamp}` : ""}</p>
          <p className="mt-0.5 line-clamp-2 text-[13px] font-semibold leading-snug text-zinc-100">{analysis.data.hook.text}</p>
          {analysis.data.structure.framework && <p className="mt-1 line-clamp-1 text-[11.5px] text-zinc-500">{analysis.data.structure.framework}</p>}
        </button>
      ) : lastNote ? (
        <button type="button" onClick={onOpen} className="border-t border-line px-3 pb-3 pt-2.5 text-left hover:bg-white/[0.02]">
          <p className="line-clamp-2 text-[12.5px] italic leading-snug text-zinc-400">“{lastNote.text}”</p>
        </button>
      ) : null}
    </li>
  );
}

function BackupSheet({ open, onClose, toast }: { open: boolean; onClose: () => void; toast: (t: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const download = () => {
    const blob = new Blob([exportSaved()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `adgym-kayitlar-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Yedek indirildi");
  };

  const upload = async (file: File) => {
    setError(null);
    try {
      const r = importSaved(await file.text());
      toast(`${r.added} yeni reklam eklendi${r.merged ? `, ${r.merged} birleştirildi` : ""}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Yedek yüklenemedi.");
    }
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        setError(null);
        onClose();
      }}
      title="Yedekle / Geri yükle"
    >
      <p className="text-sm leading-relaxed text-mist">
        Kayıtlar, özetler ve notlar sadece bu tarayıcıda saklanır. Başka cihaza taşımak için yedeği indir, diğer cihazda geri yükle. Geri yükleme hiçbir şeyi silmez; birleştirir.
      </p>
      <div className="mt-5 grid gap-2">
        <button type="button" onClick={download} className="h-12 rounded-2xl bg-volt text-sm font-bold text-black">
          Yedeği indir (.json)
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} className="h-12 rounded-2xl bg-white/[0.07] text-sm font-semibold hover:bg-white/[0.1]">
          Yedekten geri yükle…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-2xl bg-red-500/10 px-3 py-2 text-[13px] text-red-200">
          {error}
        </p>
      )}
    </Sheet>
  );
}
