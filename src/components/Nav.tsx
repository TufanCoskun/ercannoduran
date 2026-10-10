"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { currentStreak, dateKey, useProgress, viewedToday, DAILY_SIZE } from "@/lib/daily";
import { useSaved } from "@/lib/saved";
import { useHydrated } from "@/lib/store";
import { BookmarkIcon, DumbbellIcon, FlameIcon, GridIcon, PlayIcon } from "./Icons";

type Item = { href: string; label: string; short: string; icon: React.ReactNode; match: (p: string, daily: boolean) => boolean };

const ITEMS: Item[] = [
  { href: "/", label: "Akış", short: "Akış", icon: <PlayIcon size={22} />, match: (p, d) => p === "/" && !d },
  { href: "/?mode=daily", label: "Bugünün antrenmanı", short: "Antrenman", icon: <DumbbellIcon size={22} />, match: (p, d) => p === "/" && d },
  { href: "/brands", label: "Markalar", short: "Markalar", icon: <GridIcon size={21} />, match: (p) => p.startsWith("/brands") },
  { href: "/saved", label: "Kaydedilenler", short: "Kayıtlı", icon: <BookmarkIcon size={21} />, match: (p) => p.startsWith("/saved") },
];

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
  return (
    <nav className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-ink/80 px-4 py-6 backdrop-blur-xl lg:flex" aria-label="Ana menü">
      <Logo className="px-2" />
      <p className="mt-2 px-2 text-xs leading-relaxed text-zinc-500">Reklam kasını her gün çalıştır.</p>
      <ul className="mt-8 space-y-1">
        {ITEMS.map((it) => {
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

export function BottomNav() {
  const { pathname, daily, savedCount, hydrated } = useNavState();
  return (
    <nav
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/90 backdrop-blur-xl lg:hidden"
      aria-label="Ana menü"
    >
      <ul className="mx-auto flex h-[var(--nav-h)] max-w-md items-stretch">
        {ITEMS.map((it) => {
          const on = it.match(pathname, daily);
          return (
            <li key={it.href} className="flex-1">
              <Link
                href={it.href}
                className={`relative flex h-full flex-col items-center justify-center gap-1 text-[10px] font-semibold transition ${on ? "text-white" : "text-zinc-500"}`}
              >
                <span className={on ? "text-volt" : ""}>{it.icon}</span>
                {it.short}
                {it.href === "/saved" && hydrated && savedCount > 0 && (
                  <span className="absolute right-[calc(50%-20px)] top-1.5 grid min-w-4 place-items-center rounded-full bg-volt px-1 text-[9px] font-bold leading-4 text-black">
                    {savedCount}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
