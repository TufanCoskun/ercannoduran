/**
 * Shared (client + server) types for the Gemini ad breakdown ("Özetle").
 * No server-only imports here: SavedView / AnalyzeButton import these types.
 */

export interface AnalysisScene {
  start: string; // "MM:SS"
  end: string;
  visual: string;
  audio_or_voiceover: string;
  onScreenText: string;
}

export interface AnalysisBeat {
  label: string;
  start: string;
  end: string;
  description: string;
}

export interface AdAnalysis {
  hook: { text: string; timestamp: string; whyItWorks: string };
  scenes: AnalysisScene[];
  transcript: string;
  structure: { framework: string; beats: AnalysisBeat[] };
  angle: string;
  targetAudience: string;
  emotionalTriggers: string[];
  offer: string;
  cta: string;
  whyItWins: string;
  remixIdeas: string[];
}

/** What Gemini actually looked at. "poster" = video link expired, only the poster image + copy were analysed. */
export type AnalysisInput = "video" | "youtube" | "images" | "poster" | "text";

export interface AnalysisUsage {
  promptTokens?: number;
  outputTokens?: number;
  thoughtsTokens?: number;
  totalTokens?: number;
}

/** Stored on a saved item (localStorage) and returned by POST /api/analyze. */
export interface AnalysisRecord {
  model: string;
  createdAt: string;
  input: AnalysisInput;
  data: AdAnalysis;
  usage?: AnalysisUsage;
}

export interface AnalyzeRequest {
  adId: string;
  /** Skip the server cache (the user pressed "Yeniden özetle"). */
  force?: boolean;
  /** Video link expired: the user agreed to analyse only the poster image + copy. */
  allowPoster?: boolean;
}

export type AnalyzeResponse =
  | { ok: true; analysis: AnalysisRecord; cached: boolean }
  | { ok: false; error: string; code: AnalyzeErrorCode; canUsePoster?: boolean };

export type AnalyzeErrorCode =
  | "no_key"
  | "bad_request"
  | "not_found"
  | "video_expired"
  | "too_large"
  | "no_media"
  | "timeout"
  | "gemini_error"
  | "bad_output";

export const INPUT_LABEL: Record<AnalysisInput, string> = {
  video: "Videonun tamamı izlendi",
  youtube: "YouTube videosu izlendi",
  images: "Görsel(ler) + metin",
  poster: "Sadece poster görseli + metin (video linki süresi dolmuş)",
  text: "Sadece reklam metni (medya yok)",
};

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).map(s).filter(Boolean);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Coerces whatever the model (or an imported backup) returned into a complete AdAnalysis. */
export function normalizeAnalysis(raw: unknown): AdAnalysis {
  const r = obj(raw);
  const hook = obj(r.hook);
  const structure = obj(r.structure);
  return {
    hook: { text: s(hook.text), timestamp: s(hook.timestamp), whyItWorks: s(hook.whyItWorks) },
    scenes: arr(r.scenes)
      .map(obj)
      .map((x) => ({
        start: s(x.start),
        end: s(x.end),
        visual: s(x.visual),
        audio_or_voiceover: s(x.audio_or_voiceover),
        onScreenText: s(x.onScreenText),
      }))
      .filter((x) => x.visual || x.audio_or_voiceover || x.onScreenText),
    transcript: s(r.transcript),
    structure: {
      framework: s(structure.framework),
      beats: arr(structure.beats)
        .map(obj)
        .map((x) => ({ label: s(x.label), start: s(x.start), end: s(x.end), description: s(x.description) }))
        .filter((x) => x.label || x.description),
    },
    angle: s(r.angle),
    targetAudience: s(r.targetAudience),
    emotionalTriggers: strs(r.emotionalTriggers),
    offer: s(r.offer),
    cta: s(r.cta),
    whyItWins: s(r.whyItWins),
    remixIdeas: strs(r.remixIdeas),
  };
}

const INPUTS: AnalysisInput[] = ["video", "youtube", "images", "poster", "text"];

/** Validates a stored/imported record; returns undefined when unusable. */
export function normalizeRecord(raw: unknown): AnalysisRecord | undefined {
  const r = obj(raw);
  if (!r.data || typeof r.data !== "object") return undefined;
  const input = INPUTS.find((i) => i === r.input) ?? "video";
  const rec: AnalysisRecord = {
    model: s(r.model) || "gemini",
    createdAt: s(r.createdAt) || new Date(0).toISOString(),
    input,
    data: normalizeAnalysis(r.data),
  };
  const u = obj(r.usage);
  if (Object.keys(u).length) {
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    rec.usage = { promptTokens: n(u.promptTokens), outputTokens: n(u.outputTokens), thoughtsTokens: n(u.thoughtsTokens), totalTokens: n(u.totalTokens) };
  }
  return rec;
}

/** "01:15" / "1:15" / "75" / "00:01:15" → seconds (undefined if unparsable). */
export function parseTimestamp(t?: string): number | undefined {
  if (!t) return undefined;
  const m = t.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$|^(\d+(?:\.\d+)?)s?$/);
  if (!m) return undefined;
  if (m[4] !== undefined) return Number(m[4]);
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
