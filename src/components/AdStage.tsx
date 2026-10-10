"use client";

import { useState } from "react";
import type { Ad } from "@/lib/types";
import { AdCard } from "./AdCard";

/** Single AdCard (used on /ad/[id]) with its own mute state. */
export function AdStage({ ad }: { ad: Ad }) {
  const [muted, setMuted] = useState(true);
  return <AdCard ad={ad} active preload="auto" muted={muted} onToggleMute={() => setMuted((m) => !m)} />;
}
