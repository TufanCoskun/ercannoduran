"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Client-side account info. Display only: the server re-checks the signed session (and the viewer
 * quota) for every privileged call.
 *  - role: from the non-httpOnly `adgym_role` cookie (set at login, kept in sync by the middleware)
 *  - me:   from GET /api/auth/me (username, viewer quota, or — for admin — every viewer's usage)
 */
export type ClientRole = "admin" | "viewer";
export type QuotaInfo = { used: number; limit: number };
export type ViewerUsage = { u: string; used: number | null; limit: number };
/** Active brand strategy (only sent to accounts that get strategy remix ideas). */
export type StrategyInfo = { name: string; active: boolean };
export type Me = { u: string; r: ClientRole; quota?: QuotaInfo | null; viewers?: ViewerUsage[]; strategy?: StrategyInfo | null };

function readRole(): ClientRole | null {
  const m = /(?:^|;\s*)adgym_role=(admin|viewer)(?:;|$)/.exec(document.cookie);
  return m ? (m[1] as ClientRole) : null;
}

const noop = () => () => {};

/** null during SSR/hydration or when unknown. */
export function useRole(): ClientRole | null {
  return useSyncExternalStore(noop, readRole, () => null);
}

/** Both roles may analyze (viewers within their quota). Unknown role → hide the controls. */
export function useCanAnalyze(): boolean {
  return useRole() !== null;
}

// --- /api/auth/me store --------------------------------------------------------------------------

let me: Me | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function refreshMe(): Promise<void> {
  loading = fetch("/api/auth/me", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
    .then((d) => {
      if (d && typeof d.u === "string" && (d.r === "admin" || d.r === "viewer")) {
        me = d;
        emit();
      }
    })
    .catch(() => {});
  return loading;
}

export function useMe(): Me | null {
  const value = useSyncExternalStore(subscribe, () => me, () => null);
  useEffect(() => {
    if (!me && !loading) void refreshMe();
  }, []);
  return value;
}

/** The active strategy when this account gets strategy remix ideas (admin by default), else null. */
export function useActiveStrategy(): StrategyInfo | null {
  const m = useMe();
  return m?.strategy?.active ? m.strategy : null;
}

/** Viewer quota (null for admin, unknown, or when the quota store is unavailable). */
export function useViewerQuota(): QuotaInfo | null {
  const m = useMe();
  return m?.r === "viewer" && m.quota ? m.quota : null;
}

/** Called with the quota returned by /api/analyze so every button updates immediately. */
export function setViewerQuota(q: QuotaInfo) {
  if (me && me.r === "viewer") {
    me = { ...me, quota: { used: q.used, limit: q.limit } };
    emit();
  } else {
    void refreshMe();
  }
}
