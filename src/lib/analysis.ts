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
  /**
   * Generic ideas are plain strings (viewers, and every analysis made before strategies existed).
   * Ideas generated against the admin's active brand strategy are RemixIdea objects.
   */
  remixIdeas: RemixItem[];
  /** Only with strategy ideas: how transferable this ad's structure is to the strategy's brand. */
  strategyFit?: StrategyFit;
}

/** One remix idea adapted to the active brand strategy (src/lib/strategy.ts). */
export interface RemixIdea {
  title: string;
  angleFamily: string;
  hook: string;
  concept: string;
  beliefStep: string;
  whyFitsStrategy: string;
  offerCta: string;
  redLineCheck: string;
  /** Built from the user's own notes on this ad (shown first, "✎ Senin notuna göre"). */
  fromNotes?: boolean;
  /** Short quote of the note the idea came from. */
  basedOnNote?: string;
}

export type RemixItem = string | RemixIdea;

export interface StrategyFit {
  /** 0–10 */
  score: number;
  notes: string;
}

export const REMIX_IDEA_FIELDS = ["title", "angleFamily", "hook", "concept", "beliefStep", "whyFitsStrategy", "offerCta", "redLineCheck"] as const;

export const REMIX_FIELD_LABEL: Record<(typeof REMIX_IDEA_FIELDS)[number], string> = {
  title: "Başlık",
  angleFamily: "Angle ailesi",
  hook: "Hook",
  concept: "Konsept",
  beliefStep: "İnanç basamağı",
  whyFitsStrategy: "Neden stratejiye uygun",
  offerCta: "Teklif + CTA",
  redLineCheck: "Kırmızı çizgi kontrolü",
};

export const isStrategyIdea = (x: RemixItem): x is RemixIdea => typeof x === "object" && x !== null;

/** True when the record already carries ideas generated against a brand strategy. */
export function hasStrategyRemix(rec: AnalysisRecord): boolean {
  return Boolean(rec.strategyName) && rec.data.remixIdeas.some((x) => isStrategyIdea(x) && !x.fromNotes);
}

// --- user notes → remix ideas ---------------------------------------------------------------------

export const MAX_NOTES = 10;
export const MAX_NOTES_CHARS = 3000;
/** Prefix of notes created by "Not olarak ekle" on a remix idea (model output, not the user's idea). */
export const REMIX_NOTE_PREFIX = "Remix fikri:";

type NoteLike = { text: string; createdAt?: string; updatedAt?: string };

/** The user's own notes worth sending to Gemini (copies of earlier remix ideas are skipped). */
export function userNotes<N extends NoteLike>(notes: readonly N[] | undefined): N[] {
  return (notes ?? []).filter((n) => n.text.trim() && !n.text.trim().startsWith(REMIX_NOTE_PREFIX));
}

/** Server-side cap: ≤ MAX_NOTES notes (the newest), ≤ MAX_NOTES_CHARS characters in total. */
export function capNotes(raw: unknown): string[] {
  const list = (Array.isArray(raw) ? raw : [])
    .map((x) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim() : ""))
    .filter((x) => x && !x.startsWith(REMIX_NOTE_PREFIX))
    .slice(-MAX_NOTES);
  const out: string[] = [];
  let left = MAX_NOTES_CHARS;
  for (const n of list) {
    if (left <= 0) break;
    const t = n.length > left ? `${n.slice(0, Math.max(0, left - 1))}…` : n;
    out.push(t);
    left -= t.length;
  }
  return out;
}

/** Notes written/edited after the ideas were last generated → "Remix'i notlarla yenile". */
export function hasNewNotes(rec: AnalysisRecord, notes: readonly NoteLike[] | undefined): boolean {
  const last = Math.max(Date.parse(rec.createdAt) || 0, Date.parse(rec.remix?.createdAt ?? "") || 0);
  return userNotes(notes).some((n) => (Date.parse(n.updatedAt ?? n.createdAt ?? "") || 0) > last);
}

/** Plain-text version of an idea (clipboard / "Not olarak ekle"). */
export function remixIdeaText(idea: RemixItem): string {
  if (!isStrategyIdea(idea)) return idea;
  const lines = REMIX_IDEA_FIELDS.filter((k) => idea[k]).map((k) => (k === "title" ? idea.title : `${REMIX_FIELD_LABEL[k]}: ${idea[k]}`));
  if (idea.fromNotes && idea.basedOnNote) lines.splice(1, 0, `Notun: “${idea.basedOnNote}”`);
  return lines.join("\n");
}

/** Display brand of a strategy: its first word ("Acme Ana Strateji v2" → "Acme"). */
export function strategyBrand(name?: string): string {
  const w = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return w.replace(/[^\p{L}\p{N}-]/gu, "") || "Strateji";
}

/** Turkish dative suffix for a proper noun: "Acme" → "Acme'ye", "Kars" → "Kars'a". */
export function withDative(word: string): string {
  const lower = word.toLocaleLowerCase("tr");
  const vowels = lower.match(/[aıoueiöü]/g);
  const last = vowels?.[vowels.length - 1];
  const front = last ? "eiöü".includes(last) : false;
  const endsWithVowel = /[aıoueiöü]$/.test(lower);
  return `${word}'${endsWithVowel ? "y" : ""}${front ? "e" : "a"}`;
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
  /** Name of the brand strategy the remix ideas were generated against (admin only). */
  strategyName?: string;
  /** Set when the remix ideas were (re)generated separately via POST /api/remix. */
  remix?: { model: string; createdAt: string; usage?: AnalysisUsage };
}

export interface AnalyzeRequest {
  adId: string;
  /** Skip the server cache (the user pressed "Yeniden özetle"). */
  force?: boolean;
  /** Video link expired: the user agreed to analyse only the poster image + copy. */
  allowPoster?: boolean;
  /** The user's notes on this ad (text only) → one extra idea built from them; capped server-side. */
  notes?: string[];
}

/** Viewer accounts only: Gemini analyses used / allowed in total. */
export interface QuotaInfo {
  used: number;
  limit: number;
}

/** POST /api/remix: strategy remix ideas for an existing analysis (no video is sent again). */
export interface RemixRequest {
  adId: string;
  analysis: AnalysisRecord;
  /** The user's notes on this ad (text only); capped server-side. */
  notes?: string[];
}

export type RemixResponse =
  | {
      ok: true;
      /** Strategy mode: RemixIdea objects. Generic mode (no strategy): strings (+ the notes idea object). */
      remixIdeas: RemixItem[];
      strategyFit?: StrategyFit;
      strategyName?: string;
      model: string;
      createdAt: string;
      usage?: AnalysisUsage;
      quota?: QuotaInfo;
    }
  | { ok: false; error: string; code: AnalyzeErrorCode; quota?: QuotaInfo };

export type AnalyzeResponse =
  | { ok: true; analysis: AnalysisRecord; cached: boolean; quota?: QuotaInfo }
  | { ok: false; error: string; code: AnalyzeErrorCode; canUsePoster?: boolean; quota?: QuotaInfo };

export type AnalyzeErrorCode =
  | "forbidden"
  | "quota"
  | "quota_store"
  | "no_key"
  | "bad_request"
  | "not_found"
  | "video_expired"
  | "too_large"
  | "no_media"
  | "timeout"
  | "gemini_error"
  | "bad_output"
  | "no_strategy";

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

export function normalizeRemixIdea(raw: unknown): RemixIdea | undefined {
  const o = obj(raw);
  const idea = Object.fromEntries(REMIX_IDEA_FIELDS.map((k) => [k, s(o[k])])) as unknown as RemixIdea;
  if (o.fromNotes === true) idea.fromNotes = true;
  if (s(o.basedOnNote)) idea.basedOnNote = s(o.basedOnNote).slice(0, 300);
  return idea.title || idea.hook || idea.concept ? idea : undefined;
}

export function normalizeStrategyFit(raw: unknown): StrategyFit | undefined {
  const o = obj(raw);
  const n = typeof o.score === "number" ? o.score : typeof o.score === "string" ? Number(o.score) : NaN;
  const notes = s(o.notes);
  if (!Number.isFinite(n) && !notes) return undefined;
  return { score: Number.isFinite(n) ? Math.min(10, Math.max(0, Math.round(n))) : 0, notes };
}

function remixItems(v: unknown): RemixItem[] {
  return arr(v)
    .map((x): RemixItem | undefined => (typeof x === "string" || typeof x === "number" ? s(x) || undefined : normalizeRemixIdea(x)))
    .filter((x): x is RemixItem => x !== undefined);
}

/** Coerces whatever the model (or an imported backup) returned into a complete AdAnalysis. */
export function normalizeAnalysis(raw: unknown): AdAnalysis {
  const r = obj(raw);
  const hook = obj(r.hook);
  const structure = obj(r.structure);
  const strategyFit = normalizeStrategyFit(r.strategyFit);
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
    remixIdeas: remixItems(r.remixIdeas),
    ...(strategyFit ? { strategyFit } : {}),
  };
}

const INPUTS: AnalysisInput[] = ["video", "youtube", "images", "poster", "text"];

function normalizeUsage(u: Record<string, unknown>): AnalysisUsage {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return { promptTokens: n(u.promptTokens), outputTokens: n(u.outputTokens), thoughtsTokens: n(u.thoughtsTokens), totalTokens: n(u.totalTokens) };
}

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
    rec.usage = normalizeUsage(u);
  }
  if (s(r.strategyName)) rec.strategyName = s(r.strategyName);
  const remix = obj(r.remix);
  if (s(remix.model)) {
    rec.remix = { model: s(remix.model), createdAt: s(remix.createdAt) || rec.createdAt };
    if (Object.keys(obj(remix.usage)).length) rec.remix.usage = normalizeUsage(obj(remix.usage));
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
