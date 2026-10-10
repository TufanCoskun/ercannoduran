import { get, put } from "@vercel/blob";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "./auth";

/**
 * Brand strategy for strategy-aware remix ideas (server-only).
 *
 * The strategy document is confidential: it is NEVER part of the repo. It is uploaded by the admin on
 * /strategy (or via scripts/upload-strategy.mjs) and stored as private blobs, next to the quota records:
 *   strategy/active.json = { name, updatedAt, brief, fullTextChars, active, briefSource, model? }
 *   strategy/full.txt    = full extracted text (reference only; prompts use the condensed brief)
 *
 * Store selection mirrors src/lib/quota.ts:
 *   - BLOB_READ_WRITE_TOKEN set              → Vercel Blob (private)
 *   - on Vercel without a token              → null (feature off; admin page shows an error)
 *   - QUOTA_LOCAL_DIR (tests / local builds) → local files under that dir
 *   - NODE_ENV=development                   → local files in the OS temp dir
 */

export const STRATEGY_PATH = "strategy/active.json";
export const STRATEGY_FULL_PATH = "strategy/full.txt";
const CACHE_TTL_MS = 60_000;
/** Hard caps (the brief goes into every admin analysis prompt). */
export const MAX_BRIEF_CHARS = 20_000;
export const MAX_SOURCE_CHARS = 400_000;

export type BriefSource = "gemini" | "manual" | "mock";

export interface StrategyRecord {
  name: string;
  updatedAt: string;
  /** Condensed brief (Turkish, ≲ 2,500 tokens) that is added to Gemini prompts. */
  brief: string;
  fullTextChars: number;
  /** "Remix fikirleri bu stratejiye göre üretilsin" toggle. */
  active: boolean;
  briefSource: BriefSource;
  /** Gemini model that condensed the brief (when briefSource = "gemini"). */
  model?: string;
}

/** What prompts need. `version` keys caches so a new/edited brief never serves stale ideas. */
export interface ActiveStrategy {
  name: string;
  brief: string;
  version: string;
}

interface StrategyStore {
  kind: "blob" | "file";
  read(pathname: string): Promise<string | null>;
  write(pathname: string, body: string, contentType: string): Promise<void>;
}

function blobStore(token: string): StrategyStore {
  return {
    kind: "blob",
    async read(pathname) {
      const res = await get(pathname, { access: "private", useCache: false, token });
      if (!res || res.statusCode !== 200) return null;
      return new Response(res.stream).text();
    },
    async write(pathname, body, contentType) {
      await put(pathname, body, { access: "private", token, contentType, addRandomSuffix: false, allowOverwrite: true });
    },
  };
}

function fileStore(dir: string): StrategyStore {
  const fileFor = (p: string) => path.join(dir, p);
  return {
    kind: "file",
    async read(p) {
      try {
        return await fs.readFile(fileFor(p), "utf8");
      } catch {
        return null;
      }
    },
    async write(p, body) {
      const file = fileFor(p);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, body);
      await fs.rename(tmp, file);
    },
  };
}

export function strategyStore(): StrategyStore | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) return blobStore(token);
  if (process.env.VERCEL) return null;
  const local = process.env.QUOTA_LOCAL_DIR?.trim();
  if (local) return fileStore(path.resolve(local));
  if (process.env.NODE_ENV === "development") return fileStore(path.join(os.tmpdir(), "adgym-quota"));
  return null;
}

export const STRATEGY_STORE_MISSING_MESSAGE = "Strateji deposu ayarlanmamış (BLOB_READ_WRITE_TOKEN)";

function normalize(raw: unknown): StrategyRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const brief = str(o.brief).trim();
  const name = str(o.name).trim();
  if (!brief || !name) return null;
  const src = o.briefSource === "gemini" || o.briefSource === "mock" ? o.briefSource : "manual";
  return {
    name,
    updatedAt: str(o.updatedAt) || new Date(0).toISOString(),
    brief,
    fullTextChars: typeof o.fullTextChars === "number" && Number.isFinite(o.fullTextChars) ? o.fullTextChars : 0,
    active: o.active !== false,
    briefSource: src,
    ...(str(o.model) ? { model: str(o.model) } : {}),
  };
}

// --- in-memory cache (per function instance) ----------------------------------------------------

let cache: { at: number; value: StrategyRecord | null } | null = null;

/** Reads strategy/active.json (cached ~60 s). Throws when the store is configured but unreadable. */
export async function readStrategy({ fresh = false }: { fresh?: boolean } = {}): Promise<StrategyRecord | null> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const store = strategyStore();
  if (!store) return null;
  const text = await store.read(STRATEGY_PATH);
  let value: StrategyRecord | null = null;
  if (text) {
    try {
      value = normalize(JSON.parse(text));
    } catch {
      value = null;
    }
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function writeStrategy(rec: StrategyRecord, fullText?: string): Promise<StrategyRecord> {
  const store = strategyStore();
  if (!store) throw new Error(STRATEGY_STORE_MISSING_MESSAGE);
  if (fullText !== undefined) await store.write(STRATEGY_FULL_PATH, fullText, "text/plain; charset=utf-8");
  await store.write(STRATEGY_PATH, JSON.stringify(rec, null, 2), "application/json");
  cache = { at: Date.now(), value: rec };
  return rec;
}

/** Active strategy for prompts, or null (no store, nothing uploaded, toggled off, or read error). */
export async function getActiveStrategy(): Promise<ActiveStrategy | null> {
  try {
    const rec = await readStrategy();
    if (!rec || !rec.active || !rec.brief) return null;
    return { name: rec.name, brief: rec.brief, version: `${rec.name}@${rec.updatedAt}` };
  } catch (e) {
    console.error("[strategy] read failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Who gets strategy-aware remix ideas. Admin only by default: the strategy is an internal document and
 * the generated ideas quote it. STRATEGY_FOR_VIEWERS=1 opens it to viewers (charged against their quota).
 */
export function strategyAllowed(session: Session | null): boolean {
  if (!session) return false;
  if (session.r === "admin") return true;
  return process.env.STRATEGY_FOR_VIEWERS === "1";
}

// --- text extraction ----------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", middot: "·", deg: "°" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Common UTF-8-read-as-Latin-1 artefacts in Turkish text ("Ã§" → "ç"). */
const MOJIBAKE: [string, string][] = [
  ["Ã§", "ç"], ["Ã‡", "Ç"], ["Ã¶", "ö"], ["Ã–", "Ö"], ["Ã¼", "ü"], ["Ãœ", "Ü"],
  ["ÄŸ", "ğ"], ["Äž", "Ğ"], ["Ä±", "ı"], ["Ä°", "İ"], ["ÅŸ", "ş"], ["Åž", "Ş"], ["Ã¢", "â"], ["Ã®", "î"],
];

/** Plain text from an uploaded .html/.md/.txt (scripts, styles and tags stripped; block breaks kept). */
export function extractText(raw: string, filename = ""): string {
  let t = raw.replace(/^﻿/, "");
  const isHtml = /\.html?$/i.test(filename) || /<(html|body|div|p|h[1-6]|section|table)[\s>]/i.test(t);
  if (isHtml) {
    t = t
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<(br|hr)\b[^>]*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<(td|th)\b[^>]*>/gi, " | ")
      .replace(/<\/?(p|div|section|article|header|footer|aside|main|nav|h[1-6]|ul|ol|li|tr|table|thead|tbody|blockquote|figure|figcaption|dl|dt|dd)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "");
    t = decodeEntities(t);
  }
  for (const [bad, good] of MOJIBAKE) t = t.split(bad).join(good);
  return t
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Rough token estimate for Turkish text (≈ 3.5 chars per token). */
export const estimateTokens = (s: string) => Math.ceil(s.length / 3.5);
