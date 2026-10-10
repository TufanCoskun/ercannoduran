/**
 * Single-account auth for AdGym.
 *
 * Credentials come ONLY from env vars (ADMIN_USERNAME, ADMIN_PASSWORD, AUTH_SECRET).
 * Session token: base64url(JSON {u, exp}) + "." + base64url(HMAC-SHA256(payload, AUTH_SECRET)).
 * Uses Web Crypto only, so it runs in the Edge middleware and in Node route handlers.
 */

export const SESSION_COOKIE = "adgym_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const MISCONFIGURED_MESSAGE = "ADMIN_USERNAME / ADMIN_PASSWORD / AUTH_SECRET ayarlanmamış";

export type AuthConfig = { username: string; password: string; secret: string };

/** Returns null when any required env var is missing (callers must fail closed). */
export function getAuthConfig(): AuthConfig | null {
  const username = process.env.ADMIN_USERNAME ?? "";
  const password = process.env.ADMIN_PASSWORD ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (!username || !password || secret.length < 16) return null;
  return { username, password, secret };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) return null;
  try {
    const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    keyCache.set(secret, key);
  }
  return key;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(data));
  return new Uint8Array(sig);
}

/** Constant-time comparison of two byte arrays (length mismatch still walks the longer one). */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * Constant-time string comparison: both sides are HMAC'd first so the comparison
 * always runs over two fixed-length digests, independent of the inputs' lengths.
 */
async function safeStringEqual(a: string, b: string, secret: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([hmac(secret, `cmp:${a}`), hmac(secret, `cmp:${b}`)]);
  return timingSafeEqual(ha, hb);
}

export async function checkCredentials(username: string, password: string, cfg: AuthConfig): Promise<boolean> {
  const [userOk, passOk] = await Promise.all([
    safeStringEqual(username, cfg.username, cfg.secret),
    safeStringEqual(password, cfg.password, cfg.secret),
  ]);
  // Non-short-circuit AND: both comparisons always run.
  return (Number(userOk) & Number(passOk)) === 1;
}

type Payload = { u: string; exp: number };

export async function createSessionToken(username: string, secret: string, nowMs = Date.now()): Promise<string> {
  const payload: Payload = { u: username, exp: Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS };
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  const sig = b64urlEncode(await hmac(secret, body));
  return `${body}.${sig}`;
}

export async function verifySessionToken(token: string | undefined | null, cfg: AuthConfig, nowMs = Date.now()): Promise<boolean> {
  if (!token || token.length > 1024) return false;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return false;
  const body = token.slice(0, dot);
  const sig = b64urlDecode(token.slice(dot + 1));
  if (!sig) return false;
  const expected = await hmac(cfg.secret, body);
  if (!timingSafeEqual(sig, expected)) return false;
  const raw = b64urlDecode(body);
  if (!raw) return false;
  try {
    const payload = JSON.parse(decoder.decode(raw)) as Partial<Payload>;
    if (typeof payload.u !== "string" || typeof payload.exp !== "number") return false;
    if (payload.exp * 1000 <= nowMs) return false;
    // Changing ADMIN_USERNAME invalidates old sessions (as does rotating AUTH_SECRET).
    return payload.u === cfg.username;
  } catch {
    return false;
  }
}

/**
 * Only same-origin relative paths are allowed as a post-login redirect target.
 * Anything else (absolute URLs, protocol-relative "//host", backslash tricks,
 * control characters, auth routes) falls back to "/".
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  try {
    const base = "http://adgym.invalid";
    const url = new URL(next, base);
    if (url.origin !== base) return "/";
    if (url.pathname === "/login" || url.pathname.startsWith("/api/auth")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}
