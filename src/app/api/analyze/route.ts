import { after, NextResponse, type NextRequest } from "next/server";
import { getAdById } from "@/lib/ads";
import { analyzeAd, AnalyzeError, configuredModel, geminiKey, MISSING_KEY_MESSAGE, redact } from "@/lib/gemini";
import type { AnalyzeResponse } from "@/lib/analysis";
import { canAnalyze, FORBIDDEN_ANALYZE_MESSAGE, getRequestSession } from "@/lib/auth";

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
 * can't make us fetch arbitrary URLs. Auth: src/middleware.ts gates all /api/*; the admin-only role check is below.
 */
export async function POST(req: NextRequest) {
  // Role check (middleware also blocks viewers): only the admin account may run paid Gemini calls.
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: "Giriş gerekli" }, { status: 401, headers: NO_STORE });
  if (!canAnalyze(session)) return fail(403, { ok: false, code: "forbidden", error: FORBIDDEN_ANALYZE_MESSAGE });

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

  try {
    const { record, cached } = await analyzeAd(ad, {
      force: b.force === true,
      allowPoster: b.allowPoster === true,
      origin: req.nextUrl.origin,
      defer: (fn) => after(fn),
    });
    const res: AnalyzeResponse = { ok: true, analysis: record, cached };
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
