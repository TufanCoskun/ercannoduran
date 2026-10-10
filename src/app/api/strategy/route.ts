import { NextResponse, type NextRequest } from "next/server";
import { getRequestSession, type Session } from "@/lib/auth";
import { AnalyzeError, condenseStrategy, redact } from "@/lib/gemini";
import {
  estimateTokens,
  extractText,
  MAX_BRIEF_CHARS,
  MAX_SOURCE_CHARS,
  readStrategy,
  STRATEGY_STORE_MISSING_MESSAGE,
  strategyStore,
  writeStrategy,
  type BriefSource,
  type StrategyRecord,
} from "@/lib/strategy";

// Condensing a ~60K-char document with Gemini (thinking low) takes ~15–40 s.
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}
const fail = (status: number, error: string) => json({ ok: false, error }, status);

/** Admin only (the middleware already returns 403 for viewers; this is the second check). */
async function admin(req: NextRequest): Promise<Session | NextResponse> {
  const session = await getRequestSession(req);
  if (!session) return fail(401, "Giriş gerekli");
  if (session.r !== "admin") return fail(403, "Bu sayfa sadece yönetici içindir.");
  if (!strategyStore()) return fail(503, STRATEGY_STORE_MISSING_MESSAGE);
  return session;
}

/** What the admin page shows (the brief included — admin only). */
function view(rec: StrategyRecord | null) {
  return { ok: true, strategy: rec, briefTokens: rec ? estimateTokens(rec.brief) : 0 };
}

/** GET /api/strategy → { ok, strategy: StrategyRecord | null, briefTokens } */
export async function GET(req: NextRequest) {
  const s = await admin(req);
  if (s instanceof NextResponse) return s;
  try {
    return json(view(await readStrategy({ fresh: true })));
  } catch (e) {
    console.error("[strategy] read failed:", e instanceof Error ? e.message : e);
    return fail(503, "Strateji deposu okunamadı; biraz sonra tekrar dene.");
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * POST /api/strategy — upload / replace the strategy.
 *   multipart/form-data: name, file (.html/.htm/.md/.txt) or text, optional brief (skips Gemini), optional active=0
 *   application/json:    { name, text, brief?, active? }
 * The text is extracted server-side (scripts/styles/tags stripped); without a `brief`, Gemini condenses it.
 */
export async function POST(req: NextRequest) {
  const s = await admin(req);
  if (s instanceof NextResponse) return s;

  let name = "";
  let raw = "";
  let filename = "";
  let manualBrief = "";
  let active = true;
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("multipart/form-data")) {
      const fd = await req.formData();
      name = str(fd.get("name"));
      manualBrief = str(fd.get("brief"));
      active = str(fd.get("active")) !== "0";
      const file = fd.get("file");
      if (file && typeof file === "object" && "text" in file && file.size > 0) {
        if (file.size > MAX_UPLOAD_BYTES) return fail(413, "Dosya çok büyük (en fazla 3 MB).");
        filename = file.name ?? "";
        if (!/\.(html?|md|markdown|txt)$/i.test(filename)) return fail(400, "Sadece .html, .md veya .txt dosyası yükleyebilirsin.");
        raw = await file.text();
      } else {
        raw = str(fd.get("text"));
      }
    } else {
      const b = (await req.json()) as Record<string, unknown>;
      name = str(b.name);
      raw = str(b.text);
      manualBrief = str(b.brief);
      active = b.active !== false;
    }
  } catch {
    return fail(400, "Geçersiz istek gövdesi.");
  }

  name = name.trim().slice(0, 120);
  if (!name) return fail(400, "Strateji adı gerekli.");
  const text = extractText(raw, filename).slice(0, MAX_SOURCE_CHARS);
  manualBrief = manualBrief.trim();
  if (text.length < 200 && !manualBrief) return fail(400, "Strateji metni çok kısa ya da boş (dosya ya da metin gerekli).");
  if (manualBrief.length > MAX_BRIEF_CHARS) return fail(400, `Brief çok uzun (en fazla ${MAX_BRIEF_CHARS.toLocaleString("tr-TR")} karakter).`);

  let brief = manualBrief;
  let briefSource: BriefSource = "manual";
  let model: string | undefined;
  if (!brief) {
    try {
      const out = await condenseStrategy(name, text);
      brief = out.brief.slice(0, MAX_BRIEF_CHARS);
      model = out.model;
      briefSource = out.model === "mock" ? "mock" : "gemini";
    } catch (e) {
      if (e instanceof AnalyzeError) return fail(e.status, e.message);
      console.error("[strategy] condense failed:", e instanceof Error ? redact(e.stack ?? e.message) : e);
      return fail(500, "Strateji özeti oluşturulamadı; tekrar dene ya da brief'i elle yapıştır.");
    }
  }

  const rec: StrategyRecord = {
    name,
    updatedAt: new Date().toISOString(),
    brief,
    fullTextChars: text.length,
    active,
    briefSource,
    ...(model ? { model } : {}),
  };
  try {
    await writeStrategy(rec, text);
  } catch (e) {
    console.error("[strategy] write failed:", e instanceof Error ? e.message : e);
    return fail(503, "Strateji kaydedilemedi; biraz sonra tekrar dene.");
  }
  console.error(`[strategy] uploaded "${name}" (${text.length} chars source, ${brief.length} chars brief, ${briefSource})`);
  return json(view(rec));
}

/**
 * PATCH /api/strategy { brief?, name?, active? } — manual brief edit and the on/off toggle.
 * Creates the record when none exists yet (name + brief required), e.g. to paste a hand-written brief.
 */
export async function PATCH(req: NextRequest) {
  const s = await admin(req);
  if (s instanceof NextResponse) return s;
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "Geçersiz istek gövdesi (JSON bekleniyor).");
  }
  let current: StrategyRecord | null;
  try {
    current = await readStrategy({ fresh: true });
  } catch {
    return fail(503, "Strateji deposu okunamadı; biraz sonra tekrar dene.");
  }

  const brief = typeof b.brief === "string" ? b.brief.trim() : undefined;
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 120) : undefined;
  const active = typeof b.active === "boolean" ? b.active : undefined;
  if (brief !== undefined && !brief) return fail(400, "Brief boş olamaz.");
  if (brief && brief.length > MAX_BRIEF_CHARS) return fail(400, `Brief çok uzun (en fazla ${MAX_BRIEF_CHARS.toLocaleString("tr-TR")} karakter).`);
  if (name !== undefined && !name) return fail(400, "Strateji adı boş olamaz.");
  if (!current && (!brief || !name)) return fail(404, "Henüz strateji yok: önce dosya yükle ya da ad + brief gir.");

  const next: StrategyRecord = {
    ...(current ?? { fullTextChars: 0, active: true, briefSource: "manual" as const, brief: "", name: "", updatedAt: "" }),
    ...(name !== undefined ? { name } : {}),
    ...(active !== undefined ? { active } : {}),
    ...(brief !== undefined && brief !== current?.brief ? { brief, briefSource: "manual" as const } : {}),
    updatedAt: new Date().toISOString(),
  };
  if (next.briefSource === "manual") delete next.model;
  try {
    await writeStrategy(next);
  } catch (e) {
    console.error("[strategy] write failed:", e instanceof Error ? e.message : e);
    return fail(503, "Strateji kaydedilemedi; biraz sonra tekrar dene.");
  }
  return json(view(next));
}
