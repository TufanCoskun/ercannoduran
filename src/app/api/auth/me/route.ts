import { NextResponse, type NextRequest } from "next/server";
import { getRequestSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/auth/me → { u, r } for the signed-in account (401 otherwise). Display use only. */
export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: "Giriş gerekli" }, { status: 401, headers: { "cache-control": "no-store" } });
  return NextResponse.json({ u: session.u, r: session.r }, { headers: { "cache-control": "no-store" } });
}
