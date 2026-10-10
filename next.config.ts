import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ad media is rendered with plain <img>/<video> (fbcdn / tiktokcdn URLs expire),
  // but allow any remote host in case next/image is used somewhere later.
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
  // Ad JSON is read with fs at build/server time — make sure it ships with server bundles.
  outputFileTracingIncludes: {
    "/**": ["./data/ads/**/*.json", "./data/media/**/*.json"],
  },
};

export default nextConfig;
