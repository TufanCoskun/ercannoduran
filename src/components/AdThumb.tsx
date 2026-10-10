"use client";

import { useState } from "react";
import type { Ad } from "@/lib/types";
import { previewImage } from "@/lib/format";
import { effectiveFormat } from "@/lib/filters";
import { TextCard } from "./TextCard";

/** Small 4:5 preview of an ad; falls back to a compact text card when the image is missing/expired. */
export function AdThumb({ ad, className = "" }: { ad: Ad; className?: string }) {
  const src = previewImage(ad);
  const [failed, setFailed] = useState(false);
  return (
    <div className={`relative aspect-[4/5] overflow-hidden bg-ink-3 ${className}`}>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <TextCard ad={ad} reason={src ? "expired" : "missing"} compact />
      )}
      {effectiveFormat(ad) === "video" && src && !failed && (
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur">▶ Video</span>
      )}
    </div>
  );
}
