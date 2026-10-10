"use client";

import Link from "next/link";
import { useState } from "react";
import {
  activeFilterCount,
  FORMAT_OPTIONS,
  MARKET_OPTIONS,
  SEGMENT_OPTIONS,
  SOURCE_OPTIONS,
  toggleValue,
  verticalLabel,
  type Facet,
  type FilterKey,
  type Filters,
} from "@/lib/filters";
import { XIcon } from "./Icons";

export function FilterPanel({
  filters,
  onChange,
  counts,
  verticals,
  brands,
  resultCount,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  counts: Partial<Record<FilterKey, Record<string, number>>>;
  verticals: Facet[];
  brands: Facet[];
  resultCount: number;
}) {
  const [showAllVerticals, setShowAllVerticals] = useState(false);
  const n = activeFilterCount(filters);
  const vList = showAllVerticals ? verticals : verticals.slice(0, 14);

  return (
    <div className="space-y-5">
      <Group title="Segment">
        {SEGMENT_OPTIONS.map((o) => (
          <Pill key={o.value} on={filters.segment.includes(o.value)} count={counts.segment?.[o.value]} onClick={() => onChange(toggleValue(filters, "segment", o.value))}>
            {o.label}
          </Pill>
        ))}
      </Group>
      <Group title="Pazar">
        {MARKET_OPTIONS.map((o) => (
          <Pill key={o.value} on={filters.market.includes(o.value)} count={counts.market?.[o.value]} onClick={() => onChange(toggleValue(filters, "market", o.value))}>
            {o.label}
          </Pill>
        ))}
      </Group>
      <Group title="Kaynak">
        {SOURCE_OPTIONS.filter((o) => (counts.source?.[o.value] ?? 0) > 0 || filters.source.includes(o.value) || o.value !== "curated").map((o) => (
          <Pill key={o.value} on={filters.source.includes(o.value)} count={counts.source?.[o.value]} onClick={() => onChange(toggleValue(filters, "source", o.value))}>
            {o.label}
          </Pill>
        ))}
      </Group>
      <Group title="Format">
        {FORMAT_OPTIONS.map((o) => (
          <Pill key={o.value} on={filters.format.includes(o.value)} count={counts.format?.[o.value]} onClick={() => onChange(toggleValue(filters, "format", o.value))}>
            {o.label}
          </Pill>
        ))}
      </Group>
      {verticals.length > 0 && (
        <Group title="Kategori">
          {vList.map((v) => (
            <Pill key={v.value} on={filters.vertical.includes(v.value)} count={v.count} onClick={() => onChange(toggleValue(filters, "vertical", v.value))}>
              {verticalLabel(v.value)}
            </Pill>
          ))}
          {verticals.length > 14 && (
            <button type="button" onClick={() => setShowAllVerticals((x) => !x)} className="px-2 text-xs font-semibold text-volt">
              {showAllVerticals ? "Daha az" : `+${verticals.length - 14} daha`}
            </button>
          )}
        </Group>
      )}
      {(brands.length > 0 || filters.brand.length > 0) && (
        <Group
          title="Marka"
          action={
            <Link href="/brands" className="text-xs font-semibold text-volt hover:underline">
              Tüm markalar →
            </Link>
          }
        >
          {filters.brand
            .filter((b) => !brands.some((x) => x.value.toLocaleLowerCase("tr") === b.toLocaleLowerCase("tr")))
            .map((b) => (
              <Pill key={b} on onClick={() => onChange({ ...filters, brand: filters.brand.filter((x) => x !== b) })}>
                {b}
              </Pill>
            ))}
          {brands.slice(0, 12).map((b) => {
            const on = filters.brand.some((x) => x.toLocaleLowerCase("tr") === b.value.toLocaleLowerCase("tr"));
            return (
              <Pill
                key={b.value}
                on={on}
                count={b.count}
                onClick={() =>
                  onChange({
                    ...filters,
                    brand: on ? filters.brand.filter((x) => x.toLocaleLowerCase("tr") !== b.value.toLocaleLowerCase("tr")) : [...filters.brand, b.value],
                  })
                }
              >
                {b.value}
              </Pill>
            );
          })}
        </Group>
      )}
      <div className="flex items-center justify-between border-t border-line pt-4 text-sm">
        <span className="text-mist">
          <span className="font-semibold text-white tabular-nums">{resultCount}</span> reklam
        </span>
        {n > 0 && (
          <button
            type="button"
            onClick={() => onChange({ segment: [], market: [], source: [], format: [], vertical: [], brand: [] })}
            className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/5"
          >
            <XIcon size={14} /> Temizle ({n})
          </button>
        )}
      </div>
    </div>
  );
}

function Group({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{title}</h3>
        {action}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </section>
  );
}

function Pill({ on, count, children, onClick }: { on: boolean; count?: number; children: React.ReactNode; onClick: () => void }) {
  const empty = count === 0 && !on;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition ${
        on ? "bg-volt text-black" : empty ? "bg-white/[0.03] text-zinc-600 ring-1 ring-white/5" : "bg-white/[0.06] text-zinc-200 ring-1 ring-white/10 hover:bg-white/[0.1]"
      }`}
    >
      {children}
      {count !== undefined && <span className={`text-[11px] tabular-nums ${on ? "text-black/60" : "text-zinc-500"}`}>{count}</span>}
    </button>
  );
}
