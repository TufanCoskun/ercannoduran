import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Persistent per-user Gemini quotas for viewer accounts (server-side; survive logout, cookie
 * clearing and device switches). One small private JSON blob per viewer in Vercel Blob:
 *   quota/<username>.json = { used, limit, history: [{ adId, at }] }
 * The limit comes from the account config (VIEWER_ACCOUNTS / VIEWER_GEMINI_LIMIT), not the blob.
 *
 * Store selection:
 *   - BLOB_READ_WRITE_TOKEN set           → Vercel Blob (production / preview)
 *   - not on Vercel and QUOTA_LOCAL_DIR   → local JSON files (tests / local prod builds)
 *   - not on Vercel and NODE_ENV=development → JSON files in the OS temp dir
 *   - otherwise                           → null (callers fail closed for viewers)
 */

const HISTORY_MAX = 500;

/** Blob pathname for a viewer's quota record. */
export function quotaPath(username: string): string {
  return `quota/${encodeURIComponent(username)}.json`;
}

export type QuotaEntry = { adId: string; at: string };
export type QuotaState = { used: number; limit: number; history: QuotaEntry[] };
export type QuotaSummary = { used: number; limit: number };

interface Snapshot {
  state: QuotaState;
  /** Opaque version for optimistic concurrency (Blob ETag); undefined when the record doesn't exist yet. */
  version?: string;
}

export interface QuotaStore {
  kind: "blob" | "file";
  read(username: string, limit: number): Promise<Snapshot>;
  /** Writes the new state; returns false on a version conflict (caller retries). */
  write(username: string, state: QuotaState, version?: string): Promise<boolean>;
}

function normalize(raw: unknown, limit: number): QuotaState {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<QuotaState>;
  const used = typeof o.used === "number" && Number.isFinite(o.used) && o.used > 0 ? Math.floor(o.used) : 0;
  const history = Array.isArray(o.history)
    ? o.history.filter((h): h is QuotaEntry => !!h && typeof h.adId === "string" && typeof h.at === "string")
    : [];
  return { used, limit, history };
}

function blobStore(token: string): QuotaStore {
  return {
    kind: "blob",
    async read(username, limit) {
      const res = await get(quotaPath(username), { access: "private", useCache: false, token });
      if (!res || res.statusCode !== 200) return { state: normalize(null, limit) };
      const text = await new Response(res.stream).text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      return { state: normalize(parsed, limit), version: res.blob.etag };
    },
    async write(username, state, version) {
      try {
        await put(quotaPath(username), JSON.stringify(state), {
          access: "private",
          token,
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: true,
          ...(version ? { ifMatch: version } : {}),
        });
        return true;
      } catch (e) {
        if (e instanceof BlobPreconditionFailedError) return false;
        throw e;
      }
    },
  };
}

function fileStore(dir: string): QuotaStore {
  const fileFor = (username: string) => path.join(dir, quotaPath(username));
  return {
    kind: "file",
    async read(username, limit) {
      try {
        const text = await fs.readFile(fileFor(username), "utf8");
        return { state: normalize(JSON.parse(text), limit), version: "file" };
      } catch {
        return { state: normalize(null, limit) };
      }
    },
    async write(username, state) {
      const file = fileFor(username);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(state, null, 2));
      await fs.rename(tmp, file);
      return true;
    },
  };
}

let override: QuotaStore | null | undefined;
/** Test hook: inject a store (or null). Pass undefined to restore env-based selection. */
export function setQuotaStoreForTests(store: QuotaStore | null | undefined) {
  override = store;
}

export function quotaStore(): QuotaStore | null {
  if (override !== undefined) return override;
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) return blobStore(token);
  if (process.env.VERCEL) return null; // never fall back to local files on Vercel
  const local = process.env.QUOTA_LOCAL_DIR?.trim();
  if (local) return fileStore(path.resolve(local));
  if (process.env.NODE_ENV === "development") return fileStore(path.join(os.tmpdir(), "adgym-quota"));
  return null;
}

export async function readQuota(store: QuotaStore, username: string, limit: number): Promise<QuotaSummary> {
  const { state } = await store.read(username, limit);
  return { used: state.used, limit: state.limit };
}

/** Records one successful viewer analysis. Retries on concurrent writes (ETag mismatch). */
export async function consumeQuota(store: QuotaStore, username: string, limit: number, adId: string): Promise<QuotaSummary> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { state, version } = await store.read(username, limit);
    const next: QuotaState = {
      used: state.used + 1,
      limit: state.limit,
      history: [...state.history, { adId, at: new Date().toISOString() }].slice(-HISTORY_MAX),
    };
    if (await store.write(username, next, version)) return { used: next.used, limit: next.limit };
  }
  throw new Error("quota write conflict");
}

export function quotaExceededMessage(q: QuotaSummary): string {
  return `Gemini hakkın doldu (${Math.min(q.used, q.limit)}/${q.limit}).`;
}

export const QUOTA_STORE_MISSING_MESSAGE = "Kota deposu ayarlanmamış";
