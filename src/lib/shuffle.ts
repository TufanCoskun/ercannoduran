import type { Ad } from "./types";
import { interleaveCurated } from "./filters";

/**
 * Random feed order. A fresh 32-bit seed comes from crypto.getRandomValues; the order itself is a
 * Fisher–Yates shuffle driven by a small PRNG seeded with it, so the same seed always gives the
 * same order (stable within a browser tab via sessionStorage: back from /ad keeps your place).
 * Shuffled ads still go through interleaveCurated: video first, then image / carousel, then text,
 * with brands spread out and the curated classics woven in.
 */

const SEED_KEY = "adgym:feed-seed:v1";

export function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

/** Seed for this tab: reuse the stored one, or mint and store a new one. Client-only. */
export function sessionSeed(): number {
  try {
    const raw = window.sessionStorage.getItem(SEED_KEY);
    const n = raw === null ? NaN : Number(raw);
    if (Number.isInteger(n) && n >= 0) return n;
  } catch {
    /* storage blocked: fall through to a fresh seed */
  }
  return storeSeed(randomSeed());
}

export function storeSeed(seed: number): number {
  try {
    window.sessionStorage.setItem(SEED_KEY, String(seed));
  } catch {
    /* not persisted — fine */
  }
  return seed;
}

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fisherYates<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = prng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Random order within the video → image/carousel → text tiers (a fresh visit opens on a video). */
export function shuffledFeed(ads: readonly Ad[], seed: number): Ad[] {
  return interleaveCurated(fisherYates(ads, seed));
}
