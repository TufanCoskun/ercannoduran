import fs from "node:fs/promises";
import path from "node:path";
import type { Ad } from "./types";
import { adYouTubeId, isYouTubeUrl } from "./youtube";
import { normalizeAnalysis, type AnalysisInput, type AnalysisRecord, type AnalysisUsage, type AnalyzeErrorCode } from "./analysis";

/**
 * Server-only Gemini client for the "Özetle" ad breakdown (plain REST via fetch, no SDK).
 *
 * - Key:   process.env.GEMINI_API_KEY (never sent to the client, never logged).
 * - Model: process.env.GEMINI_MODEL, default DEFAULT_GEMINI_MODEL. If the model 404s we list the
 *          available models and fall back to the newest "*flash*" model that supports generateContent.
 * - Media: YouTube ads → file_data.file_uri = YouTube URL. Meta videos → download (≤ 50 MB), inline
 *          base64 when ≤ 15 MB, otherwise Files API resumable upload + poll until ACTIVE.
 *          Images/carousels → inline images + copy. Expired video → 410 unless allowPoster.
 */

/** Newest Flash model (Oct 2026): video input, structured output; $0.75 in / $3.75 out per 1M tokens. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

const API = "https://generativelanguage.googleapis.com";
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const INLINE_VIDEO_MAX_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 6;
/** Route maxDuration is 60 s — leave headroom for the response. */
const DEADLINE_MS = 56_000;

export const MISSING_KEY_MESSAGE = "Gemini API anahtarı ayarlanmamış (GEMINI_API_KEY)";
export const VIDEO_EXPIRED_MESSAGE = "Video linkinin süresi dolmuş; reklamı Ad Library'de açıp tekrar dene.";

export class AnalyzeError extends Error {
  constructor(
    public code: AnalyzeErrorCode,
    message: string,
    public status: number,
    public canUsePoster?: boolean,
  ) {
    super(message);
    this.name = "AnalyzeError";
  }
}

export function geminiKey(): string | undefined {
  const k = process.env.GEMINI_API_KEY?.trim();
  return k ? k : undefined;
}

const cleanModel = (m: string) => m.trim().replace(/^models\//, "");

export function configuredModel(): string {
  const m = process.env.GEMINI_MODEL?.trim();
  return m ? cleanModel(m) : DEFAULT_GEMINI_MODEL;
}

// ---------------------------------------------------------------------------------------------
// Model resolution (with 404 fallback)

/** configured model id → model actually used after a 404 fallback (per function instance). */
const fallbackFor = new Map<string, string>();

interface ListedModel {
  name: string;
  supportedGenerationMethods?: string[];
}

const EXCLUDE = /(tts|image|live|audio|embed|vision|computer|robotics|8b|aqa|native|transcribe|omni|veo|lyria)/i;

/** Ranks flash models: higher version first, full Flash before Flash-Lite, stable before preview/exp. */
export function pickFlashModel(models: ListedModel[]): string | undefined {
  const cands = models
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => cleanModel(m.name))
    .filter((n) => /flash/i.test(n) && !EXCLUDE.test(n));
  const version = (n: string) => {
    const v = n.match(/gemini-(\d+)(?:\.(\d+))?/i);
    return v ? Number(v[1]) * 100 + Number(v[2] ?? 0) : -1; // aliases like gemini-flash-latest rank last
  };
  const rank = (n: string) => [version(n), /lite/i.test(n) ? 0 : 1, /preview|exp/i.test(n) ? 0 : 1];
  cands.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i];
    return a.localeCompare(b);
  });
  return cands[0];
}

async function listModels(key: string, signal: AbortSignal): Promise<ListedModel[]> {
  const out: ListedModel[] = [];
  let pageToken = "";
  for (let i = 0; i < 5; i++) {
    const url = `${API}/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const res = await fetch(url, { headers: { "x-goog-api-key": key }, signal });
    if (!res.ok) throw await apiError(res, "Model listesi alınamadı");
    const j = (await res.json()) as { models?: ListedModel[]; nextPageToken?: string };
    out.push(...(j.models ?? []));
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Errors

/** Never let a key reach the logs (we send it as a header, but be defensive about echoed URLs). */
export const redact = (s: string) => s.replace(/([?&]key=)[^&\s"]+/gi, "$1***").replace(/AIza[0-9A-Za-z_-]{20,}/g, "AIza***");

async function apiError(res: Response, prefix = "Gemini hatası"): Promise<AnalyzeError> {
  let msg = "";
  let reason = "";
  let raw = "";
  try {
    raw = await res.text();
    const j = JSON.parse(raw) as { error?: { message?: string; status?: string; details?: { reason?: string }[] } };
    msg = j.error?.message ?? "";
    reason = j.error?.details?.find((d) => d.reason)?.reason ?? j.error?.status ?? "";
  } catch {
    /* non-JSON */
  }
  console.error(`[gemini] ${prefix} — HTTP ${res.status} ${redact(res.url.split("?")[0])}: ${redact(raw.slice(0, 2000))}`);
  if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED|UNAUTHENTICATED/i.test(`${reason} ${msg}`) || res.status === 401) {
    return new AnalyzeError("gemini_error", "Gemini API anahtarı geçersiz veya yetkisiz (GEMINI_API_KEY'i kontrol et).", 502);
  }
  if (res.status === 429) return new AnalyzeError("gemini_error", "Gemini kota / hız sınırı aşıldı; biraz sonra tekrar dene.", 429);
  const short = msg.length > 240 ? `${msg.slice(0, 239)}…` : msg;
  return new AnalyzeError("gemini_error", `${prefix} (${res.status})${short ? `: ${short}` : ""}`, 502);
}

const isModelMissing = (status: number, body: string) =>
  status === 404 || (status === 400 && /model.*(not found|is not supported|does not exist)|unknown model/i.test(body));

// ---------------------------------------------------------------------------------------------
// Media

type Part =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } }
  | { file_data: { mime_type?: string; file_uri: string } };

interface Prepared {
  parts: Part[];
  input: AnalysisInput;
  cleanup?: () => Promise<void>;
}

class DownloadError extends Error {
  constructor(public status: number, public tooLarge = false) {
    super(tooLarge ? "too large" : `HTTP ${status}`);
  }
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

function guessMime(url: string, header: string | null, fallback: string): string {
  const h = header?.split(";")[0].trim().toLowerCase();
  if (h && h !== "application/octet-stream" && h !== "binary/octet-stream") return h;
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  const map: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
  return (ext && map[ext]) || fallback;
}

/** Media under /public (our own copies, e.g. /media/meta/<id>.jpg): read from disk, else fetch from our origin. */
async function readLocal(urlPath: string, cap: number, origin: string | undefined, signal: AbortSignal) {
  const publicDir = path.join(process.cwd(), "public");
  const file = path.normalize(path.join(publicDir, decodeURIComponent(urlPath.split("?")[0])));
  if (file.startsWith(publicDir + path.sep)) {
    try {
      const st = await fs.stat(file);
      if (st.size > cap) throw new DownloadError(413, true);
      return { bytes: await fs.readFile(file), mime: guessMime(file, null, "image/jpeg") };
    } catch (e) {
      if (e instanceof DownloadError) throw e;
      /* not bundled with the function (Vercel) — fetch from our own origin instead */
    }
  }
  if (!origin) throw new DownloadError(404);
  return download(new URL(urlPath, origin).toString(), cap, signal);
}

async function download(url: string, cap: number, signal: AbortSignal): Promise<{ bytes: Buffer; mime: string }> {
  let res: Response;
  try {
    res = await fetch(url, { signal, redirect: "follow", headers: { "user-agent": UA, accept: "*/*" } });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new DownloadError(0);
  }
  if (!res.ok || !res.body) {
    void res.body?.cancel().catch(() => {});
    throw new DownloadError(res.status);
  }
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > cap) {
    void res.body.cancel().catch(() => {});
    throw new DownloadError(413, true);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      void reader.cancel().catch(() => {});
      throw new DownloadError(413, true);
    }
    chunks.push(value);
  }
  return { bytes: Buffer.concat(chunks), mime: guessMime(url, res.headers.get("content-type"), "application/octet-stream") };
}

function fetchMedia(url: string, cap: number, origin: string | undefined, signal: AbortSignal) {
  return url.startsWith("/") ? readLocal(url, cap, origin, signal) : download(url, cap, signal);
}

async function uploadFile(key: string, bytes: Buffer, mime: string, displayName: string, signal: AbortSignal) {
  const start = await fetch(`${API}/upload/v1beta/files`, {
    method: "POST",
    signal,
    headers: {
      "x-goog-api-key": key,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  if (!start.ok) throw await apiError(start, "Gemini dosya yükleme başlatılamadı");
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new AnalyzeError("gemini_error", "Gemini dosya yükleme adresi dönmedi.", 502);

  const up = await fetch(uploadUrl, {
    method: "POST",
    signal,
    headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize", "Content-Type": mime },
    body: new Uint8Array(bytes),
  });
  if (!up.ok) throw await apiError(up, "Gemini dosya yüklenemedi");
  const info = (await up.json()) as { file?: { name?: string; uri?: string; state?: string; mimeType?: string } };
  let file = info.file;
  if (!file?.name || !file.uri) throw new AnalyzeError("gemini_error", "Gemini dosya bilgisi eksik döndü.", 502);

  // Videos are processed asynchronously: poll until ACTIVE.
  while (file.state && file.state !== "ACTIVE") {
    if (file.state === "FAILED") throw new AnalyzeError("gemini_error", "Gemini videoyu işleyemedi (dosya durumu FAILED).", 502);
    await sleep(1500, signal);
    const r = await fetch(`${API}/v1beta/${file.name}`, { headers: { "x-goog-api-key": key }, signal });
    if (!r.ok) throw await apiError(r, "Gemini dosya durumu okunamadı");
    file = (await r.json()) as typeof file;
  }
  const name = file.name!;
  return {
    part: { file_data: { mime_type: file.mimeType ?? mime, file_uri: file.uri! } } as Part,
    cleanup: async () => {
      await fetch(`${API}/v1beta/${name}`, { method: "DELETE", headers: { "x-goog-api-key": key } }).catch(() => {});
    },
  };
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}

const hasCopy = (ad: Ad) => Boolean(ad.headline || ad.body || ad.cta);

async function imageParts(urls: string[], origin: string | undefined, signal: AbortSignal): Promise<Part[]> {
  const parts: Part[] = [];
  for (const u of urls.slice(0, MAX_IMAGES)) {
    try {
      const { bytes, mime } = await fetchMedia(u, MAX_IMAGE_BYTES, origin, signal);
      if (!mime.startsWith("image/")) continue;
      parts.push({ inline_data: { mime_type: mime, data: bytes.toString("base64") } });
    } catch (e) {
      if (signal.aborted) throw e;
      /* expired / missing image — skip */
    }
  }
  return parts;
}

/** Image URLs worth trying for an ad, our own hosted copies first. */
function imageCandidates(ad: Ad, { postersOnly }: { postersOnly: boolean }): string[][] {
  const groups: string[][] = [];
  for (const m of ad.media) {
    if (isYouTubeUrl(m.url)) continue;
    const list = m.type === "video" ? [m.thumbnailUrl] : postersOnly ? [] : [m.thumbnailUrl?.startsWith("/") ? m.thumbnailUrl : undefined, m.url, m.thumbnailUrl];
    const uniq = [...new Set(list.filter((u): u is string => Boolean(u)))];
    if (uniq.length) groups.push(uniq);
  }
  return groups;
}

/** First URL of each group that downloads (each image tries its own copy, then the CDN URL). */
async function firstWorkingImages(groups: string[][], origin: string | undefined, signal: AbortSignal): Promise<Part[]> {
  const out: Part[] = [];
  for (const g of groups.slice(0, MAX_IMAGES)) {
    for (const u of g) {
      const p = await imageParts([u], origin, signal);
      if (p.length) {
        out.push(p[0]);
        break;
      }
    }
  }
  return out;
}

async function prepareMedia(ad: Ad, key: string, opts: { allowPoster?: boolean; origin?: string }, signal: AbortSignal): Promise<Prepared> {
  const yt = adYouTubeId(ad);
  if (yt) return { parts: [{ file_data: { file_uri: `https://www.youtube.com/watch?v=${yt}` } }], input: "youtube" };

  const video = ad.media.find((m) => m.type === "video" && !isYouTubeUrl(m.url));
  if (video) {
    const posterGroups = imageCandidates(ad, { postersOnly: true });
    const canUsePoster = posterGroups.length > 0 || hasCopy(ad);
    if (!opts.allowPoster) {
      try {
        const { bytes, mime } = await fetchMedia(video.url, MAX_VIDEO_BYTES, opts.origin, signal);
        const vmime = mime.startsWith("video/") ? mime : "video/mp4";
        if (bytes.byteLength <= INLINE_VIDEO_MAX_BYTES) {
          return { parts: [{ inline_data: { mime_type: vmime, data: bytes.toString("base64") } }], input: "video" };
        }
        const up = await uploadFile(key, bytes, vmime, ad.id, signal);
        return { parts: [up.part], input: "video", cleanup: up.cleanup };
      } catch (e) {
        if (!(e instanceof DownloadError)) throw e;
        if (e.tooLarge) throw new AnalyzeError("too_large", "Video 50 MB sınırından büyük; sadece poster + metinle özetleyebilirsin.", 413, canUsePoster);
        // 403/404/410 from fbcdn = signed URL expired; network errors are treated the same way.
        throw new AnalyzeError("video_expired", VIDEO_EXPIRED_MESSAGE, 410, canUsePoster);
      }
    }
    const parts = await firstWorkingImages(posterGroups, opts.origin, signal);
    if (parts.length) return { parts, input: "poster" };
    if (hasCopy(ad)) return { parts: [], input: "text" };
    throw new AnalyzeError("no_media", "Ne video ne poster görseline ulaşılabildi; reklamı Ad Library'de açıp tekrar dene.", 422);
  }

  const parts = await firstWorkingImages(imageCandidates(ad, { postersOnly: false }), opts.origin, signal);
  if (parts.length) return { parts, input: "images" };
  if (hasCopy(ad)) return { parts: [], input: "text" };
  throw new AnalyzeError("no_media", "Bu reklamın görseline ya da metnine ulaşılamadı; özetlenecek bir şey yok.", 422);
}

// ---------------------------------------------------------------------------------------------
// Prompt + schema

const STR = { type: "STRING" };
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    hook: {
      type: "OBJECT",
      properties: { text: STR, timestamp: STR, whyItWorks: STR },
      required: ["text", "timestamp", "whyItWorks"],
    },
    scenes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { start: STR, end: STR, visual: STR, audio_or_voiceover: STR, onScreenText: STR },
        required: ["start", "end", "visual", "audio_or_voiceover", "onScreenText"],
      },
    },
    transcript: STR,
    structure: {
      type: "OBJECT",
      properties: {
        framework: STR,
        beats: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: { label: STR, start: STR, end: STR, description: STR },
            required: ["label", "start", "end", "description"],
          },
        },
      },
      required: ["framework", "beats"],
    },
    angle: STR,
    targetAudience: STR,
    emotionalTriggers: { type: "ARRAY", items: STR },
    offer: STR,
    cta: STR,
    whyItWins: STR,
    remixIdeas: { type: "ARRAY", items: STR },
  },
  required: ["hook", "scenes", "transcript", "structure", "angle", "targetAudience", "emotionalTriggers", "offer", "cta", "whyItWins", "remixIdeas"],
};

const SYSTEM = `Sen kıdemli bir performans pazarlaması kreatif stratejistisin. Reklamları sahne sahne çözümler, hook'u ve anlatı yapısını çıkarır, neden kazandığını veriyle açıklarsın.
Kurallar:
- Tüm açıklamaları TÜRKÇE yaz. Sadece "transcript" ve "onScreenText" orijinal dilinde birebir yazılır.
- Zaman damgaları "MM:SS" biçiminde (ör. "00:03").
- Uydurma: duymadığın konuşmayı, görmediğin metni yazma. Konuşma yoksa "Seslendirme yok", ekranda yazı yoksa "—" yaz.
- Kısa, somut, uygulanabilir ol; genel geçer pazarlama klişelerinden kaçın.`;

const SEGMENT_TR: Record<Ad["segment"], string> = { dtc: "DTC / e-ticaret", hotel: "Otel / turizm", general: "Genel" };

function metadataBlock(ad: Ad): string {
  const lines: string[] = [];
  const add = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) return;
    lines.push(`- ${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
  };
  add("Marka", ad.brand.name);
  add("Kaynak", ad.source === "meta" ? "Meta Ad Library" : ad.source === "tiktok" ? "TikTok" : "Küratörlü klasik reklam");
  add("Segment", SEGMENT_TR[ad.segment]);
  add("Pazar", ad.market);
  add("Dikey", ad.vertical);
  add("Format", ad.format);
  add("Başlık", ad.headline);
  add("Metin", ad.body && (ad.body.length > 2000 ? `${ad.body.slice(0, 2000)}…` : ad.body));
  add("CTA", ad.cta);
  add("Landing", ad.landingUrl);
  add("Platformlar", ad.platforms);
  add("Diller", ad.languages);
  add("Başlangıç", ad.startedAt?.slice(0, 10));
  add("Yayında gün", ad.activeDays !== undefined ? `${ad.activeDays} gün${ad.isActive === false ? " (durdu)" : ad.isActive ? " (hâlâ yayında)" : ""}` : undefined);
  add("Varyasyon sayısı (aynı kreatifi kullanan reklam)", ad.variations);
  add("AdGym kazanan skoru (0-100)", ad.source === "curated" ? "Efsane / küratörlü klasik" : ad.performance.score);
  add("Skor gerekçeleri", ad.performance.reasons);
  return lines.join("\n");
}

const INPUT_HINT: Record<AnalysisInput, string> = {
  video: "Ekteki videoyu baştan sona izle ve dinle.",
  youtube: "Ekteki YouTube videosunu baştan sona izle ve dinle.",
  images: "Ekteki görsel(ler) bir görsel/carousel reklam. 'scenes' her görsel/kart için bir öğe olsun (start/end: \"Kart 1\" gibi), 'transcript' görsellerdeki yazıların birebir dökümü olsun.",
  poster:
    "DİKKAT: Video linkinin süresi dolduğu için sadece videonun POSTER (kapak) görseli ve reklam metni var. Videoyu görmüş gibi davranma; sahneleri ve yapıyı metin + kapak görselinden makul şekilde çıkar, tahmin olan her şeyi 'tahmini' diye belirt. 'transcript' alanına \"Video izlenemedi (link süresi dolmuş)\" yaz.",
  text: "DİKKAT: Reklamın medyasına ulaşılamadı; sadece metin ve meta veriler var. Yapıyı metinden çıkar, tahmin olanları 'tahmini' diye belirt. 'transcript' alanına \"Medya yok — sadece reklam metni\" yaz.",
};

function buildPrompt(ad: Ad, input: AnalysisInput): string {
  return `${INPUT_HINT[input]}

Reklamın meta verileri (Ad Library / AdGym'den):
${metadataBlock(ad)}

İstenen JSON alanları:
- hook: ilk 1-3 saniyede dikkati çeken an. text = ne söyleniyor/gösteriliyor, timestamp = "MM:SS", whyItWorks = neden durdurup izletiyor.
- scenes: sahne sahne döküm (her kesme/çekim değişimi ya da anlam değişimi bir sahne). start/end "MM:SS"; visual = ne görünüyor (çekim tipi, oyuncu, ürün); audio_or_voiceover = konuşma/müzik/ses efekti; onScreenText = ekrandaki yazı (orijinal dilde).
- transcript: tüm konuşmanın birebir dökümü, satır başlarında [MM:SS]. Orijinal dil Türkçe değilse sonuna "Türkçe çeviri:" başlığıyla kısa bir çeviri ekle.
- structure.framework: genel kalıp tek satırda, ör. "Hook → Problem → Çözüm → Kanıt → CTA". structure.beats: bu kalıbın her adımı (label, start, end, description).
- angle: ana satış açısı. targetAudience: hedef kitle. emotionalTriggers: duygusal tetikleyiciler (kısa etiketler). offer: teklif (indirim, garanti, kargo vb.; yoksa "Açık teklif yok"). cta: harekete geçirici çağrı.
- whyItWins: kreatif analizi meta verilerle BİRLEŞTİR — yayında kalma süresi, varyasyon sayısı (ölçekleme sinyali), platformlar ve skor ne anlatıyor; bu kreatif neden para kazandırıyor olabilir. 3-5 cümle.
- remixIdeas: kullanıcının kendi markasına (${SEGMENT_TR[ad.segment]} ya da otel/DTC) uyarlayabileceği TAM 3 somut konsept fikri. Her biri: format + hook cümlesi + ana mesaj, tek paragraf.`;
}

function thinkingFor(model: string): Record<string, unknown> | undefined {
  const v = model.match(/gemini-(\d+)(?:\.(\d+))?/i);
  if (!v) return undefined;
  const major = Number(v[1]);
  if (major >= 3) return { thinkingLevel: "low" }; // cheaper + faster; plenty for this extraction task
  if (major === 2 && Number(v[2] ?? 0) >= 5) return { thinkingBudget: 1024 };
  return undefined;
}

interface GenerateResult {
  text: string;
  usage?: AnalysisUsage;
}

async function generateOnce(key: string, model: string, parts: Part[], withThinking: boolean, signal: AbortSignal): Promise<Response> {
  const thinking = withThinking ? thinkingFor(model) : undefined;
  return fetch(`${API}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    signal,
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        maxOutputTokens: 16384,
        ...(thinking ? { thinkingConfig: thinking } : {}),
      },
    }),
  });
}

async function parseGenerate(res: Response): Promise<GenerateResult> {
  const j = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
  };
  if (j.promptFeedback?.blockReason) throw new AnalyzeError("gemini_error", `Gemini isteği engelledi (${j.promptFeedback.blockReason}).`, 502);
  const cand = j.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
  if (!text) throw new AnalyzeError("bad_output", `Gemini boş yanıt döndü${cand?.finishReason ? ` (${cand.finishReason})` : ""}.`, 502);
  const u = j.usageMetadata;
  return {
    text,
    usage: u ? { promptTokens: u.promptTokenCount, outputTokens: u.candidatesTokenCount, thoughtsTokens: u.thoughtsTokenCount, totalTokens: u.totalTokenCount } : undefined,
  };
}

/** generateContent with the configured model; on "model not found" falls back to the newest flash model. */
async function generate(key: string, parts: Part[], signal: AbortSignal): Promise<GenerateResult & { model: string }> {
  const configured = configuredModel();
  let model = fallbackFor.get(configured) ?? configured;

  for (let attempt = 0; attempt < 3; attempt++) {
    let res = await generateOnce(key, model, parts, true, signal);
    if (res.status === 400 && thinkingFor(model)) {
      const body = await res.clone().text();
      if (/thinking/i.test(body)) res = await generateOnce(key, model, parts, false, signal); // model rejects thinkingConfig
    }
    if (res.ok) return { ...(await parseGenerate(res)), model };

    const body = await res.clone().text();
    if (isModelMissing(res.status, body) && attempt === 0) {
      const picked = pickFlashModel(await listModels(key, signal));
      if (!picked || picked === model) throw await apiError(res, `Gemini modeli bulunamadı (${model})`);
      console.error(`[gemini] model "${model}" not available (HTTP ${res.status}: ${redact(body.slice(0, 500))}); falling back to "${picked}"`);
      fallbackFor.set(configured, picked);
      model = picked;
      continue;
    }
    if (res.status >= 500 && attempt < 1) {
      await sleep(800, signal);
      continue;
    }
    throw await apiError(res);
  }
  throw new AnalyzeError("gemini_error", "Gemini yanıt vermedi.", 502);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(text.slice(a, b + 1));
      } catch {
        /* fallthrough */
      }
    }
    throw new AnalyzeError("bad_output", "Gemini geçerli JSON döndürmedi; tekrar dene.", 502);
  }
}

// ---------------------------------------------------------------------------------------------
// Public entry point

/** Per-instance cache (adId + model) so a double press / retry within one instance isn't charged twice. */
const cache = new Map<string, AnalysisRecord>();
const inflight = new Map<string, Promise<AnalysisRecord>>();
const CACHE_MAX = 200;

const cacheKey = (adId: string, model: string, allowPoster?: boolean) => `${adId}|${model}|${allowPoster ? "poster" : "full"}`;

export interface AnalyzeOptions {
  force?: boolean;
  allowPoster?: boolean;
  /** Origin of the incoming request — used to fetch our own /media/... copies when they aren't on disk. */
  origin?: string;
  /** Called with work to run after the response (e.g. deleting an uploaded Gemini file). */
  defer?: (fn: () => Promise<void>) => void;
}

export async function analyzeAd(ad: Ad, opts: AnalyzeOptions = {}): Promise<{ record: AnalysisRecord; cached: boolean }> {
  const key = geminiKey();
  if (!key) throw new AnalyzeError("no_key", MISSING_KEY_MESSAGE, 503);

  const configured = configuredModel();
  const k = cacheKey(ad.id, fallbackFor.get(configured) ?? configured, opts.allowPoster);
  if (!opts.force) {
    const hit = cache.get(k);
    if (hit) return { record: hit, cached: true };
  }
  const running = inflight.get(k);
  if (running) return { record: await running, cached: true };

  const job = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error("deadline")), DEADLINE_MS);
    let cleanup: (() => Promise<void>) | undefined;
    try {
      const media = await prepareMedia(ad, key, opts, ctrl.signal);
      cleanup = media.cleanup;
      const parts: Part[] = [...media.parts, { text: buildPrompt(ad, media.input) }];
      const out = await generate(key, parts, ctrl.signal);
      const data = normalizeAnalysis(parseJson(out.text));
      if (!data.hook.text && !data.scenes.length && !data.structure.framework) {
        throw new AnalyzeError("bad_output", "Gemini boş bir analiz döndürdü; tekrar dene.", 502);
      }
      const record: AnalysisRecord = { model: out.model, createdAt: new Date().toISOString(), input: media.input, data };
      console.error(`[gemini] analyzed ${ad.id} with model "${out.model}" (configured "${configured}", input ${media.input}, tokens ${JSON.stringify(out.usage ?? {})})`);
      if (out.usage) record.usage = out.usage;
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey(ad.id, out.model, opts.allowPoster), record);
      cache.set(k, record);
      return record;
    } catch (e) {
      if (ctrl.signal.aborted) {
        throw new AnalyzeError("timeout", "Gemini 60 sn içinde bitiremedi (video uzun olabilir). Biraz sonra tekrar dene.", 504, true);
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (cleanup) (opts.defer ?? ((fn) => void fn()))(cleanup);
    }
  })();

  inflight.set(k, job);
  try {
    return { record: await job, cached: false };
  } finally {
    inflight.delete(k);
  }
}
