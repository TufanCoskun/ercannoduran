import type { Ad, Format, Market, Segment } from "./types";
import { createStore } from "./store";
import { MARKET_LABEL, SEGMENT_LABEL, matchesFilters, verticalLabel, type Filters } from "./filters";

/**
 * "Tinder" tournament mode: a random deck of N ads → swipe (Round 1) → head-to-head bracket
 * (Round 2+) → one winner. Pure state transitions + a localStorage-backed store of sessions.
 */

/* ───────────────────────── randomness ───────────────────────── */

/** Uniform integer in [0, n) — crypto.getRandomValues with rejection sampling (no modulo bias). */
export function randomIndex(n: number): number {
  if (n <= 1) return 0;
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.getRandomValues === "function") {
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    const buf = new Uint32Array(1);
    for (;;) {
      c.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % n;
    }
  }
  return Math.floor(Math.random() * n);
}

/** Fisher–Yates shuffle (new array) driven by crypto randomness. */
export function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ───────────────────────── filters ───────────────────────── */

export interface TinderFilters {
  market: Market[];
  segment: Segment[];
  vertical: string[];
  format: Format[];
  videoOnly: boolean;
}

export const EMPTY_TINDER_FILTERS: TinderFilters = { market: [], segment: [], vertical: [], format: [], videoOnly: false };
export const COUNT_PRESETS = [10, 20, 50, 100] as const;
export const DEFAULT_COUNT = 20;

export function toFilters(f: TinderFilters): Filters {
  return { segment: f.segment, market: f.market, source: [], format: f.videoOnly ? ["video"] : f.format, vertical: f.vertical, brand: [] };
}

export function filterPool(ads: readonly Ad[], f: TinderFilters): Ad[] {
  const filters = toFilters(f);
  return ads.filter((a) => matchesFilters(a, filters));
}

/** Short human label: "US DTC · Video", "TR Otel · Resort", "Tüm reklamlar". */
export function filtersLabel(f: TinderFilters): string {
  const head = [f.market.map((m) => MARKET_LABEL[m]).join("/"), f.segment.map((s) => SEGMENT_LABEL[s]).join("/")].filter(Boolean).join(" ");
  const parts = [head, f.vertical.slice(0, 2).map(verticalLabel).join(", ") + (f.vertical.length > 2 ? ` +${f.vertical.length - 2}` : "")];
  if (f.videoOnly) parts.push("Video");
  else if (f.format.length) parts.push(f.format.map((x) => ({ video: "Video", image: "Görsel", carousel: "Carousel", text: "Metin" })[x]).join("/"));
  const out = parts.filter(Boolean).join(" · ");
  return out || "Tüm reklamlar";
}

/* ───────────────────────── session model ───────────────────────── */

export type SwipeDir = "like" | "pass";

export interface BracketRound {
  round: number; // 2, 3, …
  entrants: string[];
  pairs: [string, string][];
  bye: string | null; // odd count: this ad skips the round ("tur atladı")
  winners: string[]; // picks so far, in pair order
}

export interface TinderSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  filters: TinderFilters;
  count: number;
  pool: string[]; // the deck, in play order
  round1: { liked: string[]; passed: string[] };
  rounds: BracketRound[];
  winner: string | null;
  /** Full snapshots of liked / winner ads, so history survives data refreshes. */
  ads: Record<string, Ad>;
  savedCollectionId?: string;
}

export type Stage = "swipe" | "summary" | "bracket" | "done";

export function stageOf(s: TinderSession): Stage {
  if (s.winner) return "done";
  if (s.rounds.length) return "bracket";
  const decided = s.round1.liked.length + s.round1.passed.length;
  return decided >= s.pool.length ? "summary" : "swipe";
}

const uid = () => {
  const a = new Uint32Array(2);
  try {
    crypto.getRandomValues(a);
  } catch {
    a[0] = Math.random() * 2 ** 32;
    a[1] = Date.now();
  }
  return a[0].toString(36) + a[1].toString(36);
};

/**
 * Samples `count` random ads from the pool. With `avoid` (ids from recent sessions), unseen ads are
 * drawn first and seen ones only fill the remainder — the deck never shrinks because of it.
 */
export function sampleDeck(pool: readonly Ad[], count: number, avoid?: ReadonlySet<string>): Ad[] {
  const n = Math.max(0, Math.min(count, pool.length));
  if (!avoid?.size) return shuffle(pool).slice(0, n);
  const fresh = shuffle(pool.filter((a) => !avoid.has(a.id)));
  const seen = shuffle(pool.filter((a) => avoid.has(a.id)));
  // Interleave the order again so "seen" fillers don't all cluster at the end of the deck.
  return shuffle([...fresh, ...seen].slice(0, n));
}

export function createSession(deck: readonly Ad[], filters: TinderFilters, count: number): TinderSession {
  const now = new Date().toISOString();
  return {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    filters,
    count,
    pool: deck.map((a) => a.id),
    round1: { liked: [], passed: [] },
    rounds: [],
    winner: null,
    ads: {},
  };
}

const touch = (s: TinderSession): TinderSession => ({ ...s, updatedAt: new Date().toISOString() });

export function decidedSet(s: TinderSession): Set<string> {
  return new Set([...s.round1.liked, ...s.round1.passed]);
}

/** Undecided ids in deck order. */
export function remainingIds(s: TinderSession): string[] {
  const d = decidedSet(s);
  return s.pool.filter((id) => !d.has(id));
}

/** Records a swipe; liked ads keep a full snapshot (`ad`). */
export function decide(s: TinderSession, id: string, dir: SwipeDir, ad?: Ad): TinderSession {
  if (decidedSet(s).has(id) || !s.pool.includes(id)) return s;
  const round1 = dir === "like" ? { ...s.round1, liked: [...s.round1.liked, id] } : { ...s.round1, passed: [...s.round1.passed, id] };
  const ads = dir === "like" && ad ? { ...s.ads, [id]: ad } : s.ads;
  return touch({ ...s, round1, ads });
}

/** Ads that vanished from the dataset (and have no snapshot) can't be shown — pass them silently. */
export function passMissing(s: TinderSession, has: (id: string) => boolean): TinderSession {
  const missing = remainingIds(s).filter((id) => !has(id));
  if (!missing.length) return s;
  return touch({ ...s, round1: { ...s.round1, passed: [...s.round1.passed, ...missing] } });
}

/** The most recent swipe = the decided id that sits latest in the deck. */
export function lastSwipe(s: TinderSession): { id: string; dir: SwipeDir } | null {
  const d = decidedSet(s);
  for (let i = s.pool.length - 1; i >= 0; i--) {
    const id = s.pool[i];
    if (d.has(id)) return { id, dir: s.round1.liked.includes(id) ? "like" : "pass" };
  }
  return null;
}

export function undoSwipe(s: TinderSession): TinderSession {
  if (s.rounds.length || s.winner) return s;
  const last = lastSwipe(s);
  if (!last) return s;
  const ads = { ...s.ads };
  if (last.dir === "like") delete ads[last.id];
  return touch({
    ...s,
    ads,
    round1: { liked: s.round1.liked.filter((x) => x !== last.id), passed: s.round1.passed.filter((x) => x !== last.id) },
  });
}

function priorByes(rounds: readonly BracketRound[]): Set<string> {
  return new Set(rounds.map((r) => r.bye).filter((x): x is string => Boolean(x)));
}

function makeRound(round: number, ids: readonly string[], previous: readonly BracketRound[]): BracketRound {
  const entrants = shuffle(ids);
  let bye: string | null = null;
  let rest = entrants;
  if (entrants.length % 2 === 1) {
    // Prefer giving the bye to someone who hasn't had one yet.
    const had = priorByes(previous);
    const idx = entrants.findIndex((id) => !had.has(id));
    const at = idx === -1 ? entrants.length - 1 : idx;
    bye = entrants[at];
    rest = entrants.filter((_, i) => i !== at);
  }
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < rest.length; i += 2) pairs.push([rest[i], rest[i + 1]]);
  return { round, entrants, pairs, bye, winners: [] };
}

export function roundComplete(r: BracketRound): boolean {
  return r.winners.length >= r.pairs.length;
}

/** Everyone who advances from a round: picked winners + the bye. */
export function roundAdvancers(r: BracketRound): string[] {
  return r.bye ? [...r.winners, r.bye] : [...r.winners];
}

/** Round 1 → bracket. One like = instant winner. */
export function startBracket(s: TinderSession): TinderSession {
  if (s.rounds.length || s.winner) return s;
  const liked = s.round1.liked;
  if (liked.length === 0) return s;
  if (liked.length === 1) return touch({ ...s, winner: liked[0], finishedAt: new Date().toISOString() });
  return touch({ ...s, rounds: [makeRound(2, liked, [])] });
}

export function currentRound(s: TinderSession): BracketRound | null {
  return s.rounds.length && !s.winner ? s.rounds[s.rounds.length - 1] : null;
}

export interface Match {
  round: number;
  index: number; // 0-based
  total: number;
  pair: [string, string];
  bye: string | null;
  entrants: number;
  isFinal: boolean;
}

export function currentMatch(s: TinderSession): Match | null {
  const r = currentRound(s);
  if (!r || roundComplete(r)) return null;
  const i = r.winners.length;
  return { round: r.round, index: i, total: r.pairs.length, pair: r.pairs[i], bye: r.bye, entrants: r.entrants.length, isFinal: r.entrants.length === 2 };
}

export function pick(s: TinderSession, winnerId: string): TinderSession {
  const r = currentRound(s);
  const m = currentMatch(s);
  if (!r || !m || !m.pair.includes(winnerId)) return s;
  const updated: BracketRound = { ...r, winners: [...r.winners, winnerId] };
  const rounds = [...s.rounds.slice(0, -1), updated];
  if (!roundComplete(updated)) return touch({ ...s, rounds });
  const next = roundAdvancers(updated);
  if (next.length <= 1) return touch({ ...s, rounds, winner: next[0] ?? winnerId, finishedAt: new Date().toISOString() });
  return touch({ ...s, rounds: [...rounds, makeRound(updated.round + 1, next, rounds)] });
}

export function canUndoPick(s: TinderSession): boolean {
  return s.rounds.some((r) => r.winners.length > 0) || (Boolean(s.winner) && !s.rounds.length);
}

/** Undo the last head-to-head pick (crossing round boundaries; also un-crowns the winner). */
export function undoPick(s: TinderSession): TinderSession {
  if (!s.rounds.length) {
    // Single-like session crowned straight from Round 1.
    return s.winner ? touch({ ...s, winner: null, finishedAt: undefined }) : s;
  }
  const rounds = [...s.rounds];
  let last = rounds[rounds.length - 1];
  if (!s.winner && last.winners.length === 0) {
    if (rounds.length === 1) return s;
    rounds.pop(); // the freshly generated next round
    last = rounds[rounds.length - 1];
  }
  if (!last.winners.length) return s;
  rounds[rounds.length - 1] = { ...last, winners: last.winners.slice(0, -1) };
  return touch({ ...s, rounds, winner: null, finishedAt: undefined });
}

/** The ads a winner beat, per round (for the winner screen / history). */
export function beatenBy(s: TinderSession, id: string): { round: number; opponent: string }[] {
  const out: { round: number; opponent: string }[] = [];
  for (const r of s.rounds) {
    r.pairs.forEach((p, i) => {
      if (r.winners[i] === id) out.push({ round: r.round, opponent: p[0] === id ? p[1] : p[0] });
    });
  }
  return out;
}

/** Round count shown in history: 1 + bracket rounds. */
export function totalRounds(s: TinderSession): number {
  return 1 + s.rounds.length;
}

/* ───────────────────────── store ───────────────────────── */

export interface TinderState {
  version: 1;
  sessions: TinderSession[]; // newest first
  activeId: string | null;
}

const INITIAL: TinderState = { version: 1, sessions: [], activeId: null };
const MAX_SESSIONS = 40;
const MAX_BYTES = 2_500_000;

const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function migrateSession(raw: unknown): TinderSession | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<TinderSession>;
  if (typeof r.id !== "string" || !isStrArr(r.pool) || !r.round1 || !isStrArr(r.round1.liked) || !isStrArr(r.round1.passed)) return null;
  const f = (r.filters ?? {}) as Partial<TinderFilters>;
  const rounds = Array.isArray(r.rounds)
    ? r.rounds.filter(
        (x): x is BracketRound =>
          Boolean(x) && typeof x.round === "number" && isStrArr(x.entrants) && isStrArr(x.winners) && Array.isArray(x.pairs) && x.pairs.every((p) => isStrArr(p) && p.length === 2),
      )
    : [];
  const ads: Record<string, Ad> = {};
  if (r.ads && typeof r.ads === "object") {
    for (const [k, v] of Object.entries(r.ads)) if (v && typeof v === "object" && typeof (v as Ad).id === "string" && (v as Ad).brand) ads[k] = v as Ad;
  }
  return {
    id: r.id,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(0).toISOString(),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : new Date(0).toISOString(),
    finishedAt: typeof r.finishedAt === "string" ? r.finishedAt : undefined,
    filters: {
      market: isStrArr(f.market) ? (f.market as Market[]) : [],
      segment: isStrArr(f.segment) ? (f.segment as Segment[]) : [],
      vertical: isStrArr(f.vertical) ? f.vertical : [],
      format: isStrArr(f.format) ? (f.format as Format[]) : [],
      videoOnly: Boolean(f.videoOnly),
    },
    count: typeof r.count === "number" ? r.count : r.pool.length,
    pool: r.pool,
    round1: { liked: r.round1.liked, passed: r.round1.passed },
    rounds: rounds.map((x) => ({ ...x, bye: typeof x.bye === "string" ? x.bye : null })),
    winner: typeof r.winner === "string" ? r.winner : null,
    ads,
    savedCollectionId: typeof r.savedCollectionId === "string" ? r.savedCollectionId : undefined,
  };
}

function migrate(raw: unknown): TinderState {
  if (!raw || typeof raw !== "object") return INITIAL;
  const r = raw as Partial<TinderState>;
  const sessions = Array.isArray(r.sessions) ? r.sessions.map(migrateSession).filter((x): x is TinderSession => Boolean(x)) : [];
  const activeId = typeof r.activeId === "string" && sessions.some((s) => s.id === r.activeId) ? r.activeId : null;
  return { version: 1, sessions, activeId };
}

/** Keeps the history bounded: max sessions and a byte budget (oldest, non-active go first). */
function prune(state: TinderState): TinderState {
  let sessions = state.sessions.slice(0, MAX_SESSIONS);
  try {
    while (sessions.length > 1 && JSON.stringify({ ...state, sessions }).length > MAX_BYTES) {
      const idx = [...sessions].reverse().findIndex((s) => s.id !== state.activeId);
      if (idx === -1) break;
      sessions = sessions.filter((_, i) => i !== sessions.length - 1 - idx);
    }
  } catch {
    /* stringify failure — keep as is */
  }
  return { ...state, sessions };
}

export const tinderStore = createStore<TinderState>("adgym:tinder:v1", INITIAL, migrate);
export const useTinder = tinderStore.useStore;

function update(fn: (s: TinderState) => TinderState) {
  try {
    tinderStore.update((s) => prune(fn(s)));
  } catch {
    /* storage unavailable — the store keeps it in memory */
  }
}

export function activeSession(state: TinderState): TinderSession | null {
  return state.activeId ? (state.sessions.find((s) => s.id === state.activeId) ?? null) : null;
}

/** Sessions worth listing in history: anything with at least one swipe. */
export function historySessions(state: TinderState): TinderSession[] {
  return state.sessions.filter((s) => s.round1.liked.length + s.round1.passed.length > 0);
}


const hasSwipes = (s: TinderSession) => s.round1.liked.length + s.round1.passed.length > 0;

/** Starts a new session and makes it active; abandoned sessions without a single swipe are dropped. */
export function startSession(session: TinderSession) {
  update((st) => ({ ...st, sessions: [session, ...st.sessions.filter((s) => s.id !== session.id && hasSwipes(s))], activeId: session.id }));
}

/** "Yeni başla": leave the active session (kept in history if it has swipes). */
export function abandonActive() {
  update((st) => ({
    ...st,
    sessions: st.sessions.filter((s) => s.id !== st.activeId || hasSwipes(s)),
    activeId: null,
  }));
}

export function saveSession(session: TinderSession) {
  update((st) => ({ ...st, sessions: st.sessions.map((s) => (s.id === session.id ? session : s)) }));
}

export function setActive(id: string | null) {
  update((st) => ({ ...st, activeId: id }));
}

export function deleteSession(id: string) {
  update((st) => ({ ...st, sessions: st.sessions.filter((s) => s.id !== id), activeId: st.activeId === id ? null : st.activeId }));
}

/** Ids swiped in the last few sessions (used to favour unseen ads when sampling). */
export function recentSeenIds(state: TinderState, sessions = 5): Set<string> {
  const out = new Set<string>();
  for (const s of state.sessions.slice(0, sessions)) for (const id of [...s.round1.liked, ...s.round1.passed]) out.add(id);
  return out;
}

/** Resolves an id against the live dataset first, then the session's snapshots. */
export function resolveAd(s: TinderSession, id: string, live?: ReadonlyMap<string, Ad>): Ad | undefined {
  return live?.get(id) ?? s.ads[id];
}

/** "Tinder · 10 Eki · US DTC" */
export function collectionName(s: TinderSession): string {
  const d = new Date(s.createdAt);
  const date = Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
  return ["Tinder", date, filtersLabel(s.filters)].filter(Boolean).join(" · ");
}

export function sessionDate(s: TinderSession): string {
  const d = new Date(s.createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
