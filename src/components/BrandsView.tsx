"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { BrandSummary } from "@/lib/ads";
import { MARKET_OPTIONS, SEGMENT_LABEL, SEGMENT_OPTIONS, verticalLabel } from "@/lib/filters";
import { brandFeedPath } from "@/lib/format";
import type { Market, Segment } from "@/lib/types";
import { BrandAvatar, LegendBadge, ScoreRing } from "./Bits";
import { SearchIcon } from "./Icons";

export function BrandsView({ brands, totalAds }: { brands: BrandSummary[]; totalAds: number }) {
  const [q, setQ] = useState("");
  const [segment, setSegment] = useState<Segment | "">("");
  const [market, setMarket] = useState<Market | "">("");

  const list = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr");
    return brands.filter(
      (b) =>
        (!segment || b.segments.includes(segment)) &&
        (!market || b.markets.includes(market)) &&
        (!needle || b.name.toLocaleLowerCase("tr").includes(needle) || b.verticals.some((v) => v.includes(needle) || verticalLabel(v).toLocaleLowerCase("tr").includes(needle))),
    );
  }, [brands, q, segment, market]);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-6 lg:px-8 lg:pt-10">
      <header className="mb-6">
        <h1 className="text-3xl font-black tracking-tight lg:text-4xl">Markalar</h1>
        <p className="mt-1 text-sm text-mist">
          {brands.length} marka · {totalAds} reklam. Bir markaya dokun, sadece onun reklamlarını kaydır.
        </p>
      </header>

      <div className="sticky top-0 z-20 -mx-4 mb-5 space-y-3 bg-ink/85 px-4 py-3 backdrop-blur-xl lg:-mx-8 lg:px-8">
        <label className="flex items-center gap-2 rounded-2xl border border-line bg-white/[0.04] px-4 focus-within:border-volt/60">
          <SearchIcon size={18} className="text-zinc-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Marka veya kategori ara"
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-500"
          />
        </label>
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
          <Seg on={!segment} onClick={() => setSegment("")}>
            Tümü
          </Seg>
          {SEGMENT_OPTIONS.map((o) => (
            <Seg key={o.value} on={segment === o.value} onClick={() => setSegment(segment === o.value ? "" : o.value)}>
              {o.label}
            </Seg>
          ))}
          <span className="mx-1 w-px shrink-0 bg-line" />
          {MARKET_OPTIONS.map((o) => (
            <Seg key={o.value} on={market === o.value} onClick={() => setMarket(market === o.value ? "" : o.value)}>
              {o.label}
            </Seg>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <p className="py-20 text-center text-sm text-mist">Eşleşen marka yok.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((b) => (
            <li key={b.key}>
              <Link
                href={brandFeedPath(b.name)}
                className="group flex items-center gap-3 rounded-3xl border border-line bg-ink-2 p-4 transition hover:border-white/20 hover:bg-ink-3"
              >
                <BrandAvatar name={b.name} logoUrl={b.logoUrl} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{b.name}</p>
                  <p className="truncate text-xs text-mist">
                    {[b.segments.map((s) => SEGMENT_LABEL[s]).join("/"), b.markets.join("/"), b.verticals[0] && verticalLabel(b.verticals[0]) !== SEGMENT_LABEL[b.segments[0]] ? verticalLabel(b.verticals[0]) : undefined].filter(Boolean).join(" · ")}
                  </p>
                  <p className="mt-1.5 text-xs text-zinc-400">
                    <span className="font-semibold text-white">{b.count}</span> reklam
                    {b.maxDays > 0 && (
                      <>
                        {" · "}en uzun <span className="font-semibold text-orange-300">{b.maxDays} gün</span>
                      </>
                    )}
                  </p>
                </div>
                {b.sources.length === 1 && b.sources[0] === "curated" ? <LegendBadge size={42} /> : <ScoreRing score={b.topScore} size={42} stroke={3.5} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Seg({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${on ? "bg-white text-black" : "bg-white/[0.06] text-zinc-300 ring-1 ring-white/10 hover:bg-white/[0.1]"}`}
    >
      {children}
    </button>
  );
}
