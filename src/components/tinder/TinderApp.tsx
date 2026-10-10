"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Ad } from "@/lib/types";
import { useHydrated } from "@/lib/store";
import {
  abandonActive,
  activeSession,
  createSession,
  filterPool,
  passMissing,
  recentSeenIds,
  sampleDeck,
  saveSession,
  stageOf,
  startSession,
  useTinder,
  type TinderFilters,
  type TinderSession,
} from "@/lib/tinder";
import { Bracket } from "./Bracket";
import { Round1Summary } from "./Round1Summary";
import { SwipeDeck } from "./SwipeDeck";
import { TinderSetup } from "./TinderSetup";
import { WinnerView } from "./WinnerView";

/**
 * /tinder: setup → Round 1 (swipe) → summary → bracket (Round 2+) → winner.
 * The session lives in localStorage; a reload lands on the setup screen with "Devam et / Yeni başla".
 */
export function TinderApp({ ads }: { ads: Ad[] }) {
  const hydrated = useHydrated();
  const state = useTinder();
  const live = useMemo(() => new Map(ads.map((a) => [a.id, a])), [ads]);
  const session = hydrated ? activeSession(state) : null;
  const [playing, setPlaying] = useState(false);
  const seen = useMemo(() => recentSeenIds(state), [state]);

  // Resumed decks: ads that disappeared from the dataset are passed silently.
  useEffect(() => {
    if (!session) return;
    const fixed = passMissing(session, (id) => live.has(id) || Boolean(session.ads[id]));
    if (fixed !== session) saveSession(fixed);
  }, [session, live]);

  const onChange = useCallback((s: TinderSession) => saveSession(s), []);
  const onExit = useCallback(() => {
    setPlaying(false);
    window.scrollTo({ top: 0 });
  }, []);
  const onNew = useCallback(() => {
    abandonActive();
    setPlaying(false);
    window.scrollTo({ top: 0 });
  }, []);

  const start = (filters: TinderFilters, count: number, preferUnseen: boolean) => {
    const deck = sampleDeck(filterPool(ads, filters), count, preferUnseen ? seen : undefined);
    if (deck.length < 2) return;
    startSession(createSession(deck, filters, count));
    setPlaying(true);
  };

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-6 lg:px-8 lg:pt-10">
        <div className="h-12 w-48 animate-pulse rounded-2xl bg-white/5" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/5" />
          ))}
        </div>
      </div>
    );
  }

  const stage = session ? stageOf(session) : null;
  // Finished sessions show the winner until "Yeni Tinder"; in-progress ones need an explicit "Devam et".
  const show = session && (playing || stage === "done") ? stage : null;

  if (session && show === "swipe") return <SwipeDeck session={session} live={live} onChange={onChange} onExit={onExit} />;
  if (session && show === "summary") return <Round1Summary session={session} live={live} onChange={onChange} onNew={onNew} />;
  if (session && show === "bracket") return <Bracket session={session} live={live} onChange={onChange} onExit={onExit} />;
  if (session && show === "done") return <WinnerView session={session} live={live} onChange={onChange} onNew={onNew} />;

  const last = state.sessions[0];
  return (
    <TinderSetup
      ads={ads}
      initialFilters={last?.filters}
      initialCount={last?.count}
      resume={session}
      seenCount={seen.size}
      seenIds={seen}
      onStart={start}
      onResume={() => setPlaying(true)}
      onDiscard={abandonActive}
    />
  );
}
