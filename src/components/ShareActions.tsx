"use client";

import type { Ad } from "@/lib/types";
import { useSaved } from "@/lib/saved";
import { BookmarkIcon, ExternalIcon, FolderIcon, LinkIcon, ShareIcon, WhatsAppIcon } from "./Icons";
import { useUI, whatsappHref } from "./UIProvider";
import { useHydrated } from "@/lib/store";

export function ShareActions({ ad }: { ad: Ad }) {
  const ui = useUI();
  const saved = useSaved();
  const hydrated = useHydrated();
  const isSaved = Boolean(saved.items[ad.id]);
  const collection = isSaved ? saved.collections.find((c) => c.id === saved.items[ad.id].collectionId)?.name : undefined;
  const btn = "flex h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold transition";
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => ui.toggleSave(ad)} className={`${btn} ${isSaved ? "bg-volt text-black" : "bg-white text-black hover:bg-volt"}`}>
          <BookmarkIcon size={18} filled={isSaved} /> {isSaved ? "Kaydedildi" : "Kaydet"}
        </button>
        <button type="button" onClick={() => ui.share(ad)} className={`${btn} bg-white/[0.07] ring-1 ring-white/10 hover:bg-white/[0.12]`}>
          <ShareIcon size={18} /> Paylaş
        </button>
        <button type="button" onClick={() => ui.copyLink(ad)} className={`${btn} bg-white/[0.07] ring-1 ring-white/10 hover:bg-white/[0.12]`}>
          <LinkIcon size={18} /> Linki kopyala
        </button>
        <a
          href={hydrated ? whatsappHref(ad) : "#"}
          target="_blank"
          rel="noopener noreferrer"
          className={`${btn} bg-[#25D366]/15 text-[#5ef08f] ring-1 ring-[#25D366]/30 hover:bg-[#25D366]/25`}
        >
          <WhatsAppIcon size={18} /> WhatsApp&apos;ta gönder
        </a>
      </div>
      {isSaved && (
        <button type="button" onClick={() => ui.openSave(ad)} className="flex w-full items-center justify-center gap-2 py-1 text-xs text-mist hover:text-white">
          <FolderIcon size={14} /> {collection} · koleksiyonu değiştir
        </button>
      )}
      <a
        href={ad.libraryUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`${btn} w-full bg-white/[0.04] text-zinc-200 ring-1 ring-white/10 hover:bg-white/[0.08]`}
      >
        {ad.source === "tiktok" ? "TikTok'ta aç" : "Ad Library'de aç"} <ExternalIcon size={16} />
      </a>
    </div>
  );
}
