"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Ad } from "@/lib/types";
import {
  createCollection,
  DEFAULT_COLLECTION_ID,
  isSaved,
  moveAd,
  removeAd,
  saveAd,
  savedStore,
  useSaved,
} from "@/lib/saved";
import { adPath, adTitle, truncate } from "@/lib/format";
import { Sheet } from "./Sheet";
import { CheckIcon, FolderIcon, LinkIcon, PlusIcon, ShareIcon, TrashIcon, WhatsAppIcon } from "./Icons";

interface ToastAction {
  label: string;
  onClick: () => void;
}
interface ToastMsg {
  id: number;
  text: string;
  action?: ToastAction;
}

interface UI {
  toast: (text: string, action?: ToastAction) => void;
  toggleSave: (ad: Ad) => void;
  openSave: (ad: Ad) => void;
  share: (ad: Ad) => void;
  copyLink: (ad: Ad) => void;
}

const Ctx = createContext<UI | null>(null);

export function useUI(): UI {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUI must be used inside <UIProvider>");
  return v;
}

export function shareUrl(ad: Ad): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${adPath(ad.id)}`;
}

export function shareText(ad: Ad): string {
  return `${ad.brand.name} — ${truncate(adTitle(ad), 90)} · AdGym'de gör:`;
}

export function whatsappHref(ad: Ad, url = shareUrl(ad)): string {
  return `https://wa.me/?text=${encodeURIComponent(`${shareText(ad)} ${url}`)}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [saveFor, setSaveFor] = useState<Ad | null>(null);
  const [shareFor, setShareFor] = useState<Ad | null>(null);
  const seq = useRef(0);

  const toast = useCallback((text: string, action?: ToastAction) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, text, action }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 4200 : 2400);
  }, []);

  const openSave = useCallback((ad: Ad) => setSaveFor(ad), []);

  const toggleSave = useCallback(
    (ad: Ad) => {
      if (isSaved(ad.id)) {
        const prev = savedStore.read().items[ad.id];
        removeAd(ad.id);
        toast("Kaydedilenlerden çıkarıldı", {
          label: "Geri al",
          onClick: () => {
            saveAd(prev.ad, prev.collectionId);
          },
        });
      } else {
        saveAd(ad);
        toast("Kaydedildi", { label: "Koleksiyon seç", onClick: () => setSaveFor(ad) });
      }
    },
    [toast],
  );

  const copyLink = useCallback(
    async (ad: Ad) => {
      const ok = await copyText(shareUrl(ad));
      toast(ok ? "Link kopyalandı" : "Kopyalanamadı — linki elle seç");
    },
    [toast],
  );

  const share = useCallback((ad: Ad) => {
    const url = shareUrl(ad);
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    if (coarse && typeof navigator.share === "function") {
      navigator
        .share({ title: `${ad.brand.name} reklamı · AdGym`, text: shareText(ad), url })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setShareFor(ad);
        });
      return;
    }
    setShareFor(ad);
  }, []);

  const value = useMemo<UI>(() => ({ toast, toggleSave, openSave, share, copyLink }), [toast, toggleSave, openSave, share, copyLink]);

  // Desktop: keep toasts inside the feed column (never over the filter / insights panel).
  // Pages without a feed get them centred in the main area via the lg: classes.
  const [anchor, setAnchor] = useState<CSSProperties | undefined>(undefined);
  const hasToasts = toasts.length > 0;
  useLayoutEffect(() => {
    if (!hasToasts) return;
    const el = document.querySelector<HTMLElement>("[data-toast-anchor]");
    if (!el || window.innerWidth < 1024) {
      setAnchor(undefined);
      return;
    }
    const r = el.getBoundingClientRect();
    // Just under the feed's top bar: never over the CTA row, the action rail or the side panels.
    setAnchor({ left: r.left, width: r.width, right: "auto", bottom: "auto", top: r.top + 64 });
  }, [hasToasts]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        style={anchor}
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom)+12px)] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-8 lg:left-60"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="animate-toast-in pointer-events-auto flex items-center gap-3 rounded-full border border-white/10 bg-zinc-900/95 py-2 pl-4 pr-2 text-sm text-white shadow-2xl shadow-black/60 backdrop-blur-xl"
          >
            <span className="flex items-center gap-2">
              <CheckIcon size={16} className="text-volt" />
              {t.text}
            </span>
            {t.action ? (
              <button
                type="button"
                className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-volt hover:bg-white/15"
                onClick={() => {
                  t.action?.onClick();
                  setToasts((all) => all.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            ) : (
              <span className="w-2" />
            )}
          </div>
        ))}
      </div>
      <SaveSheet ad={saveFor} onClose={() => setSaveFor(null)} toast={toast} />
      <ShareSheet ad={shareFor} onClose={() => setShareFor(null)} onCopy={copyLink} />
    </Ctx.Provider>
  );
}

function SaveSheet({ ad, onClose, toast }: { ad: Ad | null; onClose: () => void; toast: UI["toast"] }) {
  const state = useSaved();
  const [newName, setNewName] = useState("");
  const current = ad ? state.items[ad.id] : undefined;

  useEffect(() => {
    if (!ad) setNewName("");
  }, [ad]);

  if (!ad) return null;
  const choose = (collectionId: string) => {
    if (current) moveAd(ad.id, collectionId);
    else saveAd(ad, collectionId);
    const name = state.collections.find((c) => c.id === collectionId)?.name;
    toast(`“${name}” koleksiyonuna eklendi`);
    onClose();
  };
  const counts: Record<string, number> = {};
  for (const it of Object.values(state.items)) counts[it.collectionId] = (counts[it.collectionId] ?? 0) + 1;

  return (
    <Sheet open={Boolean(ad)} onClose={onClose} title="Koleksiyona kaydet">
      <p className="-mt-2 mb-4 truncate text-sm text-mist">
        {ad.brand.name} · {truncate(adTitle(ad), 60)}
      </p>
      <ul className="space-y-1.5">
        {state.collections.map((c) => {
          const active = current?.collectionId === c.id;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => choose(c.id)}
                className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${active ? "border-volt/50 bg-volt/10" : "border-line bg-white/[0.03] hover:bg-white/[0.07]"}`}
              >
                <FolderIcon size={18} className={active ? "text-volt" : "text-zinc-400"} />
                <span className="flex-1 truncate font-medium">{c.name}</span>
                <span className="text-xs text-mist">{counts[c.id] ?? 0}</span>
                {active && <CheckIcon size={18} className="text-volt" />}
              </button>
            </li>
          );
        })}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          const id = createCollection(newName);
          if (current) moveAd(ad.id, id);
          else saveAd(ad, id);
          toast(`“${newName.trim()}” oluşturuldu`);
          onClose();
        }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Yeni koleksiyon (ör. Hook örnekleri)"
          className="min-w-0 flex-1 rounded-2xl border border-line bg-white/[0.03] px-4 py-3 text-sm outline-none placeholder:text-zinc-500 focus:border-volt/60"
        />
        <button
          type="submit"
          disabled={!newName.trim()}
          className="flex items-center gap-1.5 rounded-2xl bg-volt px-4 text-sm font-semibold text-black disabled:opacity-40"
        >
          <PlusIcon size={16} /> Oluştur
        </button>
      </form>
      {current && (
        <button
          type="button"
          onClick={() => {
            removeAd(ad.id);
            toast("Kaydedilenlerden çıkarıldı");
            onClose();
          }}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm text-red-300 hover:bg-red-500/10"
        >
          <TrashIcon size={16} /> Kaydedilenlerden çıkar
        </button>
      )}
      {!current && (
        <p className="mt-4 text-center text-xs text-zinc-500">
          Varsayılan: {state.collections.find((c) => c.id === DEFAULT_COLLECTION_ID)?.name}
        </p>
      )}
    </Sheet>
  );
}

function ShareSheet({ ad, onClose, onCopy }: { ad: Ad | null; onClose: () => void; onCopy: (ad: Ad) => void }) {
  if (!ad) return null;
  const url = shareUrl(ad);
  const canNative = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <Sheet open={Boolean(ad)} onClose={onClose} title="Paylaş">
      <div className="mb-4 rounded-2xl border border-line bg-white/[0.03] p-3">
        <p className="text-sm font-medium">{ad.brand.name}</p>
        <p className="truncate text-xs text-mist">{url}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => {
            onCopy(ad);
            onClose();
          }}
          className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-white/[0.03] px-2 py-4 text-xs font-medium hover:bg-white/[0.07]"
        >
          <span className="grid size-11 place-items-center rounded-full bg-white/10">
            <LinkIcon size={20} />
          </span>
          Linki kopyala
        </button>
        <a
          href={whatsappHref(ad, url)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
          className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-white/[0.03] px-2 py-4 text-center text-xs font-medium hover:bg-white/[0.07]"
        >
          <span className="grid size-11 place-items-center rounded-full bg-[#25D366] text-white">
            <WhatsAppIcon size={22} />
          </span>
          WhatsApp&apos;ta gönder
        </a>
        <button
          type="button"
          disabled={!canNative}
          onClick={() => {
            navigator.share?.({ title: `${ad.brand.name} reklamı · AdGym`, text: shareText(ad), url }).catch(() => {});
            onClose();
          }}
          className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-white/[0.03] px-2 py-4 text-xs font-medium hover:bg-white/[0.07] disabled:opacity-40"
        >
          <span className="grid size-11 place-items-center rounded-full bg-white/10">
            <ShareIcon size={20} />
          </span>
          Diğer
        </button>
      </div>
    </Sheet>
  );
}
