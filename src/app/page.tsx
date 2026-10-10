import { Suspense } from "react";
import { Feed } from "@/components/Feed";
import { loadAds } from "@/lib/ads";

// Ad ages / scores are computed against today — refresh the static page once a day.
export const revalidate = 86400;

export default function HomePage() {
  const { ads, usingFixtures } = loadAds();
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <Feed ads={ads} usingFixtures={usingFixtures} />
    </Suspense>
  );
}

function FeedSkeleton() {
  return (
    <div className="flex justify-center lg:px-6 lg:py-6">
      <div className="h-feed w-full animate-pulse bg-ink-2 lg:aspect-[9/16] lg:w-auto lg:rounded-[2rem]" />
    </div>
  );
}
