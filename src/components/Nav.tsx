"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { currentStreak, dateKey, useProgress, viewedToday, DAILY_SIZE } from "@/lib/daily";
import { useSaved } from "@/lib/saved";
import { useHydrated } from "@/lib/store";
import { useState } from "react";
import { useRole } from "@/lib/role-client";
import { ArrowLeftIcon, BookmarkIcon, DumbbellIcon, FlameIcon, GridIcon, MenuIcon, PlayIcon, SparkIcon } from "./Icons";
import { Sheet } from "./Sheet";
import { CardsIcon } from "./tinder/bits";

type Item = { href: string; label: string; short: string; icon: React.ReactNode; match: (p: string, daily: boolean) => boolean };

const ITEMS: Item[] = [
  { href: "/", label: "Akış", short: "Akış", icon: <PlayIcon size={22} />, match: (p, d) => p === "/" && !d },
  { href: "/?mode=daily", label: "Bugünün antrenmanı", short: "Antrenman", icon: <DumbbellIcon size={22} />, match: (p, d) => p === "/" && d },
  { href: "/tinder", label: "Tinder", short: "Tinder", icon: <CardsIcon size={21} />, match: (p) => p.startsWith("/tinder") },
  { href: "/brands", label: "Markalar", short: "Markalar", icon: <GridIcon size={21} />, match: (p) => p.startsWith("/brands") },
  { href: "/saved", label: "Kaydedilenler", short: "Kayıtlı", icon: <BookmarkIcon size={21} />, match: (p) => p.startsWith("/saved") },
];

/** Admin-only entries (the routes themselves also return 403 for viewers). */
const ADMIN_ITEMS: Item[] = [{ href: "/strategy", label: "Strateji", short: "Strateji", icon: <SparkIcon size={21} />, match: (p) => p.startsWith("/strategy") }];

function useItems(): Item[] {
  return useRole() === "admin" ? [...ITEMS, ...ADMIN_ITEMS] : ITEMS;
}

function useNavState() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const daily = sp.get("mode") === "daily";
  const saved = useSaved();
  const progress = useProgress();
  const hydrated = useHydrated();
  const today = hydrated ? dateKey() : "";
  return {
    pathname,
    daily,
    savedCount: Object.keys(saved.items).length,
    streak: today ? currentStreak(progress, today) : 0,
    best: progress.best,
    doneToday: today ? viewedToday(progress, today).length : 0,
    hydrated,
  };
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2.5 ${className}`} aria-label="AdGym ana sayfa">
      <span className="grid size-9 place-items-center rounded-xl bg-volt text-black shadow-[0_0_30px_-6px_rgba(200,255,46,0.6)]">
        <DumbbellIcon size={20} strokeWidth={2.6} />
      </span>
      <span className="text-xl font-black tracking-tight">AdGym</span>
    </Link>
  );
}

export function SideNav() {
  const { pathname, daily, savedCount, streak, best, doneToday, hydrated } = useNavState();
  const items = useItems();
  return (
    <nav className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-ink/80 px-4 py-6 backdrop-blur-xl lg:flex" aria-label="Ana menü">
      <Logo className="px-2" />
      <p className="mt-2 px-2 text-xs leading-relaxed text-zinc-500">Reklam kasını her gün çalıştır.</p>
      <ul className="mt-8 space-y-1">
        {items.map((it) => {
          const on = it.match(pathname, daily);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                className={`flex items-center gap-2.5 whitespace-nowrap rounded-2xl px-3 py-2.5 text-[15px] font-semibold transition ${on ? "bg-white/[0.08] text-white" : "text-zinc-400 hover:bg-white/[0.04] hover:text-white"}`}
              >
                <span className={on ? "text-volt" : ""}>{it.icon}</span>
                <span className="flex-1">{it.label}</span>
                {it.href === "/saved" && hydrated && savedCount > 0 && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] tabular-nums text-zinc-300">{savedCount}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto rounded-3xl border border-line bg-gradient-to-br from-white/[0.06] to-transparent p-4">
        <div className="flex items-center gap-3">
          <span className={`grid size-11 place-items-center rounded-2xl ${streak > 0 ? "bg-ember/20 text-orange-300" : "bg-white/5 text-zinc-500"}`}>
            <FlameIcon size={22} filled={streak > 0} />
          </span>
          <div>
            <p className="text-2xl font-black leading-none tabular-nums">{streak}</p>
            <p className="mt-1 text-xs text-zinc-500">günlük seri · en iyi {best}</p>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-[11px] font-semibold text-zinc-400">
            <span>Bugün</span>
            <span className="tabular-nums">
              {Math.min(doneToday, DAILY_SIZE)}/{DAILY_SIZE}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-volt transition-all" style={{ width: `${(Math.min(doneToday, DAILY_SIZE) / DAILY_SIZE) * 100}%` }} />
          </div>
        </div>
        {!(pathname === "/" && daily) && (
          <Link href="/?mode=daily" className="mt-4 block rounded-xl bg-volt py-2 text-center text-xs font-bold text-black">
            Antrenmana başla
          </Link>
        )}
      </div>
      <p className="mt-4 px-2 text-[11px] leading-relaxed text-zinc-600">Kaynak: Meta Ad Library · TikTok Creative Center</p>
    </nav>
  );
}

/**
 * Compact app menu (mobile + the feed column): Akış, Antrenman, Markalar, Kayıtlı. The feed passes
 * its own Akış/Antrenman hrefs (to keep active filters) and extra controls (filters, video-only).
 */
export function AppMenu({
  open,
  onClose,
  feedHref,
  dailyHref,
  children,
}: {
  open: boolean;
  onClose: () => void;
  feedHref?: string;
  dailyHref?: string;
  children?: React.ReactNode;
}) {
  const { pathname, daily, savedCount, streak, doneToday, hydrated } = useNavState();
  const items = useItems();
  const href = (it: Item) => (it.href === "/" ? (feedHref ?? it.href) : it.href === "/?mode=daily" ? (dailyHref ?? it.href) : it.href);
  return (
    <Sheet open={open} onClose={onClose} title={
        <span className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-xl bg-volt text-black">
            <DumbbellIcon size={18} strokeWidth={2.6} />
          </span>
          <span className="font-black tracking-tight">AdGym</span>
        </span>
      } label="Menü">
      <ul className="grid grid-cols-2 gap-2" aria-label="Ana menü">
        {items.map((it) => {
          const on = it.match(pathname, daily);
          const sub =
            it.href === "/?mode=daily"
              ? hydrated
                ? `${Math.min(doneToday, DAILY_SIZE)}/${DAILY_SIZE} bugün${streak > 0 ? ` · 🔥 ${streak}` : ""}`
                : `${DAILY_SIZE} reklam`
              : it.href === "/saved"
                ? hydrated
                  ? `${savedCount} reklam`
                  : undefined
                : it.href === "/brands"
                  ? "Marka akışları"
                  : it.href === "/tinder"
                    ? "Rastgele turnuva"
                    : it.href === "/strategy"
                      ? "Remix stratejisi"
                      : "Tüm reklamlar";
          return (
            <li key={it.href} className="odd:last:col-span-2">
              <Link
                href={href(it)}
                onClick={onClose}
                aria-current={on ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-2xl border px-3 py-3 transition ${on ? "border-volt/40 bg-volt/10" : "border-line bg-white/[0.03] hover:bg-white/[0.07]"}`}
              >
                <span className={on ? "text-volt" : "text-zinc-300"}>{it.icon}</span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold leading-tight">{it.short}</span>
                  {sub && <span className="block truncate text-[11px] text-mist">{sub}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {children}
    </Sheet>
  );
}

/** Small round menu trigger; semi-transparent so it can float over video. */
export function MenuButton({ onClick, count, className = "" }: { onClick: () => void; count?: number; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={count ? `Menü (${count} filtre açık)` : "Menü"}
      aria-haspopup="dialog"
      className={`relative grid size-9 place-items-center rounded-full bg-black/30 text-white ring-1 ring-white/10 backdrop-blur-sm transition hover:bg-black/50 ${className}`}
    >
      <MenuIcon size={19} />
      {count ? (
        <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-volt px-1 text-[10px] font-bold leading-4 text-black" data-filter-count="">
          {count}
        </span>
      ) : null}
    </button>
  );
}

/** Mobile header for pages other than the feed (the feed floats its own menu button over the video). */
export function MobileTopBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  if (pathname === "/") return null;
  return (
    <header className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] lg:hidden">
      <Link href="/" className="flex items-center gap-1.5 rounded-full bg-white/[0.05] py-1.5 pl-2 pr-3 text-sm font-semibold text-zinc-200 ring-1 ring-white/10" aria-label="Akışa dön">
        <ArrowLeftIcon size={16} /> Akış
      </Link>
      <span className="flex items-center gap-1.5 text-sm font-black tracking-tight">
        <DumbbellIcon size={16} className="text-volt" /> AdGym
      </span>
      <MenuButton onClick={() => setOpen(true)} className="bg-white/[0.05]" />
      <AppMenu open={open} onClose={() => setOpen(false)} />
    </header>
  );
}
