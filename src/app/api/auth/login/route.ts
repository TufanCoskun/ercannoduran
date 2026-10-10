import { NextResponse, type NextRequest } from "next/server";
import {
  checkCredentials,
  createSessionToken,
  getAuthConfig,
  MISCONFIGURED_MESSAGE,
  safeNextPath,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

const FAILURE_DELAY_MS = 800;
const ERROR_MESSAGE = "Kullanıcı adı veya şifre yanlış";

type LoginInput = { username: string; password: string; remember: boolean; next: string };

async function readInput(req: NextRequest): Promise<LoginInput> {
  const type = req.headers.get("content-type") ?? "";
  let raw: Record<string, unknown> = {};
  try {
    if (type.includes("application/json")) {
      raw = (await req.json()) as Record<string, unknown>;
    } else {
      const fd = await req.formData();
      raw = Object.fromEntries(fd.entries());
    }
  } catch {
    raw = {};
  }
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const remember = raw.remember === true || raw.remember === "on" || raw.remember === "1" || raw.remember === "true";
  return { username: str(raw.username).trim(), password: str(raw.password), remember, next: safeNextPath(raw.next) };
}

/** Clients that send `Accept: application/json` get JSON; plain HTML form posts get redirects. */
function wantsJson(req: NextRequest): boolean {
  return (req.headers.get("accept") ?? "").includes("application/json");
}

export async function POST(req: NextRequest) {
  const cfg = getAuthConfig();
  if (!cfg) {
    return NextResponse.json({ error: MISCONFIGURED_MESSAGE }, { status: 503 });
  }

  const input = await readInput(req);
  const ok = input.username.length > 0 && input.password.length > 0 && (await checkCredentials(input.username, input.password, cfg));

  if (!ok) {
    // Simple brute-force friction.
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
    if (wantsJson(req)) {
      return NextResponse.json({ error: ERROR_MESSAGE }, { status: 401, headers: { "cache-control": "no-store" } });
    }
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("error", "1");
    if (input.next !== "/") url.searchParams.set("next", input.next);
    return NextResponse.redirect(url, 303);
  }

  const token = await createSessionToken(cfg.username, cfg.secret);
  const res = wantsJson(req)
    ? NextResponse.json({ ok: true, next: input.next }, { headers: { "cache-control": "no-store" } })
    : NextResponse.redirect(new URL(input.next, req.nextUrl.origin), 303);

  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // "Beni hatırla" → persistent 30-day cookie; otherwise a browser-session cookie.
    ...(input.remember ? { maxAge: SESSION_TTL_SECONDS } : {}),
  });
  return res;
}
