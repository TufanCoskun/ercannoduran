import { useSyncExternalStore } from "react";
import type { Ad } from "./types";
import { userNotes, type AnalysisRecord, type AnalyzeErrorCode, type AnalyzeResponse, type RemixResponse } from "./analysis";
import { savedStore, setAnalysis } from "./saved";
import { setViewerQuota } from "./role-client";

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

/** Text of the user's own notes on a saved ad (sent with Özetle / remix; the server caps them). */
function notesFor(adId: string): string[] {
  return userNotes(savedStore.read().items[adId]?.notes).map((n) => n.text.trim());
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
      body: JSON.stringify({ adId, force: opts.force === true, allowPoster: opts.allowPoster === true, notes: notesFor(adId) }),
    });
    let json: AnalyzeResponse | { error?: string } | undefined;
    try {
      json = (await res.json()) as AnalyzeResponse;
    } catch {
      json = undefined;
    }
    if (json && "quota" in json && json.quota) setViewerQuota(json.quota);
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

// --- strategy remix (POST /api/remix) -------------------------------------------------------------

const remixKey = (adId: string) => `remix:${adId}`;

/** Job state of "…'a göre remix üret" for one ad (independent of the full analysis job). */
export function useRemixJob(adId: string): JobState {
  return useSyncExternalStore(
    subscribe,
    () => jobs.get(remixKey(adId)) ?? IDLE,
    () => IDLE,
  );
}

/**
 * Regenerates only the remix ideas of an existing analysis (strategy ideas for admin with an active
 * strategy, generic otherwise) + one idea from the user's notes. Sends the stored analysis and the notes
 * (no video) — cheap; the new ideas replace the old ones on the saved item.
 * mode "strategy" = the "…'a göre remix üret" button: fail instead of falling back to generic ideas.
 */
export async function startRemix(adId: string, record: AnalysisRecord, mode: "strategy" | "auto" = "auto"): Promise<boolean> {
  const k = remixKey(adId);
  if (jobs.get(k)?.status === "running") return false;
  set(k, { status: "running", startedAt: Date.now() });
  try {
    const res = await fetch("/api/remix", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ adId, analysis: record, notes: notesFor(adId), mode }),
    });
    let json: RemixResponse | undefined;
    try {
      json = (await res.json()) as RemixResponse;
    } catch {
      json = undefined;
    }
    if (json?.quota) setViewerQuota(json.quota);
    if (json?.ok) {
      const latest = savedStore.read().items[adId]?.analysis ?? record;
      const { strategyFit: _oldFit, ...data } = latest.data;
      void _oldFit;
      const next: AnalysisRecord = {
        ...latest,
        data: { ...data, remixIdeas: json.remixIdeas, ...(json.strategyFit ? { strategyFit: json.strategyFit } : {}) },
        remix: { model: json.model, createdAt: json.createdAt, ...(json.usage ? { usage: json.usage } : {}) },
      };
      if (json.strategyName) next.strategyName = json.strategyName;
      else delete next.strategyName;
      setAnalysis(adId, next);
      set(k, { status: "done" });
      return true;
    }
    if (res.status === 401) {
      set(k, { status: "error", code: "network", error: "Oturum süresi dolmuş; sayfayı yenileyip tekrar giriş yap." });
      return false;
    }
    set(k, { status: "error", code: json?.code ?? "gemini_error", error: json && !json.ok ? json.error : `Remix üretilemedi (HTTP ${res.status}).` });
    return false;
  } catch {
    set(k, { status: "error", code: "network", error: "Bağlantı hatası; internetini kontrol edip tekrar dene." });
    return false;
  }
}
