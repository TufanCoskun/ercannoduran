"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Ad, Format, Market, Segment } from "@/lib/types";
import { effectiveFormat, facetCounts, verticalLabel } from "@/lib/filters";
import {
  COUNT_PRESETS,
  DEFAULT_COUNT,
  EMPTY_TINDER_FILTERS,
  filterPool,
  filtersLabel,
  remainingIds,
  stageOf,
  type TinderFilters,
  type TinderSession,
} from "@/lib/tinder";
import { HeartIcon, CardsIcon } from "./bits";
import { PlaySolidIcon, TrophyIcon } from "../Icons";

const MARKETS: { value: Market; label: string }[] = [
  { value: "TR", label: "TR" },
  { value: "US", label: "US" },
  { value: "GLOBAL", label: "Global" },
];
const SEGMENTS: { value: Segment; label: string }[] = [
  { value: "dtc", label: "DTC" },
  { value: "hotel", label: "Otel" },
  { value: "general", label: "Genel" },
];
const FORMATS: { value: Format; label: string }[] = [
  { value: "video", label: "Video" },
  { value: "image", label: "Görsel" },
  { value: "carousel", label: "Carousel" },
  { value: "text", label: "Metin" },
];

type ListKey = "market" | "segment" | "vertical" | "format";

function toggle<T extends string>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function TinderSetup({
  ads,
  initialFilters,
  initialCount,
  resume,
  seenCount,
  seenIds,
  onStart,
  onResume,
  onDiscard,
}: {
  ads: Ad[];
  initialFilters?: TinderFilters;
  initialCount?: number;
  resume: TinderSession | null;
  seenCount: number;
  seenIds: ReadonlySet<string>;
  onStart: (filters: TinderFilters, count: number, preferUnseen: boolean) => void;
  onResume: () => void;
  onDiscard: () => void;
}) {
  const [filters, setFilters] = useState<TinderFilters>(initialFilters ?? EMPTY_TINDER_FILTERS);
  const [count, setCount] = useState<number>(initialCount ?? DEFAULT_COUNT);
  const [custom, setCustom] = useState<string>(initialCount && !COUNT_PRESETS.includes(initialCount as (typeof COUNT_PRESETS)[number]) ? String(initialCount) : "");
  const [preferUnseen, setPreferUnseen] = useState(true);
  const [allVerticals, setAllVerticals] = useState(false);

  const pool = useMemo(() => filterPool(ads, filters), [ads, filters]);
  const unseenInPool = useMemo(() => pool.filter((a) => !seenIds.has(a.id)).length, [pool, seenIds]);

  // Faceted counts: each group counts ads matching every *other* active choice.
  const facets = useMemo(() => {
    const except = (k: ListKey) => filterPool(ads, { ...filters, [k]: [], ...(k === "format" ? { videoOnly: false } : {}) });
    const map = (xs: { value: string; count: number }[]) => Object.fromEntries(xs.map((x) => [x.value, x.count])) as Record<string, number>;
    return {
      market: map(facetCounts(except("market"), (a) => a.market)),
      segment: map(facetCounts(except("segment"), (a) => a.segment)),
      format: map(facetCounts(except("format"), effectiveFormat)),
      vertical: facetCounts(except("vertical"), (a) => a.vertical),
    };
  }, [ads, filters]);

  const max = pool.length;
  const effective = Math.max(0, Math.min(count, max));
  const canStart = effective >= 2;
  const verticals = allVerticals ? facets.vertical : facets.vertical.slice(0, 12);
  const extraVerticals = filters.vertical.filter((v) => !verticals.some((x) => x.value === v));
  const nActive = filters.market.length + filters.segment.length + filters.vertical.length + filters.format.length + (filters.videoOnly ? 1 : 0);

  const resumeStage = resume ? stageOf(resume) : null;
  const resumeDone = resume ? resume.pool.length - remainingIds(resume).length : 0;

  return (
    <div className="mx-auto max-w-2xl px-4 pb-36 pt-5 lg:px-8 lg:pb-16 lg:pt-10">
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-rose-500 to-orange-400 text-white shadow-[0_10px_40px_-10px_rgba(244,63,94,0.7)]">
            <CardsIcon size={24} />
          </span>
          <div>
            <h1 className="text-3xl font-black tracking-tight lg:text-4xl">Tinder</h1>
            <p className="text-sm text-mist">Rastgele reklamlar · sağa beğen, sola geç · sonra kafa kafaya turnuva</p>
          </div>
        </div>
      </header>

      {resume && resumeStage !== "done" && (
        <section className="mb-6 rounded-3xl border border-volt/30 bg-volt/[0.06] p-4" data-resume="">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-volt">Yarım kalan Tinder</p>
          <p className="mt-1 font-bold">{filtersLabel(resume.filters)}</p>
          <p className="text-sm text-mist">
            {resumeStage === "swipe"
              ? `Round 1 · ${resumeDone}/${resume.pool.length} · ♥ ${resume.round1.liked.length}`
              : resumeStage === "summary"
                ? `Round 1 bitti · ${resume.round1.liked.length} beğeni`
                : `Round ${resume.rounds[resume.rounds.length - 1]?.round ?? 2} · ${resume.round1.liked.length} beğeniden turnuva`}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={onResume} className="h-11 rounded-2xl bg-volt text-sm font-bold text-black">
              Devam et
            </button>
            <button type="button" onClick={onDiscard} className="h-11 rounded-2xl bg-white/[0.07] text-sm font-semibold ring-1 ring-white/10 hover:bg-white/[0.12]">
              Yeni başla
            </button>
          </div>
        </section>
      )}

      <div className="space-y-6">
        <Group title="Kaç reklam?">
          {COUNT_PRESETS.map((n) => (
            <Pill
              key={n}
              on={count === n && !custom}
              disabled={n > max && !(count === n && !custom)}
              onClick={() => {
                setCount(n);
                setCustom("");
              }}
            >
              {n}
            </Pill>
          ))}
          <label className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] ring-1 transition ${custom ? "bg-volt/10 ring-volt/50" : "bg-white/[0.04] ring-white/10"}`}>
            <span className="text-zinc-400">Özel</span>
            <input
              type="number"
              inputMode="numeric"
              min={2}
              max={max || undefined}
              value={custom}
              placeholder="—"
              aria-label="Özel reklam sayısı"
              onChange={(e) => {
                const raw = e.target.value.replace(/[^\d]/g, "").slice(0, 4);
                setCustom(raw);
                const n = Number(raw);
                if (raw && Number.isFinite(n)) setCount(Math.max(2, n));
                else if (!raw) setCount(DEFAULT_COUNT);
              }}
              onBlur={() => {
                if (custom && Number(custom) > max && max > 0) {
                  setCustom(String(max));
                  setCount(max);
                }
              }}
              className="w-14 bg-transparent py-0.5 font-semibold tabular-nums text-white outline-none placeholder:text-zinc-600 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
          </label>
        </Group>

        <Group title="Pazar">
          {MARKETS.map((o) => (
            <Pill key={o.value} on={filters.market.includes(o.value)} count={facets.market[o.value] ?? 0} onClick={() => setFilters({ ...filters, market: toggle(filters.market, o.value) })}>
              {o.label}
            </Pill>
          ))}
        </Group>

        <Group title="Segment">
          {SEGMENTS.map((o) => (
            <Pill key={o.value} on={filters.segment.includes(o.value)} count={facets.segment[o.value] ?? 0} onClick={() => setFilters({ ...filters, segment: toggle(filters.segment, o.value) })}>
              {o.label}
            </Pill>
          ))}
        </Group>

        {(facets.vertical.length > 0 || filters.vertical.length > 0) && (
          <Group title="Kategori">
            {extraVerticals.map((v) => (
              <Pill key={v} on onClick={() => setFilters({ ...filters, vertical: toggle(filters.vertical, v) })}>
                {verticalLabel(v)}
              </Pill>
            ))}
            {verticals.map((v) => (
              <Pill key={v.value} on={filters.vertical.includes(v.value)} count={v.count} onClick={() => setFilters({ ...filters, vertical: toggle(filters.vertical, v.value) })}>
                {verticalLabel(v.value)}
              </Pill>
            ))}
            {facets.vertical.length > 12 && (
              <button type="button" onClick={() => setAllVerticals((x) => !x)} className="px-2 text-xs font-semibold text-volt">
                {allVerticals ? "Daha az" : `+${facets.vertical.length - 12} daha`}
              </button>
            )}
          </Group>
        )}

        <Group title="Format">
          {FORMATS.map((o) => (
            <Pill
              key={o.value}
              on={filters.videoOnly ? o.value === "video" : filters.format.includes(o.value)}
              disabled={filters.videoOnly && o.value !== "video"}
              count={facets.format[o.value] ?? 0}
              onClick={() => !filters.videoOnly && setFilters({ ...filters, format: toggle(filters.format, o.value) })}
            >
              {o.label}
            </Pill>
          ))}
        </Group>

        <div className="space-y-2">
          <Switch
            on={filters.videoOnly}
            onClick={() => setFilters({ ...filters, videoOnly: !filters.videoOnly })}
            icon={<PlaySolidIcon size={15} className="text-zinc-300" />}
            label="Sadece video"
          />
          <Switch
            on={preferUnseen}
            onClick={() => setPreferUnseen((x) => !x)}
            icon={<span className="text-[15px] leading-none">✨</span>}
            label="Yeni reklamlara öncelik ver"
            sub={seenCount ? `Son oturumlarda ${seenCount} reklam gördün · havuzda ${unseenInPool} yeni` : "Son oturumlarda gördüklerin sona kalır"}
          />
        </div>

        {nActive > 0 && (
          <button type="button" onClick={() => setFilters(EMPTY_TINDER_FILTERS)} className="text-xs font-semibold text-zinc-400 hover:text-white">
            Filtreleri temizle ({nActive})
          </button>
        )}

        <Link href="/tinder/history" className="flex items-center gap-2.5 rounded-2xl border border-line bg-white/[0.03] px-4 py-3 text-sm font-semibold transition hover:bg-white/[0.07]">
          <TrophyIcon size={18} className="text-amber-300" />
          <span className="flex-1">Tinder özetleri</span>
          <span className="text-zinc-500">→</span>
        </Link>
      </div>

      {/* sticky start bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-ink via-ink/95 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-8 lg:static lg:mt-8 lg:bg-none lg:p-0">
        <div className="mx-auto max-w-2xl">
          <p className="mb-2 text-center text-sm text-mist" data-pool-size={max}>
            Havuzda <span className="font-bold tabular-nums text-white">{max}</span> reklam var
            {max > 0 && count > max ? <span className="text-zinc-500"> · hepsi gelir</span> : null}
          </p>
          <button
            type="button"
            disabled={!canStart}
            onClick={() => onStart(filters, effective, preferUnseen)}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500 to-orange-400 text-lg font-black text-white shadow-[0_16px_50px_-14px_rgba(244,63,94,0.8)] transition hover:brightness-110 active:scale-[0.99] disabled:from-zinc-700 disabled:to-zinc-700 disabled:text-zinc-400 disabled:shadow-none"
          >
            <HeartIcon size={20} filled /> Başla{canStart ? ` · ${effective} reklam` : ""}
          </button>
          {!canStart && <p className="mt-2 text-center text-xs text-zinc-500">En az 2 reklam gerekli — filtreleri genişlet.</p>}
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{title}</h2>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </section>
  );
}

function Pill({ on, count, disabled, children, onClick }: { on: boolean; count?: number; disabled?: boolean; children: React.ReactNode; onClick: () => void }) {
  const empty = (count === 0 && !on) || disabled;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold transition ${
        on ? "bg-volt text-black" : empty ? "bg-white/[0.03] text-zinc-600 ring-1 ring-white/5" : "bg-white/[0.06] text-zinc-200 ring-1 ring-white/10 hover:bg-white/[0.1]"
      }`}
    >
      {children}
      {count !== undefined && <span className={`text-[11px] tabular-nums ${on ? "text-black/60" : "text-zinc-500"}`}>{count}</span>}
    </button>
  );
}

function Switch({ on, onClick, icon, label, sub }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; sub?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white/[0.03] px-4 py-3 text-left transition hover:bg-white/[0.07]"
    >
      <span className="grid size-5 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{label}</span>
        {sub && <span className="block truncate text-[12px] text-mist">{sub}</span>}
      </span>
      <span className={`relative h-6 w-10 shrink-0 rounded-full transition ${on ? "bg-volt" : "bg-white/15"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full shadow transition-all ${on ? "left-[1.125rem] bg-black" : "left-0.5 bg-white"}`} />
      </span>
    </button>
  );
}
