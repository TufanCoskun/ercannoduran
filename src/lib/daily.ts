import type { Ad } from "./types";
import { hashString } from "./format";
import { createStore } from "./store";

export const DAILY_SIZE = 10;

/** Local calendar date as YYYY-MM-DD. */
export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function previousDateKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return dateKey(new Date(y, m - 1, d - 1));
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic "Bugünün antrenmanı": the same date (+ same filter pool) always yields
 * the same 10 ads. Picks from the stronger half of the pool, one ad per brand when possible,
 * mixing formats.
 */
export function pickDaily(pool: Ad[], key: string, size = DAILY_SIZE): Ad[] {
  if (pool.length <= size) return [...pool];
  const rand = mulberry32(hashString(`adgym|${key}|${pool.length}`));
  const sorted = [...pool].sort((a, b) => b.performance.score - a.performance.score || a.id.localeCompare(b.id));
  const candidates = sorted.slice(0, Math.max(size * 4, Math.ceil(sorted.length * 0.5)));
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const out: Ad[] = [];
  const brands = new Set<string>();
  for (const ad of candidates) {
    if (out.length >= size) break;
    if (brands.has(ad.brand.name)) continue;
    brands.add(ad.brand.name);
    out.push(ad);
  }
  for (const ad of candidates) {
    if (out.length >= size) break;
    if (!out.includes(ad)) out.push(ad);
  }
  return out;
}

export interface ProgressState {
  streak: number;
  best: number;
  lastCompleted?: string; // date key of last completed workout
  daily: { date: string; viewed: string[] };
  totalCompleted: number;
}

const INITIAL: ProgressState = { streak: 0, best: 0, daily: { date: "", viewed: [] }, totalCompleted: 0 };

export const progressStore = createStore<ProgressState>("adgym:progress:v1", INITIAL, (raw) => ({
  ...INITIAL,
  ...(raw && typeof raw === "object" ? (raw as Partial<ProgressState>) : {}),
}));
export const useProgress = progressStore.useStore;

/** Streak as of today (0 if the chain is broken). */
export function currentStreak(p: ProgressState, today: string): number {
  if (!p.lastCompleted) return 0;
  if (p.lastCompleted === today || p.lastCompleted === previousDateKey(today)) return p.streak;
  return 0;
}

export function viewedToday(p: ProgressState, today: string): string[] {
  return p.daily.date === today ? p.daily.viewed : [];
}

/** Marks an ad of today's workout as seen; completes the workout (and bumps the streak) once every ad in `workoutIds` is seen. */
export function markDailyViewed(today: string, adId: string, workoutIds: string[]) {
  progressStore.update((p) => {
    const viewed = p.daily.date === today ? p.daily.viewed : [];
    if (viewed.includes(adId)) return p;
    const nextViewed = [...viewed, adId];
    let next: ProgressState = { ...p, daily: { date: today, viewed: nextViewed } };
    if (workoutIds.length > 0 && workoutIds.every((id) => nextViewed.includes(id)) && p.lastCompleted !== today) {
      const streak = p.lastCompleted === previousDateKey(today) ? p.streak + 1 : 1;
      next = { ...next, streak, best: Math.max(p.best, streak), lastCompleted: today, totalCompleted: p.totalCompleted + 1 };
    }
    return next;
  });
}
