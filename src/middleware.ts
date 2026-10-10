import { NextResponse, type NextRequest } from "next/server";
import { getAuthConfig, isApiPath, MISCONFIGURED_MESSAGE, safeNextPath, SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

/** Static assets that are always public (posters/media can be public). */
function isPublicAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/manifest") ||
    pathname === "/og.png" ||
    pathname === "/robots.txt" ||
    pathname.startsWith("/media/") ||
    pathname.startsWith("/docs/")
  );
}

function isAuthRoute(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/") || pathname.startsWith("/api/auth/");
}

const MISCONFIGURED_HTML = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>AdGym · Yapılandırma eksik</title>
<style>
  html,body{margin:0;height:100%;background:#060608;color:#f4f4f5;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
  main{min-height:100%;display:grid;place-items:center;padding:24px;box-sizing:border-box;text-align:center}
  .code{font-size:56px;font-weight:900;color:#ff7a1a;margin:0}
  h1{font-size:20px;margin:12px 0 6px}
  p{color:#a1a1aa;font-size:14px;line-height:1.6;max-width:420px;margin:0 auto}
  code{font-family:ui-monospace,monospace;color:#c8ff2e}
</style></head>
<body><main><div>
  <p class="code">503</p>
  <h1>${MISCONFIGURED_MESSAGE}</h1>
  <p>Site kilitli. Sunucuda <code>ADMIN_USERNAME</code>, <code>ADMIN_PASSWORD</code> ve <code>AUTH_SECRET</code> (en az 16 karakter) ortam değişkenlerini tanımlayıp yeniden deploy et.</p>
</div></main></body></html>`;

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublicAsset(pathname)) return NextResponse.next();

  const cfg = getAuthConfig();
  if (!cfg) {
    // Fail closed: never serve the app without credentials configured.
    if (isApiPath(pathname)) {
      return NextResponse.json({ error: MISCONFIGURED_MESSAGE }, { status: 503, headers: { "cache-control": "no-store" } });
    }
    return new NextResponse(MISCONFIGURED_HTML, {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const authed = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value, cfg);

  if (isAuthRoute(pathname)) {
    // Already signed in: skip the login form.
    if (authed && pathname === "/login") {
      const next = safeNextPath(req.nextUrl.searchParams.get("next"));
      return NextResponse.redirect(new URL(next, req.nextUrl.origin));
    }
    return NextResponse.next();
  }

  if (authed) return NextResponse.next();

  if (isApiPath(pathname)) {
    return NextResponse.json({ error: "Giriş gerekli" }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const next = `${pathname}${search}`;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals and public static files up front; everything else goes through the gate.
  matcher: ["/((?!_next/static|_next/image|favicon|icon|manifest|og\\.png|robots\\.txt|media/|docs/).*)"],
};
