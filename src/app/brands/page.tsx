import type { Metadata } from "next";
import { BrandsView } from "@/components/BrandsView";
import { getBrands, loadAds } from "@/lib/ads";

export const metadata: Metadata = {
  title: "Markalar",
  description: "AdGym'deki markalar: DTC, otel ve büyük markaların en uzun yayında kalan reklamları.",
};

export default function BrandsPage() {
  const { ads } = loadAds();
  const brands = getBrands(ads);
  return <BrandsView brands={brands} totalAds={ads.length} />;
}
