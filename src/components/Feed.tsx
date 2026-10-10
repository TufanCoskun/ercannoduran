"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Ad } from "@/lib/types";
import {
  activeFilterCount,
  effectiveFormat,
  interleaveCurated,
  facetCounts,
  filtersToQuery,
  matchesFilters,
  parseFilters,
  type FilterKey,
  type Filters,
} from "@/lib/filters";
import { currentStreak, dateKey, DAILY_SIZE, markDailyViewed, pickDaily, useProgress, viewedToday } from "@/lib/daily";
import { useHydrated } from "@/lib/store";
import { adPath, daysLabel, displayReasons, formatDate, libraryLabel, platformLabel } from "@/lib/format";
import { AdCard } from "./AdCard";
import { AdScore, Chip } from "./Bits";
import { FilterPanel } from "./FilterPanel";
import { Sheet } from "./Sheet";
import { useUI } from "./UIProvider";
import { ChevronDownIcon, ChevronUpIcon, DumbbellIcon, ExternalIcon, FlameIcon, KeyboardIcon, PlaySolidIcon, SlidersIcon, TrophyIcon, XIcon } from "./Icons";

const WINDOW = 3; // mount AdCards only within ±3 of the active item
const PAGE = 15; // progressively grow the list

export function Feed({ ads, usingFixtures }: { ads: Ad[]; usingFixtures: boolean }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = useMemo(() => parseFilters(sp), [sp]);
  const daily = sp.get("mode") === "daily";
  const hydrated = useHydrated();
  const today = hydrated ? dateKey() : "";
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeAd, setActiveAd] = useState<Ad | undefined>(undefined);

  const pool = useMemo(() => interleaveCurated(ads.filter((a) => matchesFilters(a, filters))), [ads, filters]);
  const list = useMemo(() => (daily ? (today ? pickDaily(pool, today) : []) : pool), [daily, pool, today]);

  const setFilters = useCallback(
    (f: Filters) => {
      router.replace(`${pathname}${filtersToQuery(f, { mode: daily ? "daily" : undefined })}`, { scroll: false });
    },
    [router, pathname, daily],
  );
  const setMode = (d: boolean) => router.replace(`${pathname}${filtersToQuery(filters, { mode: d ? "daily" : undefined })}`, { scroll: false });

  // Faceted counts: for each group, count ads that match every *other* active filter.
  const { counts, verticals, brands } = useMemo(() => {
    const except = (k: FilterKey) => ads.filter((a) => matchesFilters(a, { ...filters, [k]: [] }));
    const toMap = (fs: { value: string; count: number }[]) => Object.fromEntries(fs.map((f) => [f.value, f.count]));
    return {
      counts: {
        segment: toMap(facetCounts(except("segment"), (a) => a.segment)),
        market: toMap(facetCounts(except("market"), (a) => a.market)),
        source: toMap(facetCounts(except("source"), (a) => a.source)),
        format: toMap(facetCounts(except("format"), effectiveFormat)),
      },
      verticals: facetCounts(except("vertical"), (a) => a.vertical),
      brands: facetCounts(except("brand"), (a) => a.brand.name),
    };
  }, [ads, filters]);

  const sourcesAvailable = useMemo(() => [...new Set(ads.map((a) => a.source))], [ads]);
  const listKey = `${daily ? "daily" : "feed"}|${today}|${filtersToQuery(filters)}`;
  const nFilters = activeFilterCount(filters);

  const panel = (
    <FilterPanel filters={filters} onChange={setFilters} counts={counts} sourcesAvailable={sourcesAvailable} verticals={verticals} brands={brands} resultCount={pool.length} />
  );

  return (
    <div className="flex justify-center gap-24 lg:px-6 lg:py-6">
      <FeedColumn
        key={listKey}
        list={list}
        daily={daily}
        today={today}
        poolSize={pool.length}
        filters={filters}
        nFilters={nFilters}
        usingFixtures={usingFixtures}
        onOpenFilters={() => setFiltersOpen(true)}
        onClearFilters={() => setFilters({ segment: [], market: [], source: [], format: [], vertical: [], brand: [] })}
        onRemoveBrand={(b) => setFilters({ ...filters, brand: filters.brand.filter((x) => x !== b) })}
        onToggleVideo={() =>
          setFilters({ ...filters, format: filters.format.length === 1 && filters.format[0] === "video" ? [] : ["video"] })
        }
        setMode={setMode}
        onActive={setActiveAd}
      />

      <aside className="thin-scrollbar hidden h-[calc(100dvh-3rem)] w-[320px] shrink-0 space-y-4 overflow-y-auto pr-1 xl:block">
        {activeAd && <ActiveInsights ad={activeAd} />}
        <div className="rounded-3xl border border-line bg-ink-2 p-5">
          <div className="mb-4 flex items-center gap-2">
            <SlidersIcon size={16} className="text-volt" />
            <h2 className="text-sm font-semibold">Filtreler</h2>
          </div>
          {panel}
        </div>
        <Shortcuts />
      </aside>

      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filtrele">
        {panel}
        <button type="button" onClick={() => setFiltersOpen(false)} className="mt-5 h-12 w-full rounded-2xl bg-volt text-sm font-bold text-black">
          {pool.length} reklamı göster
        </button>
      </Sheet>
    </div>
  );
}

function FeedColumn({
  list,
  daily,
  today,
  poolSize,
  filters,
  nFilters,
  usingFixtures,
  onOpenFilters,
  onClearFilters,
  onRemoveBrand,
  onToggleVideo,
  setMode,
  onActive,
}: {
  list: Ad[];
  daily: boolean;
  today: string;
  poolSize: number;
  filters: Filters;
  nFilters: number;
  usingFixtures: boolean;
  onOpenFilters: () => void;
  onClearFilters: () => void;
  onRemoveBrand: (b: string) => void;
  onToggleVideo: () => void;
  setMode: (daily: boolean) => void;
  onActive: (ad: Ad | undefined) => void;
}) {
  const ui = useUI();
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [renderCount, setRenderCount] = useState(PAGE);
  const [muted, setMuted] = useState(true);
  const progress = useProgress();
  const viewed = today ? viewedToday(progress, today) : [];
  const streak = today ? currentStreak(progress, today) : 0;
  const total = list.length + 1; // + end card
  const shown = Math.min(total, renderCount);
  const listIds = useMemo(() => list.map((a) => a.id), [list]);
  const doneCount = listIds.filter((id) => viewed.includes(id)).length;
  const toggleMute = useCallback(() => setMuted((m) => !m), []);
  const videoOnly = filters.format.length === 1 && filters.format[0] === "video";
  const extraChips = filters.brand.length > 0 || usingFixtures;
  // First free line below the floating top bar; slide overlays (unmute pill, carousel counter) sit there.
  const chromeTop = daily ? (extraChips ? "7.5rem" : "5.75rem") : "5.5rem";

  // Track the active item with an IntersectionObserver rooted at the scroller.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) setActive(Number((e.target as HTMLElement).dataset.index));
        }
      },
      { root, threshold: [0.6] },
    );
    root.querySelectorAll<HTMLElement>("[data-index]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [shown]);

  // Grow the rendered list as the user approaches the end.
  useEffect(() => {
    if (active >= renderCount - 5 && renderCount < total) setRenderCount((c) => Math.min(total, c + PAGE));
  }, [active, renderCount, total]);

  useEffect(() => {
    onActive(list[active]);
  }, [active, list, onActive]);

  // Daily workout: an ad counts as "done" after ~1.2s on screen.
  useEffect(() => {
    if (!daily || !today) return;
    const ad = list[active];
    if (!ad) return;
    const t = window.setTimeout(() => markDailyViewed(today, ad.id, listIds), 1200);
    return () => window.clearTimeout(t);
  }, [daily, today, active, list, listIds]);

  const go = useCallback(
    (i: number) => {
      const el = scroller.current;
      if (!el) return;
      const next = Math.max(0, Math.min(total - 1, i));
      el.scrollTo({ top: next * el.clientHeight, behavior: "smooth" });
    },
    [total],
  );

  // Keyboard: ↑/↓ or j/k to move, s to save, m to toggle sound.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      const k = e.key;
      if (k === "ArrowDown" || k === "j" || k === "J" || k === "PageDown") {
        e.preventDefault();
        go(active + 1);
      } else if (k === "ArrowUp" || k === "k" || k === "K" || k === "PageUp") {
        e.preventDefault();
        go(active - 1);
      } else if (k === "s" || k === "S") {
        const ad = list[active];
        if (ad) {
          e.preventDefault();
          ui.toggleSave(ad);
        }
      } else if (k === "m" || k === "M") {
        toggleMute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, go, list, ui, toggleMute]);

  return (
    <div className="relative w-full lg:w-auto">
      <div
        style={{ "--chrome-top": `calc(${chromeTop} + env(safe-area-inset-top))` } as React.CSSProperties}
        data-toast-anchor=""
        className="h-feed relative w-full overflow-hidden bg-black lg:aspect-[9/16] lg:w-auto lg:max-w-[520px] lg:rounded-[2rem] lg:border lg:border-line lg:shadow-[0_30px_120px_-20px_rgba(200,255,46,0.12)]">
        {/* top bar */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="pointer-events-auto flex items-center justify-between gap-2">
            <Link href="/" className="flex items-center gap-1.5 rounded-full bg-black/30 px-2.5 py-1.5 backdrop-blur-md lg:hidden" aria-label="AdGym">
              <DumbbellIcon size={16} className="text-volt" />
              <span className="text-sm font-black tracking-tight">AdGym</span>
            </Link>
            <div className="flex rounded-full bg-black/40 p-1 text-[13px] font-semibold ring-1 ring-white/10 backdrop-blur-md lg:mx-auto">
              <button
                type="button"
                onClick={() => setMode(false)}
                className={`rounded-full px-3 py-1.5 transition ${!daily ? "bg-white text-black" : "text-white/75 hover:text-white"}`}
              >
                Akış
              </button>
              <button
                type="button"
                onClick={() => setMode(true)}
                className={`flex items-center gap-1 rounded-full px-3 py-1.5 transition ${daily ? "bg-volt text-black" : "text-white/75 hover:text-white"}`}
              >
                <span className="sm:hidden">Antrenman</span>
                <span className="hidden sm:inline">Bugünün antrenmanı</span>
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              {streak > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-1.5 text-xs font-bold text-orange-300 ring-1 ring-white/10 backdrop-blur-md lg:hidden" title={`${streak} günlük seri`}>
                  <FlameIcon size={14} filled /> {streak}
                </span>
              )}
              <button
                type="button"
                onClick={onOpenFilters}
                className="relative grid size-9 place-items-center rounded-full bg-black/40 text-white ring-1 ring-white/10 backdrop-blur-md xl:hidden"
                aria-label="Filtrele"
              >
                <SlidersIcon size={17} />
                {nFilters > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-volt text-[10px] font-bold text-black">{nFilters}</span>
                )}
              </button>
            </div>
          </div>

          {daily && list.length > 0 && (
            <div className="pointer-events-auto mt-2.5 px-1">
              <div className="flex gap-1">
                {list.map((a, i) => (
                  <button
                    key={a.id}
                    type="button"
                    aria-label={`${i + 1}. reklam`}
                    onClick={() => go(i)}
                    className={`h-1 flex-1 rounded-full transition-colors ${viewed.includes(a.id) ? "bg-volt" : i === active ? "bg-white/70" : "bg-white/20"}`}
                  />
                ))}
              </div>
              <p className="text-shadow mt-1.5 flex items-center justify-between text-[11px] font-semibold text-white/80">
                <span>Bugünün antrenmanı · {doneCount}/{list.length}</span>
                {streak > 0 && (
                  <span className="flex items-center gap-1 text-orange-300">
                    <FlameIcon size={12} filled /> {streak} gün seri
                  </span>
                )}
              </p>
            </div>
          )}

          {(!daily || extraChips) && (
            <div className="pointer-events-auto mt-2 flex flex-wrap gap-1.5 px-1">
              {!daily && (
                <button
                  type="button"
                  onClick={onToggleVideo}
                  aria-pressed={videoOnly}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 backdrop-blur-md transition ${videoOnly ? "bg-volt text-black ring-volt" : "bg-black/40 text-white ring-white/15 hover:bg-black/60"}`}
                >
                  <PlaySolidIcon size={11} /> Sadece video
                </button>
              )}
              {filters.brand.map((b) => (
                <button key={b} type="button" onClick={() => onRemoveBrand(b)} className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-black">
                  {b} <XIcon size={12} />
                </button>
              ))}
              {usingFixtures && (
                <span className="rounded-full bg-ember/20 px-2.5 py-1 text-[11px] font-semibold text-orange-200 ring-1 ring-ember/40 backdrop-blur">
                  Demo verisi — henüz ingest yapılmadı
                </span>
              )}
            </div>
          )}
        </div>

        {/* feed */}
        <div ref={scroller} className="no-scrollbar h-full snap-y snap-mandatory overflow-y-scroll overscroll-y-contain" tabIndex={-1}>
          {list.length === 0 ? (
            <EmptyState daily={daily} hydrated={Boolean(today) || !daily} poolSize={poolSize} onClear={onClearFilters} />
          ) : (
            Array.from({ length: shown }, (_, i) => {
              const ad = list[i];
              const mounted = Math.abs(i - active) <= WINDOW;
              return (
                <div key={ad?.id ?? "__end"} data-index={i} className="relative h-full w-full snap-start snap-always">
                  {ad ? (
                    mounted ? (
                      <AdCard
                        ad={ad}
                        active={i === active}
                        preload={i === active || i === active + 1 ? "auto" : Math.abs(i - active) <= 1 ? "metadata" : "none"}
                        muted={muted}
                        onToggleMute={toggleMute}
                      />
                    ) : (
                      <div className="h-full w-full bg-ink" />
                    )
                  ) : daily ? (
                    <DailyEnd done={doneCount} total={list.length} streak={streak} best={progress.best} onJump={() => go(list.findIndex((a) => !viewed.includes(a.id)))} onFeed={() => setMode(false)} />
                  ) : (
                    <FeedEnd count={list.length} nFilters={nFilters} onClear={onClearFilters} onDaily={() => setMode(true)} onTop={() => go(0)} />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* desktop up/down */}
      <div className="absolute -right-[4.25rem] top-1/2 hidden -translate-y-1/2 flex-col gap-3 lg:flex">
        <button
          type="button"
          onClick={() => go(active - 1)}
          disabled={active === 0}
          aria-label="Önceki reklam"
          className="grid size-11 place-items-center rounded-full bg-white/[0.06] text-white ring-1 ring-white/10 transition hover:bg-white/[0.12] disabled:opacity-30"
        >
          <ChevronUpIcon size={22} />
        </button>
        <button
          type="button"
          onClick={() => go(active + 1)}
          disabled={active >= total - 1 || list.length === 0}
          aria-label="Sonraki reklam"
          className="grid size-11 place-items-center rounded-full bg-white/[0.06] text-white ring-1 ring-white/10 transition hover:bg-white/[0.12] disabled:opacity-30"
        >
          <ChevronDownIcon size={22} />
        </button>
      </div>
    </div>
  );
}

function EmptyState({ daily, hydrated, poolSize, onClear }: { daily: boolean; hydrated: boolean; poolSize: number; onClear: () => void }) {
  if (!hydrated) return <div className="h-full w-full animate-pulse bg-ink-2" />;
  return (
    <div className="grid h-full place-items-center px-8 text-center">
      <div>
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-white/5 text-volt">
          <SlidersIcon size={24} />
        </div>
        <h2 className="text-lg font-bold">Bu filtrelerle reklam yok</h2>
        <p className="mt-1 text-sm text-mist">{daily && poolSize === 0 ? "Antrenman için havuz boş." : "Birkaç filtreyi kaldırıp tekrar dene."}</p>
        <button type="button" onClick={onClear} className="mt-5 rounded-full bg-volt px-5 py-2.5 text-sm font-bold text-black">
          Filtreleri temizle
        </button>
      </div>
    </div>
  );
}

function DailyEnd({
  done,
  total,
  streak,
  best,
  onJump,
  onFeed,
}: {
  done: number;
  total: number;
  streak: number;
  best: number;
  onJump: () => void;
  onFeed: () => void;
}) {
  const complete = done >= total;
  return (
    <div className="relative grid h-full place-items-center overflow-hidden px-8 text-center">
      <div className="absolute inset-0 bg-[radial-gradient(70%_50%_at_50%_30%,rgba(200,255,46,0.18),transparent_70%)]" />
      <div className="relative">
        <div className={`mx-auto mb-5 grid size-20 place-items-center rounded-3xl ${complete ? "bg-volt text-black" : "bg-white/5 text-volt"}`}>
          {complete ? <TrophyIcon size={38} /> : <DumbbellIcon size={36} />}
        </div>
        <h2 className="text-3xl font-black tracking-tight">{complete ? "Antrenman tamam!" : `${total - done} reklam kaldı`}</h2>
        <p className="mx-auto mt-2 max-w-xs text-sm text-mist">
          {complete
            ? "Bugünün 10 reklamını inceledin. Yarın yeni bir set seni bekliyor."
            : "Her reklamda birkaç saniye dur: hook, teklif ve CTA'yı not et."}
        </p>
        <div className="mx-auto mt-6 flex w-fit items-center gap-6 rounded-2xl border border-line bg-white/[0.03] px-6 py-4">
          <div>
            <p className="flex items-center justify-center gap-1 text-2xl font-black text-orange-300">
              <FlameIcon size={20} filled /> {streak}
            </p>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Seri</p>
          </div>
          <div className="h-8 w-px bg-line" />
          <div>
            <p className="text-2xl font-black">{best}</p>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">En iyi</p>
          </div>
          <div className="h-8 w-px bg-line" />
          <div>
            <p className="text-2xl font-black tabular-nums">
              {done}/{total}
            </p>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Bugün</p>
          </div>
        </div>
        <div className="mt-6 flex justify-center gap-2">
          {!complete && (
            <button type="button" onClick={onJump} className="rounded-full bg-volt px-5 py-2.5 text-sm font-bold text-black">
              Kalanlara dön
            </button>
          )}
          <button type="button" onClick={onFeed} className={`rounded-full px-5 py-2.5 text-sm font-bold ${complete ? "bg-volt text-black" : "bg-white/10 text-white"}`}>
            Akışa devam et
          </button>
        </div>
        <p className="mt-4 text-xs text-zinc-500">{DAILY_SIZE} reklam · her gün aynı saatte yenilenir (gece yarısı)</p>
      </div>
    </div>
  );
}

function FeedEnd({ count, nFilters, onClear, onDaily, onTop }: { count: number; nFilters: number; onClear: () => void; onDaily: () => void; onTop: () => void }) {
  return (
    <div className="grid h-full place-items-center px-8 text-center">
      <div>
        <div className="mx-auto mb-4 grid size-16 place-items-center rounded-3xl bg-white/5 text-volt">
          <TrophyIcon size={30} />
        </div>
        <h2 className="text-2xl font-black tracking-tight">Hepsi bu kadar</h2>
        <p className="mt-1 text-sm text-mist">{count} reklamın hepsini gördün.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={onDaily} className="rounded-full bg-volt px-5 py-2.5 text-sm font-bold text-black">
            Bugünün antrenmanı
          </button>
          {nFilters > 0 && (
            <button type="button" onClick={onClear} className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-bold">
              Filtreleri temizle
            </button>
          )}
          <button type="button" onClick={onTop} className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-bold">
            Başa dön
          </button>
        </div>
      </div>
    </div>
  );
}

function ActiveInsights({ ad }: { ad: Ad }) {
  const days = daysLabel(ad);
  return (
    <div className="rounded-3xl border border-line bg-ink-2 p-5">
      <div className="flex items-start gap-4">
        <AdScore ad={ad} size={64} stroke={5} />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-volt">Neden kazanıyor?</p>
          <p className="mt-1 truncate text-base font-bold">{ad.brand.name}</p>
          {days && <p className="text-xs text-mist">{days}</p>}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {displayReasons(ad).length ? (
          displayReasons(ad).map((r) => (
            <Chip key={r} tone="solid">
              {r}
            </Chip>
          ))
        ) : (
          <span className="text-xs text-mist">Sinyal verisi yok</span>
        )}
      </div>
      <dl className="mt-4 space-y-1.5 text-[13px]">
        {ad.startedAt && <Row k="Başlangıç" v={formatDate(ad.startedAt)} />}
        {ad.variations !== undefined && <Row k="Varyasyon" v={String(ad.variations)} />}
        {ad.platforms?.length ? <Row k="Platform" v={ad.platforms.map(platformLabel).join(", ")} /> : null}
        {ad.languages?.length ? <Row k="Dil" v={ad.languages.join(", ").toUpperCase()} /> : null}
      </dl>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link href={adPath(ad.id)} className="rounded-xl bg-white/[0.06] py-2 text-center text-xs font-semibold ring-1 ring-white/10 hover:bg-white/10">
          Detay sayfası
        </Link>
        <a
          href={ad.libraryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 rounded-xl bg-white/[0.06] py-2 text-xs font-semibold ring-1 ring-white/10 hover:bg-white/10"
        >
          {libraryLabel(ad).replace(/'da aç|'de aç|'ta aç/, "")} <ExternalIcon size={12} />
        </a>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-mist">{k}</dt>
      <dd className="truncate text-right text-zinc-200">{v}</dd>
    </div>
  );
}

function Shortcuts() {
  return (
    <div className="rounded-3xl border border-line bg-ink-2 p-5 text-[13px] text-mist">
      <div className="mb-3 flex items-center gap-2 text-white">
        <KeyboardIcon size={16} className="text-volt" />
        <h2 className="text-sm font-semibold">Kısayollar</h2>
      </div>
      <ul className="space-y-1.5">
        <li className="flex justify-between">
          <span>Sonraki / önceki</span>
          <span>
            <Kbd>↓</Kbd> <Kbd>↑</Kbd> · <Kbd>j</Kbd> <Kbd>k</Kbd>
          </span>
        </li>
        <li className="flex justify-between">
          <span>Kaydet</span>
          <Kbd>s</Kbd>
        </li>
        <li className="flex justify-between">
          <span>Ses aç / kapat</span>
          <Kbd>m</Kbd>
        </li>
      </ul>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-grid min-w-6 place-items-center rounded-md border border-white/15 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-zinc-200">{children}</kbd>;
}
