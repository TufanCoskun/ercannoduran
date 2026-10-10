import { NextResponse, type NextRequest } from "next/server";
import { getAdById } from "@/lib/ads";
import { AnalyzeError, configuredModel, geminiKey, MISSING_KEY_MESSAGE, redact, remixIdeasFor } from "@/lib/gemini";
import { capNotes, normalizeRecord, type RemixResponse } from "@/lib/analysis";
import { DEFAULT_VIEWER_LIMIT, findAccount, getAuthConfig, getRequestSession } from "@/lib/auth";
import { consumeQuota, quotaExceededMessage, quotaStore, QUOTA_STORE_MISSING_MESSAGE, readQuota, type QuotaStore } from "@/lib/quota";
import { getActiveStrategy, strategyAllowed } from "@/lib/strategy";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
/** A stored analysis is a few KB; anything far bigger is not one. */
const MAX_BODY_CHARS = 400_000;

function fail(status: number, body: Extract<RemixResponse, { ok: false }>) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * POST /api/remix { adId, analysis, notes? } → RemixResponse.
 * Regenerates ONLY the remix ideas of an existing analysis — the previous analysis JSON (it lives in the
 * user's browser), the ad metadata (looked up server-side), the user's notes (capped; one extra idea is
 * built from them) and, for admin with an active strategy, the strategy brief. No video, so it costs a
 * fraction of a full analysis.
 *  - admin + active strategy (or viewers with STRATEGY_FOR_VIEWERS=1) → strategy ideas + strategyFit
 *  - otherwise → generic ideas (e.g. a viewer refreshing ideas after adding notes)
 * Viewers: each successful call uses 1 Gemini quota.
 */
export async function POST(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: "Giriş gerekli" }, { status: 401, headers: NO_STORE });

  let quota: { store: QuotaStore; user: string; limit: number } | null = null;
  if (session.r === "viewer") {
    const store = quotaStore();
    if (!store) return fail(503, { ok: false, code: "quota_store", error: QUOTA_STORE_MISSING_MESSAGE });
    const cfg = getAuthConfig();
    const limit = (cfg && findAccount(session.u, cfg)?.limit) ?? DEFAULT_VIEWER_LIMIT;
    let q;
    try {
      q = await readQuota(store, session.u, limit);
    } catch {
      return fail(503, { ok: false, code: "quota_store", error: "Kota deposu okunamadı; biraz sonra tekrar dene." });
    }
    if (q.used >= q.limit) return fail(429, { ok: false, code: "quota", error: quotaExceededMessage(q), quota: q });
    quota = { store, user: session.u, limit };
  }

  const strategy = strategyAllowed(session) ? await getActiveStrategy() : null;
  if (!geminiKey()) return fail(503, { ok: false, code: "no_key", error: MISSING_KEY_MESSAGE });

  let b: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_CHARS) return fail(413, { ok: false, code: "bad_request", error: "İstek çok büyük." });
    const parsed: unknown = JSON.parse(text);
    b = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return fail(400, { ok: false, code: "bad_request", error: "Geçersiz istek gövdesi (JSON bekleniyor)." });
  }
  const adId = typeof b.adId === "string" ? b.adId.trim() : "";
  if (!adId || adId.length > 200) return fail(400, { ok: false, code: "bad_request", error: "adId eksik." });
  const record = normalizeRecord(b.analysis);
  if (!record || (!record.data.hook.text && !record.data.scenes.length && !record.data.structure.framework)) {
    return fail(400, { ok: false, code: "bad_request", error: "Önceki analiz eksik; önce reklamı özetle." });
  }
  const notes = capNotes(b.notes);
  if (b.mode === "strategy" && !strategy) {
    return fail(409, { ok: false, code: "no_strategy", error: "Aktif strateji yok (Strateji sayfasından yükleyip aç)." });
  }
  const ad = getAdById(adId);
  if (!ad) return fail(404, { ok: false, code: "not_found", error: "Bu reklam artık veri setinde yok." });

  try {
    const out = await remixIdeasFor(ad, record, strategy, notes);
    let used: { used: number; limit: number } | undefined;
    if (quota) {
      try {
        used = await consumeQuota(quota.store, quota.user, quota.limit, ad.id);
      } catch (e) {
        console.error(`[remix] quota write failed for ${quota.user} (${ad.id}):`, e instanceof Error ? e.message : e);
      }
    }
    const res: RemixResponse = {
      ok: true,
      remixIdeas: out.remixIdeas,
      ...(out.strategyFit ? { strategyFit: out.strategyFit } : {}),
      ...(strategy ? { strategyName: strategy.name } : {}),
      model: out.model,
      createdAt: new Date().toISOString(),
      ...(out.usage ? { usage: out.usage } : {}),
      ...(used ? { quota: used } : {}),
    };
    return NextResponse.json(res, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof AnalyzeError) {
      console.error(`[remix] ${adId} (model ${configuredModel()}) failed: ${e.code} ${e.status} — ${redact(e.message)}`);
      return fail(e.status, { ok: false, code: e.code, error: e.message });
    }
    console.error(`[remix] ${adId} unexpected error:`, e instanceof Error ? redact(e.stack ?? e.message) : e);
    return fail(500, { ok: false, code: "gemini_error", error: "Remix üretilemedi (beklenmeyen hata). Tekrar dene." });
  }
}
