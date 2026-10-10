import { useSyncExternalStore } from "react";
import type { Ad } from "./types";
import type { AnalyzeErrorCode, AnalyzeResponse } from "./analysis";
import { setAnalysis } from "./saved";

/**
 * Client-side "Özetle" jobs. A job lives outside React so the loading state survives closing the
 * detail sheet / switching tabs, and a second press on the same ad never starts a second (paid) call.
 * Nothing here runs on its own: a job only starts from an explicit user press (startAnalysis).
 */

export type JobState =
  | { status: "idle" }
  | { status: "running"; startedAt: number }
  | { status: "error"; error: string; code: AnalyzeErrorCode | "network"; canUsePoster?: boolean }
  | { status: "done" };

const IDLE: JobState = { status: "idle" };
const jobs = new Map<string, JobState>();
const listeners = new Set<() => void>();

function set(adId: string, s: JobState) {
  jobs.set(adId, s);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAnalysisJob(adId: string): JobState {
  return useSyncExternalStore(
    subscribe,
    () => jobs.get(adId) ?? IDLE,
    () => IDLE,
  );
}

export function clearJob(adId: string) {
  if (jobs.get(adId)?.status !== "running") set(adId, IDLE);
}

export interface StartOptions {
  force?: boolean;
  allowPoster?: boolean;
  /** Saves the ad first if it isn't saved yet (feed integration). */
  ad?: Ad;
}

/** Starts an analysis (no-op if one is already running for this ad). Resolves true on success. */
export async function startAnalysis(adId: string, opts: StartOptions = {}): Promise<boolean> {
  if (jobs.get(adId)?.status === "running") return false;
  set(adId, { status: "running", startedAt: Date.now() });
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ adId, force: opts.force === true, allowPoster: opts.allowPoster === true }),
    });
    let json: AnalyzeResponse | { error?: string } | undefined;
    try {
      json = (await res.json()) as AnalyzeResponse;
    } catch {
      json = undefined;
    }
    if (json && "ok" in json && json.ok) {
      setAnalysis(adId, json.analysis, opts.ad);
      set(adId, { status: "done" });
      return true;
    }
    if (res.status === 401) {
      set(adId, { status: "error", code: "network", error: "Oturum süresi dolmuş; sayfayı yenileyip tekrar giriş yap." });
      return false;
    }
    const err = json && "error" in json && typeof json.error === "string" ? json.error : `Özet alınamadı (HTTP ${res.status}).`;
    const code = json && "code" in json ? json.code : "gemini_error";
    const canUsePoster = Boolean(json && "canUsePoster" in json && json.canUsePoster);
    set(adId, { status: "error", error: err, code, canUsePoster });
    return false;
  } catch {
    set(adId, { status: "error", code: "network", error: "Bağlantı hatası; internetini kontrol edip tekrar dene." });
    return false;
  }
}
