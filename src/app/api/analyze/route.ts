import { after, NextResponse, type NextRequest } from "next/server";
import { getAdById } from "@/lib/ads";
import { analyzeAd, AnalyzeError, configuredModel, geminiKey, MISSING_KEY_MESSAGE, redact } from "@/lib/gemini";
import { capNotes, type AnalyzeResponse } from "@/lib/analysis";
import { canAnalyze, DEFAULT_VIEWER_LIMIT, findAccount, getAuthConfig, getRequestSession } from "@/lib/auth";
import { consumeQuota, quotaExceededMessage, quotaStore, QUOTA_STORE_MISSING_MESSAGE, readQuota, type QuotaStore } from "@/lib/quota";
import { getActiveStrategy, strategyAllowed } from "@/lib/strategy";

// Gemini watches the whole video: download + upload + generation can take 20–60 s.
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function fail(status: number, body: Extract<AnalyzeResponse, { ok: false }>) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * POST /api/analyze { adId, force?, allowPoster? } → AnalyzeResponse.
 * The ad (and therefore every media URL we fetch) is looked up server-side by id, so clients
 * can't make us fetch arbitrary URLs. Auth: src/middleware.ts gates all /api/*. Admin is unlimited;
 * viewers have a persistent per-user quota (src/lib/quota.ts), charged only for successful, non-cached runs.
 * Admin with an active brand strategy (src/lib/strategy.ts) gets strategy remix ideas + strategyFit.
 */
export async function POST(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: "Giriş gerekli" }, { status: 401, headers: NO_STORE });
  if (!canAnalyze(session)) return fail(403, { ok: false, code: "forbidden", error: "Bu hesapta Gemini özetleme yetkisi yok." });

  // Viewer quota: checked before any paid work; fail closed if the quota store isn't configured.
  let quota: { store: QuotaStore; user: string; limit: number } | null = null;
  if (session.r === "viewer") {
    const store = quotaStore();
    if (!store) return fail(503, { ok: false, code: "quota_store", error: QUOTA_STORE_MISSING_MESSAGE });
    const cfg = getAuthConfig();
    const limit = (cfg && findAccount(session.u, cfg)?.limit) ?? DEFAULT_VIEWER_LIMIT;
    let q;
    try {
      q = await readQuota(store, session.u, limit);
    } catch (e) {
      console.error(`[analyze] quota read failed for ${session.u}:`, e instanceof Error ? e.message : e);
      return fail(503, { ok: false, code: "quota_store", error: "Kota deposu okunamadı; biraz sonra tekrar dene." });
    }
    if (q.used >= q.limit) return fail(429, { ok: false, code: "quota", error: quotaExceededMessage(q), quota: q });
    quota = { store, user: session.u, limit };
  }

  if (!geminiKey()) return fail(503, { ok: false, code: "no_key", error: MISSING_KEY_MESSAGE });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, { ok: false, code: "bad_request", error: "Geçersiz istek gövdesi (JSON bekleniyor)." });
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const adId = typeof b.adId === "string" ? b.adId.trim() : "";
  if (!adId || adId.length > 200) return fail(400, { ok: false, code: "bad_request", error: "adId eksik." });

  const ad = getAdById(adId);
  if (!ad) {
    return fail(404, { ok: false, code: "not_found", error: "Bu reklam artık veri setinde yok; özetlenemiyor." });
  }

  const strategy = strategyAllowed(session) ? await getActiveStrategy() : null;

  try {
    const { record, cached } = await analyzeAd(ad, {
      strategy,
      notes: capNotes(b.notes),
      force: b.force === true,
      allowPoster: b.allowPoster === true,
      origin: req.nextUrl.origin,
      defer: (fn) => after(fn),
    });
    let used: { used: number; limit: number } | undefined;
    if (quota) {
      try {
        used = cached ? await readQuota(quota.store, quota.user, quota.limit) : await consumeQuota(quota.store, quota.user, quota.limit, ad.id);
      } catch (e) {
        // The (paid) analysis already succeeded; return it, but make the failure visible in logs.
        console.error(`[analyze] quota write failed for ${quota.user} (${ad.id}):`, e instanceof Error ? e.message : e);
      }
    }
    const res: AnalyzeResponse = { ok: true, analysis: record, cached, ...(used ? { quota: used } : {}) };
    return NextResponse.json(res, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof AnalyzeError) {
      console.error(`[analyze] ${adId} (model ${configuredModel()}) failed: ${e.code} ${e.status} — ${redact(e.message)}`);
      return fail(e.status, { ok: false, code: e.code, error: e.message, ...(e.canUsePoster ? { canUsePoster: true } : {}) });
    }
    console.error(`[analyze] ${adId} (model ${configuredModel()}) unexpected error:`, e instanceof Error ? redact(e.stack ?? e.message) : e);
    return fail(500, { ok: false, code: "gemini_error", error: "Özet oluşturulamadı (beklenmeyen hata). Tekrar dene." });
  }
}
