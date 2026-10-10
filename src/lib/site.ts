export const SITE_NAME = "AdGym";
export const SITE_TAGLINE = "Reklam kasını her gün çalıştır";
export const SITE_DESCRIPTION =
  "Meta Ad Library ve TikTok'tan en uzun yayında kalan, en çok ölçeklenen reklamları TikTok gibi kaydır. DTC, otel, Türkiye ve ABD.";

export function siteUrl(): URL {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "http://localhost:3000";
  try {
    return new URL(raw);
  } catch {
    return new URL("http://localhost:3000");
  }
}
