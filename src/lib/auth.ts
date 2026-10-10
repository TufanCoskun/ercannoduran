/**
 * Login gate for AdGym: one admin account plus an optional, restricted viewer account.
 *
 * Credentials come ONLY from env vars:
 *   ADMIN_USERNAME, ADMIN_PASSWORD, AUTH_SECRET  (required; missing → site fails closed)
 *   VIEWER_USERNAME, VIEWER_PASSWORD             (optional; both set → a "viewer" account exists)
 * Session token: base64url(JSON {u, r, exp}) + "." + base64url(HMAC-SHA256(payload, AUTH_SECRET)).
 * Uses Web Crypto only, so it runs in the Edge middleware and in Node route handlers.
 */

export const SESSION_COOKIE = "adgym_session";
/** Display-only role hint for the client UI (NOT httpOnly). The server never trusts it. */
export const ROLE_COOKIE = "adgym_role";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const MISCONFIGURED_MESSAGE = "ADMIN_USERNAME / ADMIN_PASSWORD / AUTH_SECRET ayarlanmamış";
export const FORBIDDEN_ANALYZE_MESSAGE = "Bu hesapta Gemini özetleme yetkisi yok.";

export type Role = "admin" | "viewer";
export type Account = { username: string; password: string; role: Role };
export type AuthConfig = { accounts: Account[]; secret: string };
export type Session = { u: string; r: Role };

/** Returns null when any required env var is missing (callers must fail closed). */
export function getAuthConfig(): AuthConfig | null {
  const username = process.env.ADMIN_USERNAME ?? "";
  const password = process.env.ADMIN_PASSWORD ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (!username || !password || secret.length < 16) return null;
  const accounts: Account[] = [{ username, password, role: "admin" }];
  const vUser = process.env.VIEWER_USERNAME ?? "";
  const vPass = process.env.VIEWER_PASSWORD ?? "";
  // Viewer is optional; ignored if incomplete or if it collides with the admin username.
  if (vUser && vPass && vUser !== username) accounts.push({ username: vUser, password: vPass, role: "viewer" });
  return { accounts, secret };
}

/** Role of a configured account by username, or null if no such account exists (any more). */
export function roleOf(username: string, cfg: AuthConfig): Role | null {
  return cfg.accounts.find((a) => a.username === username)?.role ?? null;
}

/** Permission check: only admin may run (paid) Gemini analysis. */
export function canAnalyze(session: Session | null): boolean {
  return session?.r === "admin";
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

/** Returns the matching account's role, or null. Every account is checked (no early exit). */
export async function checkCredentials(username: string, password: string, cfg: AuthConfig): Promise<Role | null> {
  const results = await Promise.all(
    cfg.accounts.map(async (acc) => {
      const [userOk, passOk] = await Promise.all([
        safeStringEqual(username, acc.username, cfg.secret),
        safeStringEqual(password, acc.password, cfg.secret),
      ]);
      // Non-short-circuit AND: both comparisons always run.
      return (Number(userOk) & Number(passOk)) === 1 ? acc.role : null;
    }),
  );
  return results.find((r) => r !== null) ?? null;
}

type Payload = { u: string; r?: Role; exp: number };

export async function createSessionToken(username: string, role: Role, secret: string, nowMs = Date.now()): Promise<string> {
  const payload: Payload = { u: username, r: role, exp: Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS };
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  const sig = b64urlEncode(await hmac(secret, body));
  return `${body}.${sig}`;
}

/**
 * Verifies a session token and returns the session, or null.
 * - Tokens issued before roles existed have no `r`; they are admin tokens (only admin could log in then).
 * - The role must still match the configured account for that username, so changing/removing
 *   ADMIN_USERNAME or VIEWER_USERNAME invalidates those sessions (as does rotating AUTH_SECRET).
 */
export async function verifySessionToken(token: string | undefined | null, cfg: AuthConfig, nowMs = Date.now()): Promise<Session | null> {
  if (!token || token.length > 1024) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const body = token.slice(0, dot);
  const sig = b64urlDecode(token.slice(dot + 1));
  if (!sig) return null;
  const expected = await hmac(cfg.secret, body);
  if (!timingSafeEqual(sig, expected)) return null;
  const raw = b64urlDecode(body);
  if (!raw) return null;
  try {
    const payload = JSON.parse(decoder.decode(raw)) as Partial<Payload>;
    if (typeof payload.u !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 <= nowMs) return null;
    const claimed: Role = payload.r === undefined ? "admin" : payload.r;
    if (claimed !== "admin" && claimed !== "viewer") return null;
    if (roleOf(payload.u, cfg) !== claimed) return null;
    return { u: payload.u, r: claimed };
  } catch {
    return null;
  }
}

/** Reads + verifies the session cookie from a request (route handlers / middleware). */
export async function getRequestSession(req: { cookies: { get(name: string): { value: string } | undefined } }): Promise<Session | null> {
  const cfg = getAuthConfig();
  if (!cfg) return null;
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value, cfg);
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
