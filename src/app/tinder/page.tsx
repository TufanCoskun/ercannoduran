import type { Metadata } from "next";
import { TinderApp } from "@/components/tinder/TinderApp";
import { loadAds } from "@/lib/ads";

export const metadata: Metadata = {
  title: "Tinder",
  description: "Rastgele reklam destesi: sağa beğen, sola geç, sonra kafa kafaya turnuvayla kazananı seç.",
};

// Ad ages / scores are computed against today — refresh the static page once a day.
export const revalidate = 86400;

export default function TinderPage() {
  const { ads } = loadAds();
  return <TinderApp ads={ads} />;
}
