import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdStage } from "@/components/AdStage";
import { AdThumb } from "@/components/AdThumb";
import { AdScore, BrandAvatar, Chip } from "@/components/Bits";
import { ArrowLeftIcon } from "@/components/Icons";
import { ShareActions } from "@/components/ShareActions";
import { getAdById, getAllAds } from "@/lib/ads";
import { FORMAT_LABEL, MARKET_LABEL, SEGMENT_LABEL, SOURCE_LABEL, verticalLabel } from "@/lib/filters";
import { adPath, adTitle, brandFeedPath, daysLabel, displayReasons, formatDate, platformLabel, previewImage, scoreText, truncate } from "@/lib/format";
import type { Ad } from "@/lib/types";

export const dynamicParams = false;

export function generateStaticParams() {
  return getAllAds().map((a) => ({ id: a.id }));
}

type Props = { params: Promise<{ id: string }> };

function resolve(id: string): Ad | undefined {
  let decoded = id;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    /* keep raw */
  }
  return getAdById(decoded) ?? getAdById(id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ad = resolve((await params).id);
  if (!ad) return { title: "Reklam bulunamadı" };
  const title = `${ad.brand.name}: ${truncate(adTitle(ad), 60)}`;
  const reasons = ad.performance.reasons.slice(0, 3).join(" · ");
  const description = truncate(
    [ad.body ?? ad.headline, ad.source === "curated" ? "Efsane reklam — küratörlü klasik" : `Skor ${ad.performance.score}/100${reasons ? ` — ${reasons}` : ""}`].filter(Boolean).join(" — "),
    200,
  );
  const img = previewImage(ad);
  const images = img ? [{ url: img, alt: ad.brand.name }] : [{ url: "/og.png", width: 1200, height: 630, alt: "AdGym" }];
  return {
    title,
    description,
    alternates: { canonical: adPath(ad.id) },
    openGraph: { type: "article", title, description, url: adPath(ad.id), images },
    twitter: { card: "summary_large_image", title, description, images: images.map((i) => i.url) },
  };
}

export default async function AdPage({ params }: Props) {
  const ad = resolve((await params).id);
  if (!ad) notFound();

  const all = getAllAds();
  const sameBrand = all.filter((a) => a.id !== ad.id && a.brand.name === ad.brand.name);
  const similar = [
    ...sameBrand.slice(0, 3),
    ...all.filter((a) => a.id !== ad.id && a.brand.name !== ad.brand.name && a.segment === ad.segment && a.market === ad.market).slice(0, 6),
  ].slice(0, 6);
  const days = daysLabel(ad);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-4 lg:px-8 lg:pt-8">
      <Link href="/" className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/[0.05] px-3 py-1.5 text-sm font-semibold text-zinc-300 ring-1 ring-white/10 hover:text-white">
        <ArrowLeftIcon size={16} /> Akışa dön
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:gap-10">
        <div className="relative mx-auto h-[min(820px,calc(100dvh-var(--nav-h)-4.5rem))] w-full max-w-[440px] lg:h-[min(820px,calc(100dvh-7rem))] overflow-hidden rounded-[2rem] border border-line bg-black shadow-[0_30px_120px_-20px_rgba(200,255,46,0.12)]">
          <AdStage ad={ad} />
        </div>

        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <BrandAvatar name={ad.brand.name} logoUrl={ad.brand.logoUrl} size={52} />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-black tracking-tight">{ad.brand.name}</h1>
              <p className="text-sm text-mist">
                {[ad.brand.handle, SOURCE_LABEL[ad.source], days].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Chip tone="volt">{SEGMENT_LABEL[ad.segment]}</Chip>
            <Chip tone="solid">{MARKET_LABEL[ad.market]}</Chip>
            {ad.vertical && <Chip tone="solid">{verticalLabel(ad.vertical)}</Chip>}
            <Chip tone="solid">{FORMAT_LABEL[ad.format]}</Chip>
          </div>

          {ad.headline && <p className="text-xl font-bold leading-snug">{ad.headline}</p>}
          {ad.body && <p className="whitespace-pre-line text-[15px] leading-relaxed text-zinc-300">{ad.body}</p>}

          <div className="rounded-3xl border border-line bg-ink-2 p-5">
            <div className="flex items-center gap-4">
              <AdScore ad={ad} size={64} stroke={5} />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-volt">Neden kazanıyor?</p>
                <p className="mt-1 text-sm text-mist">
                  {ad.source === "curated"
                    ? "Reklam tarihine geçmiş, elle seçilmiş bir klasik. Hook'u, ritmi ve teklifi incele."
                    : "Uzun süre yayında kalmak ve çok varyasyonla ölçeklenmek, harcamanın görünmediği yerde en güçlü kazanma sinyali."}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {displayReasons(ad).map((r) => (
                <Chip key={r} tone="solid">
                  {r}
                </Chip>
              ))}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <Stat k="Başlangıç" v={formatDate(ad.startedAt)} />
              <Stat k="Bitiş" v={ad.endedAt ? formatDate(ad.endedAt) : ad.isActive ? "Hâlâ yayında" : undefined} />
              <Stat k="Gün" v={ad.activeDays !== undefined ? String(ad.activeDays) : undefined} />
              <Stat k="Varyasyon" v={ad.variations !== undefined ? String(ad.variations) : undefined} />
              <Stat k="Platform" v={ad.platforms?.map(platformLabel).join(", ")} />
              <Stat k="CTA" v={ad.cta} />
            </dl>
          </div>

          <ShareActions ad={ad} />

          <Link href={brandFeedPath(ad.brand.name)} className="block text-center text-sm font-semibold text-volt hover:underline">
            {ad.brand.name} markasının tüm reklamları →
          </Link>
        </div>
      </div>

      {similar.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-lg font-bold">Benzer reklamlar</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {similar.map((a) => (
              <Link key={a.id} href={adPath(a.id)} className="group overflow-hidden rounded-2xl border border-line bg-ink-2 transition hover:border-white/20">
                <AdThumb ad={a} className="transition group-hover:opacity-90" />
                <div className="p-2.5">
                  <p className="truncate text-xs font-bold">{a.brand.name}</p>
                  <p className="text-[11px] text-mist">{scoreText(a)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-zinc-500">{k}</dt>
      <dd className="truncate font-semibold text-zinc-100">{v}</dd>
    </div>
  );
}
