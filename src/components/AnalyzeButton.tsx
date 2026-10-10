"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Ad } from "@/lib/types";
import { useSaved } from "@/lib/saved";
import { useHydrated } from "@/lib/store";
import { startAnalysis, useAnalysisJob } from "@/lib/analyze-client";
import { useActiveStrategy, useCanAnalyze, useRole, useViewerQuota } from "@/lib/role-client";
import { strategyBrand } from "@/lib/analysis";

/**
 * "✨ Özetle" — runs the Gemini breakdown for ONE saved ad, only when pressed (each press costs money).
 * The result is stored on the saved item (localStorage), so it shows up in /saved → "Özetler".
 *
 * Drop-in for the feed / details sheet:  <AnalyzeButton adId={ad.id} ad={ad} />
 *  - renders nothing until the ad is saved (unless `ad` is passed, then pressing saves it first)
 *  - when an analysis exists it becomes "Özeti gör" (→ /saved?ad=<id>, or `onOpen` if given)
 */
export function AnalyzeButton({
  adId,
  ad,
  variant = "pill",
  onOpen,
  className = "",
}: {
  adId: string;
  ad?: Ad;
  variant?: "pill" | "block";
  /** Called by "Özeti gör" instead of navigating to /saved. */
  onOpen?: () => void;
  className?: string;
}) {
  const hydrated = useHydrated();
  const state = useSaved();
  const item = state.items[adId];
  const job = useAnalysisJob(adId);
  const allowed = useCanAnalyze();
  const role = useRole();
  const quota = useViewerQuota();
  // Admin with an active brand strategy: remix ideas will follow it (shown before the paid press).
  const strategy = useActiveStrategy();
  // Viewers: remaining Gemini uses (null = admin/unlimited or not loaded yet; the server enforces it anyway).
  const remaining = role === "viewer" && quota ? Math.max(0, quota.limit - quota.used) : null;
  const isVideo = (item?.ad ?? ad)?.format === "video" || Boolean((item?.ad ?? ad)?.media.some((m) => m.type === "video"));

  if (!hydrated || (!item && !ad)) return null;
  // Unknown role (no session hint yet) → no paid controls.
  if (!allowed) return null;

  const base =
    variant === "block"
      ? "flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-bold"
      : "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold";

  if (job.status === "running") {
    return (
      <div className={className}>
        <div role="status" aria-live="polite" className={`${base} cursor-wait bg-volt/15 text-volt ring-1 ring-volt/30`}>
          <Spinner />
          <span className="truncate">{isVideo ? "Gemini videoyu izliyor…" : "Gemini reklamı inceliyor…"}</span>
          <Elapsed since={job.startedAt} />
        </div>
        {variant === "block" && <p className="mt-1.5 text-center text-[11px] text-zinc-500">Genelde 20–60 sn sürer. Bu sayfadan çıkabilirsin; sonuç kayda eklenir.</p>}
      </div>
    );
  }

  if (item?.analysis) {
    const cls = `${base} bg-white/[0.07] text-white ring-1 ring-white/10 hover:bg-white/[0.12]`;
    return onOpen ? (
      <button type="button" onClick={onOpen} className={`${cls} ${className}`}>
        <span aria-hidden>✨</span> Özeti gör
      </button>
    ) : (
      <Link href={`/saved?ad=${encodeURIComponent(adId)}`} className={`${cls} ${className}`}>
        <span aria-hidden>✨</span> Özeti gör
      </Link>
    );
  }

  if (remaining === 0) {
    return (
      <div className={className}>
        <button type="button" disabled className={`${base} cursor-not-allowed bg-white/[0.06] text-zinc-500 ring-1 ring-white/10`}>
          <span aria-hidden>✨</span> Hakkın doldu
        </button>
        {variant === "block" && <p className="mt-1.5 text-center text-[11px] text-zinc-500">Bu hesabın Gemini özet hakkı bitti ({quota?.used}/{quota?.limit}).</p>}
      </div>
    );
  }

  return (
    <div className={`${className} ${job.status === "error" && variant === "pill" ? "w-full" : ""}`}>
      <button
        type="button"
        onClick={() => void startAnalysis(adId, { ad: item ? undefined : ad })}
        title={strategy ? `Strateji: ${strategyBrand(strategy.name)}` : undefined}
        className={`${base} bg-volt text-black shadow-[0_0_24px_-8px] shadow-volt/60 hover:bg-volt-dim`}
      >
        <span aria-hidden>✨</span> {job.status === "error" ? "Tekrar dene" : "Özetle"}
        {remaining !== null && <span className="font-semibold opacity-70">({remaining} hakkın kaldı)</span>}
      </button>
      {strategy && variant === "block" && (
        <p
          className="mt-1.5 text-center text-[11px] font-semibold text-zinc-400"
          title={`Remix fikirleri "${strategy.name}" stratejisine göre üretilir`}
          data-testid="strategy-note"
        >
          <span className="text-volt">◆</span> Strateji: {strategyBrand(strategy.name)}
        </p>
      )}
      {job.status === "error" && <AnalyzeError adId={adId} ad={item ? undefined : ad} error={job.error} canUsePoster={job.canUsePoster} />}
    </div>
  );
}

export function AnalyzeError({ adId, ad, error, canUsePoster }: { adId: string; ad?: Ad; error: string; canUsePoster?: boolean }) {
  const allowed = useCanAnalyze();
  if (!allowed) return null;
  return (
    <div role="alert" className="mt-2 rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[12.5px] leading-snug text-red-200">
      {error}
      {canUsePoster && (
        <button
          type="button"
          onClick={() => void startAnalysis(adId, { ad, allowPoster: true })}
          className="mt-1.5 block rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15"
        >
          Poster görseli + metinle özetle
        </button>
      )}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0 animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - since) / 1000));
  return <span className="shrink-0 tabular-nums opacity-70">{s} sn</span>;
}
