"use client";

import Link from "next/link";
import { useRef, useState, type RefObject } from "react";
import type { Ad } from "@/lib/types";
import { addNote, moveAd, type Collection, type SavedItem } from "@/lib/saved";
import { startAnalysis, useAnalysisJob } from "@/lib/analyze-client";
import { useCanAnalyze, useRole, useViewerQuota } from "@/lib/role-client";
import { adPath, daysLabel, libraryLabel, platformLabel, previewImage, scoreText } from "@/lib/format";
import { SEGMENT_LABEL } from "@/lib/filters";
import { adYouTubeId, isYouTubeUrl } from "@/lib/youtube";
import { AdThumb } from "./AdThumb";
import { AnalysisView } from "./AnalysisView";
import { AnalyzeButton, AnalyzeError, Spinner } from "./AnalyzeButton";
import { NotesList } from "./NotesList";
import { ExternalIcon, PlayIcon, XIcon } from "./Icons";

/** Saved ad = playable media + metadata + (optional) Gemini breakdown + notes. Rendered inside a Sheet. */
export function SavedDetail({ item, collections, onRemove }: { item: SavedItem; collections: Collection[]; onRemove: () => void }) {
  const { ad } = item;
  const videoRef = useRef<HTMLVideoElement>(null);
  const notesRef = useRef<HTMLDivElement>(null);
  const job = useAnalysisJob(ad.id);
  const canAnalyze = useCanAnalyze();
  const role = useRole();
  const quota = useViewerQuota();
  const remaining = role === "viewer" && quota ? Math.max(0, quota.limit - quota.used) : null;
  const [confirmRerun, setConfirmRerun] = useState(false);
  const [bodyOpen, setBodyOpen] = useState(false);

  const seek = (s: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = s;
    v.scrollIntoView({ behavior: "smooth", block: "center" });
    void v.play().catch(() => {});
  };

  const days = daysLabel(ad);
  const chips = [
    scoreText(ad),
    days,
    ad.variations ? `${ad.variations} varyasyon` : undefined,
    SEGMENT_LABEL[ad.segment],
    ad.market,
    ad.vertical,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-5">
      <DetailMedia ad={ad} videoRef={videoRef} />

      {/* metadata */}
      <section>
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c, i) => (
            <span key={c} className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${i === 0 ? "bg-volt text-black" : "bg-white/[0.07] text-zinc-200 ring-1 ring-white/10"}`}>
              {c}
            </span>
          ))}
        </div>
        {ad.platforms?.length ? <p className="mt-2 text-[12px] text-zinc-500">{ad.platforms.map(platformLabel).join(" · ")}</p> : null}
        {ad.headline && <p className="mt-3 text-[15px] font-bold leading-snug">{ad.headline}</p>}
        {ad.body && (
          <button type="button" onClick={() => setBodyOpen((o) => !o)} className="mt-1.5 block text-left">
            <p className={`whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-400 ${bodyOpen ? "" : "line-clamp-3"}`}>{ad.body}</p>
            {!bodyOpen && ad.body.length > 160 && <span className="text-[12px] font-semibold text-zinc-300">Devamı</span>}
          </button>
        )}
        {ad.cta && <p className="mt-2 text-[12px] text-zinc-500">CTA: <span className="font-semibold text-zinc-300">{ad.cta}</span></p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={ad.libraryUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-xs font-semibold hover:bg-white/[0.12]">
            <ExternalIcon size={14} /> {libraryLabel(ad)}
          </a>
          <Link href={adPath(ad.id)} className="flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-xs font-semibold hover:bg-white/[0.12]">
            <PlayIcon size={14} /> Akışta aç
          </Link>
          <button
            type="button"
            onClick={() => notesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="rounded-full bg-white/[0.07] px-3 py-1.5 text-xs font-semibold hover:bg-white/[0.12]"
          >
            Notlarım ({item.notes.length}) ↓
          </button>
        </div>
      </section>

      {/* Gemini breakdown — only after an explicit press */}
      <section aria-label="Gemini özeti">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-volt">✨ Özet</h3>
          {canAnalyze && item.analysis && job.status !== "running" && (
            confirmRerun ? (
              <span className="flex items-center gap-1.5 text-[11.5px] text-zinc-400">
                {remaining !== null ? `Yeni bir ücretli çağrı yapılır; 1 hakkın gider (${remaining} hakkın kaldı).` : "Yeni bir ücretli çağrı yapılır."}
                <button
                  type="button"
                  onClick={() => {
                    setConfirmRerun(false);
                    void startAnalysis(ad.id, { force: true, allowPoster: item.analysis?.input === "poster" });
                  }}
                  className="rounded-full bg-volt px-2.5 py-1 font-bold text-black"
                >
                  Özetle
                </button>
                <button type="button" onClick={() => setConfirmRerun(false)} aria-label="Vazgeç" className="grid size-6 place-items-center rounded-full bg-white/[0.07]">
                  <XIcon size={12} />
                </button>
              </span>
            ) : remaining === 0 ? (
              <span className="text-xs font-semibold text-zinc-500">Hakkın doldu</span>
            ) : (
              <button type="button" onClick={() => setConfirmRerun(true)} className="rounded-full bg-white/[0.07] px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/[0.12]">
                ↻ Yeniden özetle
              </button>
            )
          )}
        </div>

        {item.analysis ? (
          <>
            {job.status === "running" && (
              <p role="status" className="mb-3 flex items-center gap-2 rounded-2xl bg-volt/10 px-3 py-2 text-[12.5px] font-semibold text-volt">
                <Spinner size={14} /> Yeniden özetleniyor… (20–60 sn)
              </p>
            )}
            {job.status === "error" && <div className="mb-3"><AnalyzeError adId={ad.id} error={job.error} canUsePoster={job.canUsePoster} /></div>}
            <AnalysisView record={item.analysis} onSeek={hasNativeVideo(ad) ? seek : undefined} onAddNote={(t) => addNote(ad.id, `Remix fikri: ${t}`)} />
          </>
        ) : (
          <div className="rounded-3xl border border-dashed border-line p-4">
            {job.status !== "running" && (
              <p className="mb-3 text-[13px] leading-relaxed text-zinc-400">
                Gemini reklamı sahne sahne çözer: hook, transkript, yapı, neden kazandığı ve sana özel 3 remix fikri. Sadece bastığında çalışır (ücretli çağrı).
              </p>
            )}
            <AnalyzeButton adId={ad.id} variant="block" />
          </div>
        )}
      </section>

      <div ref={notesRef} className="scroll-mt-4">
        <NotesList adId={ad.id} notes={item.notes} />
      </div>

      <section className="flex items-center gap-2 border-t border-line pt-4">
        <select
          value={item.collectionId}
          onChange={(e) => moveAd(ad.id, e.target.value)}
          aria-label="Koleksiyona taşı"
          className="min-w-0 flex-1 truncate rounded-xl border border-line bg-ink-3 px-3 py-2 text-xs font-semibold text-zinc-200 outline-none focus:border-volt/60"
        >
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={onRemove} className="rounded-xl px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10">
          Kayıttan çıkar
        </button>
      </section>
    </div>
  );
}

function hasNativeVideo(ad: Ad) {
  return !adYouTubeId(ad) && ad.media.some((m) => m.type === "video" && !isYouTubeUrl(m.url));
}

function DetailMedia({ ad, videoRef }: { ad: Ad; videoRef: RefObject<HTMLVideoElement | null> }) {
  const [videoFailed, setVideoFailed] = useState(false);
  const [badImages, setBadImages] = useState<ReadonlySet<string>>(() => new Set());
  const yt = adYouTubeId(ad);
  const video = ad.media.find((m) => m.type === "video" && !isYouTubeUrl(m.url));
  const poster = previewImage(ad);

  if (yt) {
    return (
      <div className="overflow-hidden rounded-2xl bg-black">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${yt}?rel=0&modestbranding=1&playsinline=1`}
          title={`${ad.brand.name} — YouTube`}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="aspect-video w-full"
        />
      </div>
    );
  }

  if (video && !videoFailed) {
    return (
      <div className="overflow-hidden rounded-2xl bg-black">
        <video
          ref={videoRef}
          src={video.url}
          poster={video.thumbnailUrl ?? poster}
          controls
          playsInline
          preload="metadata"
          onError={() => setVideoFailed(true)}
          className="mx-auto max-h-[55dvh] w-full object-contain"
        />
      </div>
    );
  }

  const images = ad.media
    .map((m) => (m.type === "image" ? (m.thumbnailUrl?.startsWith("/") ? m.thumbnailUrl : m.url) : m.thumbnailUrl))
    .filter((u): u is string => Boolean(u) && !badImages.has(u!));

  return (
    <div className="relative">
      {images.length ? (
        <div className="no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto rounded-2xl">
          {images.map((src) => (
            <img
              key={src}
              src={src}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setBadImages((s) => new Set(s).add(src))}
              className={`max-h-[55dvh] shrink-0 snap-center rounded-2xl bg-ink-3 object-contain ${images.length > 1 ? "w-[85%]" : "mx-auto w-full"}`}
            />
          ))}
        </div>
      ) : (
        <div className="mx-auto w-48 overflow-hidden rounded-2xl">
          <AdThumb ad={ad} />
        </div>
      )}
      {video && videoFailed && (
        <p className="mt-2 rounded-2xl bg-ember/10 px-3 py-2 text-[12px] leading-snug text-orange-200">
          Video linkinin süresi dolmuş; reklamı Ad Library&apos;de açıp izleyebilirsin.
        </p>
      )}
    </div>
  );
}
