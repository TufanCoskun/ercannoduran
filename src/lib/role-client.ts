"use client";

import { useSyncExternalStore } from "react";

/**
 * Client-side role HINT from the non-httpOnly `adgym_role` cookie (set at login, kept in sync by
 * the middleware). Display only: the server re-checks the signed session for every privileged call.
 * Returns null during SSR/hydration or when unknown — callers should then hide privileged UI.
 */
export type ClientRole = "admin" | "viewer";

function read(): ClientRole | null {
  const m = /(?:^|;\s*)adgym_role=(admin|viewer)(?:;|$)/.exec(document.cookie);
  return m ? (m[1] as ClientRole) : null;
}

const noop = () => () => {};

export function useRole(): ClientRole | null {
  return useSyncExternalStore(noop, read, () => null);
}

/** True only when the signed-in account may run Gemini analysis (admin). */
export function useCanAnalyze(): boolean {
  return useRole() === "admin";
}
