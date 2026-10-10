"use client";

import { useEffect, useRef, useState } from "react";
import type { Ad } from "@/lib/types";
import { previewImage } from "@/lib/format";
import { addNote, deleteNote, restoreNote, saveAd, updateNote, useSaved, type Note } from "@/lib/saved";
import { BrandAvatar } from "./Bits";
import { CheckIcon, PencilIcon, TrashIcon } from "./Icons";
import { Sheet } from "./Sheet";

// ---------------------------------------------------------------------------------------------
// Per-ad drafts: closing the sheet with text keeps it (memory + sessionStorage) until it's saved.

const DRAFT_KEY = (id: string) => `adgym:note-draft:${id}`;
const drafts = new Map<string, string>();

function readDraft(id: string): string {
  const mem = drafts.get(id);
  if (mem !== undefined) return mem;
  try {
    return window.sessionStorage.getItem(DRAFT_KEY(id)) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(id: string, text: string) {
  if (text.trim()) drafts.set(id, text);
  else drafts.delete(id);
  try {
    if (text.trim()) window.sessionStorage.setItem(DRAFT_KEY(id), text);
    else window.sessionStorage.removeItem(DRAFT_KEY(id));
  } catch {
    // private mode / blocked storage: the in-memory draft still works for this tab
  }
}

type Toast = (text: string, action?: { label: string; onClick: () => void }) => void;

/**
 * Quick note on any ad, from the feed / Tinder / info sheet, without going to /saved. Light scrim so
 * the video keeps playing behind it. Saving a note on an ad that isn't saved yet saves the ad first
 * (default collection) — notes live on saved items, so they show up in /saved right away.
 */
export function QuickNote({ ad, onClose, toast, onPickCollection }: { ad: Ad | null; onClose: () => void; toast: Toast; onPickCollection: (ad: Ad) => void }) {
  if (!ad) return null;
  return (
    <Sheet open onClose={onClose} light keyboardAware label={`${ad.brand.name} · not al`}>
      <QuickNoteBody key={ad.id} ad={ad} onClose={onClose} toast={toast} onPickCollection={onPickCollection} />
    </Sheet>
  );
}

function QuickNoteBody({ ad, onClose, toast, onPickCollection }: { ad: Ad; onClose: () => void; toast: Toast; onPickCollection: (ad: Ad) => void }) {
  const saved = useSaved();
  const item = saved.items[ad.id];
  const notes = item?.notes ?? [];
  const [text, setText] = useState(() => readDraft(ad.id));
  const ref = useRef<HTMLTextAreaElement>(null);

  // Caret at the end of a restored draft.
  useEffect(() => {
    const el = ref.current;
    if (el && el.value) el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const change = (v: string) => {
    setText(v);
    writeDraft(ad.id, v);
  };

  const submit = () => {
    const clean = text.trim();
    if (!clean) return;
    const wasSaved = Boolean(item);
    if (!wasSaved) saveAd(ad); // same call the Kaydet button makes (default collection)
    if (!addNote(ad.id, clean)) return;
    writeDraft(ad.id, "");
    setText("");
    if (wasSaved) toast("Not eklendi");
    else toast("Kaydedildi + not eklendi", { label: "Koleksiyon seç", onClick: () => onPickCollection(ad) });
    onClose();
  };

  const thumb = previewImage(ad);
  const days = ad.activeDays !== undefined ? (ad.activeDays === 0 ? "🔥 Bugün" : `🔥 ${ad.activeDays} gün`) : ad.source === "curated" ? "★ Efsane" : undefined;

  return (
    <div data-quicknote={ad.id}>
      <div className="-mt-1 mb-3 flex items-center gap-2.5">
        <Thumb src={thumb} ad={ad} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold leading-tight">{ad.brand.name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-mist">
            {days && <span className="font-semibold text-orange-200">{days}</span>}
            {item ? <span className="text-volt">· Kayıtlı</span> : <span>· Not kaydedince kaydedilir</span>}
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={ref}
          autoFocus
          value={text}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          rows={3}
          enterKeyHint="enter"
          placeholder="Bu kreatif hakkında not al… (hook, açı, konsept fikri)"
          aria-label="Not"
          className="block max-h-[34dvh] min-h-[5.5rem] w-full resize-none rounded-2xl border border-line bg-black/25 px-3.5 py-3 text-[15px] leading-relaxed outline-none placeholder:text-zinc-500 focus:border-volt/60 sm:text-[14px]"
          data-quicknote-input=""
        />
        <div className="mt-2.5 flex items-center gap-2">
          <p className="hidden flex-1 text-[11px] text-zinc-500 sm:block">
            <kbd className="rounded border border-white/15 px-1 font-mono text-[10px] text-zinc-300">⌘/Ctrl</kbd>+
            <kbd className="rounded border border-white/15 px-1 font-mono text-[10px] text-zinc-300">Enter</kbd> kaydet ·{" "}
            <kbd className="rounded border border-white/15 px-1 font-mono text-[10px] text-zinc-300">Esc</kbd> kapat
          </p>
          <button type="button" onClick={onClose} className="h-11 flex-1 rounded-2xl bg-white/[0.07] px-4 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/[0.12] sm:h-10 sm:flex-none">
            Kapat
          </button>
          <button
            type="submit"
            disabled={!text.trim()}
            className="flex h-11 flex-[2] items-center justify-center gap-1.5 rounded-2xl bg-volt px-5 text-sm font-bold text-black transition disabled:opacity-40 sm:h-10 sm:flex-none"
          >
            <CheckIcon size={16} /> Kaydet
          </button>
        </div>
      </form>

      {notes.length > 0 && <CompactNotes adId={ad.id} notes={notes} toast={toast} />}
    </div>
  );
}

function Thumb({ src, ad }: { src?: string; ad: Ad }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <BrandAvatar name={ad.brand.name} logoUrl={ad.brand.logoUrl} size={40} />;
  return (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
      className="h-12 w-[2.4rem] shrink-0 rounded-lg bg-ink-3 object-cover ring-1 ring-white/10"
    />
  );
}

/** The ad's existing notes (same list as /saved), compact, with inline edit / delete (+ undo toast). */
function CompactNotes({ adId, notes, toast }: { adId: string; notes: Note[]; toast: Toast }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const saveEdit = () => {
    if (editing && editText.trim()) updateNote(adId, editing, editText);
    setEditing(null);
  };

  return (
    <section className="mt-4 border-t border-line pt-3" aria-label="Notlarım">
      <h3 className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-zinc-500">
        Notlarım <span className="text-zinc-400">{notes.length}</span>
      </h3>
      <ul className="space-y-1.5" data-quicknote-list="">
        {notes.map((n, i) => (
          <li key={n.id} className="rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/[0.06]">
            {editing === n.id ? (
              <div>
                <textarea
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      e.stopPropagation();
                      saveEdit();
                    }
                  }}
                  rows={2}
                  aria-label="Notu düzenle"
                  className="w-full resize-none rounded-lg border border-volt/40 bg-black/20 px-2.5 py-1.5 text-[13px] leading-relaxed outline-none"
                />
                <div className="mt-1 flex gap-1.5">
                  <button type="button" onClick={saveEdit} disabled={!editText.trim()} className="flex items-center gap-1 rounded-full bg-volt px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-40">
                    <CheckIcon size={12} /> Kaydet
                  </button>
                  <button type="button" onClick={() => setEditing(null)} className="rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-semibold">
                    Vazgeç
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-1">
                <p className="line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap break-words pt-0.5 text-[13px] leading-snug text-zinc-200">{n.text}</p>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(n.id);
                    setEditText(n.text);
                  }}
                  aria-label="Notu düzenle"
                  className="grid size-7 shrink-0 place-items-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white"
                >
                  <PencilIcon size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    deleteNote(adId, n.id);
                    toast("Not silindi", { label: "Geri al", onClick: () => restoreNote(adId, n, i) });
                  }}
                  aria-label="Notu sil"
                  className="grid size-7 shrink-0 place-items-center rounded-lg text-zinc-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <TrashIcon size={13} />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
