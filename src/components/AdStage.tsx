"use client";

import { useState } from "react";
import type { Ad } from "@/lib/types";
import { AdCard } from "./AdCard";
import { AdInfoSheet } from "./AdInfoSheet";

/** Single AdCard (used on /ad/[id]) with its own mute, info-sheet and clean-mode state. */
export function AdStage({ ad }: { ad: Ad }) {
  const [muted, setMuted] = useState(true);
  const [info, setInfo] = useState(false);
  const [clean, setClean] = useState(false);
  return (
    <>
      <AdCard
        ad={ad}
        active
        preload="auto"
        muted={muted}
        onToggleMute={() => setMuted((m) => !m)}
        onInfo={() => setInfo(true)}
        clean={clean}
        onLongPress={() => setClean((c) => !c)}
      />
      <AdInfoSheet ad={info ? ad : null} onClose={() => setInfo(false)} />
    </>
  );
}
