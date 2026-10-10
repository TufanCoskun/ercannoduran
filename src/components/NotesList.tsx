"use client";

import { useEffect, useState } from "react";
import { addNote, deleteNote, restoreNote, updateNote, type Note } from "@/lib/saved";
import { CheckIcon, PencilIcon, TrashIcon } from "./Icons";

const fmt = (iso: string) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t === 0) return "";
  return new Date(t).toLocaleString("tr-TR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** Notes on a saved ad — fully independent of the Gemini analysis. */
export function NotesList({ adId, notes }: { adId: string; notes: Note[] }) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [undo, setUndo] = useState<{ note: Note; index: number } | null>(null);

  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 6000);
    return () => window.clearTimeout(t);
  }, [undo]);

  const submit = () => {
    if (addNote(adId, draft)) setDraft("");
  };
  const saveEdit = () => {
    if (editing && editText.trim()) updateNote(adId, editing, editText);
    setEditing(null);
  };

  return (
    <section aria-label="Notlar">
      <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-volt">
        Notlarım <span className="text-zinc-500">{notes.length || ""}</span>
      </h3>

      {notes.length > 0 && (
        <ul className="mb-3 space-y-2">
          {notes.map((n, i) => (
            <li key={n.id} className="rounded-2xl border border-line bg-white/[0.03] px-3 py-2.5">
              {editing === n.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveEdit();
                  }}
                >
                  <textarea
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit();
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setEditing(null);
                      }
                    }}
                    rows={3}
                    aria-label="Notu düzenle"
                    className="w-full resize-y rounded-xl border border-volt/40 bg-black/20 px-3 py-2 text-[13.5px] leading-relaxed outline-none"
                  />
                  <div className="mt-1.5 flex gap-1.5">
                    <button type="submit" disabled={!editText.trim()} className="flex items-center gap-1 rounded-full bg-volt px-3 py-1 text-xs font-bold text-black disabled:opacity-40">
                      <CheckIcon size={13} /> Kaydet
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="rounded-full bg-white/[0.07] px-3 py-1 text-xs font-semibold">
                      Vazgeç
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-zinc-100">{n.text}</p>
                  <div className="mt-1.5 flex items-center gap-1">
                    <p className="flex-1 text-[11px] text-zinc-500">
                      {fmt(n.createdAt)}
                      {n.updatedAt ? " · düzenlendi" : ""}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(n.id);
                        setEditText(n.text);
                      }}
                      aria-label="Notu düzenle"
                      className="grid size-7 place-items-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-white"
                    >
                      <PencilIcon size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        deleteNote(adId, n.id);
                        setUndo({ note: n, index: i });
                      }}
                      aria-label="Notu sil"
                      className="grid size-7 place-items-center rounded-lg text-zinc-400 hover:bg-red-500/10 hover:text-red-300"
                    >
                      <TrashIcon size={14} />
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {undo && (
        <div role="status" className="mb-3 flex items-center justify-between gap-2 rounded-2xl bg-white/[0.05] px-3 py-2 text-xs text-zinc-300">
          Not silindi
          <button
            type="button"
            onClick={() => {
              restoreNote(adId, undo.note, undo.index);
              setUndo(null);
            }}
            className="rounded-full bg-white/10 px-3 py-1 font-semibold text-volt hover:bg-white/15"
          >
            Geri al
          </button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          rows={2}
          placeholder="Not ekle… (ör. konsept fikri)"
          aria-label="Not ekle"
          className="min-w-0 flex-1 resize-y rounded-2xl border border-line bg-white/[0.03] px-3 py-2.5 text-[13.5px] leading-relaxed outline-none placeholder:text-zinc-500 focus:border-volt/60"
        />
        <button type="submit" disabled={!draft.trim()} className="h-11 shrink-0 rounded-2xl bg-volt px-4 text-sm font-bold text-black disabled:opacity-40">
          Ekle
        </button>
      </form>
    </section>
  );
}
