import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_VIEWER_LIMIT, findAccount, getAuthConfig, getRequestSession } from "@/lib/auth";
import { quotaStore, readQuota, type QuotaSummary } from "@/lib/quota";
import { readStrategy, strategyAllowed } from "@/lib/strategy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

async function safeRead(user: string, limit: number): Promise<QuotaSummary | null> {
  const store = quotaStore();
  if (!store) return null;
  try {
    return await readQuota(store, user, limit);
  } catch {
    return null;
  }
}

/** Name + toggle of the stored strategy (never the brief), for accounts that get strategy remix ideas. */
async function strategyInfo(): Promise<{ name: string; active: boolean } | null> {
  try {
    const rec = await readStrategy();
    return rec ? { name: rec.name, active: rec.active } : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/auth/me — display info for the signed-in account (401 otherwise).
 *  - viewer: { u, r: "viewer", quota: { used, limit } | null }
 *  - admin:  { u, r: "admin", viewers: [{ u, used, limit }], strategy: { name, active } | null }   (used is null if the store is unavailable)
 */
export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  const cfg = getAuthConfig();
  if (!session || !cfg) return NextResponse.json({ error: "Giriş gerekli" }, { status: 401, headers: NO_STORE });

  if (session.r === "viewer") {
    const limit = findAccount(session.u, cfg)?.limit ?? DEFAULT_VIEWER_LIMIT;
    const strategy = strategyAllowed(session) ? await strategyInfo() : undefined;
    return NextResponse.json({ u: session.u, r: session.r, quota: await safeRead(session.u, limit), ...(strategy !== undefined ? { strategy } : {}) }, { headers: NO_STORE });
  }

  const viewers = await Promise.all(
    cfg.accounts
      .filter((a) => a.role === "viewer")
      .map(async (a) => {
        const limit = a.limit ?? DEFAULT_VIEWER_LIMIT;
        const q = await safeRead(a.username, limit);
        return { u: a.username, used: q ? q.used : null, limit };
      }),
  );
  return NextResponse.json({ u: session.u, r: session.r, viewers, strategy: await strategyInfo() }, { headers: NO_STORE });
}
