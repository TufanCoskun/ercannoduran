import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { StrategyAdmin } from "@/components/StrategyAdmin";
import { getAuthConfig, SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Strateji",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Admin only. The middleware already answers 403 for viewers; this is a second check. */
export default async function StrategyPage() {
  const cfg = getAuthConfig();
  const session = cfg ? await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value, cfg) : null;
  if (session?.r !== "admin") notFound();
  return <StrategyAdmin />;
}
