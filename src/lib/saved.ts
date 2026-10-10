import type { Ad } from "./types";
import { createStore } from "./store";
import { normalizeRecord, type AnalysisRecord } from "./analysis";

export interface Collection {
  id: string;
  name: string;
  createdAt: string;
}

export interface Note {
  id: string;
  text: string;
  createdAt: string;
  updatedAt?: string;
}

export interface SavedItem {
  ad: Ad; // snapshot, so saved ads survive data refreshes
  collectionId: string;
  savedAt: string;
  /** User notes ("konsept fikri" etc.). Independent of the analysis. */
  notes: Note[];
  /** Gemini breakdown — only present after the user pressed "Özetle". */
  analysis?: AnalysisRecord;
  /** @deprecated legacy single "Neden çalışıyor?" note — migrated into `notes[0]`; kept only for old data. */
  note?: string;
}

export interface SavedState {
  version: 1;
  collections: Collection[];
  items: Record<string, SavedItem>;
}

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export const DEFAULT_COLLECTION_ID = "default";
export const DEFAULT_COLLECTION_NAME = "Kaydedilenler";

const INITIAL: SavedState = {
  version: 1,
  collections: [{ id: DEFAULT_COLLECTION_ID, name: DEFAULT_COLLECTION_NAME, createdAt: "1970-01-01T00:00:00.000Z" }],
  items: {},
};

const LEGACY_NOTE_ID = "legacy";

function migrateNotes(it: Partial<SavedItem>, fallbackDate: string): Note[] {
  const out: Note[] = [];
  const seen = new Set<string>();
  if (Array.isArray(it.notes)) {
    for (const n of it.notes) {
      if (!n || typeof n !== "object" || typeof n.text !== "string" || !n.text.trim()) continue;
      const id = typeof n.id === "string" && n.id && !seen.has(n.id) ? n.id : uid();
      seen.add(id);
      const note: Note = { id, text: n.text, createdAt: typeof n.createdAt === "string" ? n.createdAt : fallbackDate };
      if (typeof n.updatedAt === "string") note.updatedAt = n.updatedAt;
      out.push(note);
    }
  }
  // Old single note → first item of the list (once).
  if (typeof it.note === "string" && it.note.trim() && !seen.has(LEGACY_NOTE_ID) && !out.some((n) => n.text === it.note)) {
    out.unshift({ id: LEGACY_NOTE_ID, text: it.note.trim(), createdAt: fallbackDate });
  }
  return out;
}

function migrateItem(it: SavedItem, collections: Collection[]): SavedItem {
  const savedAt = typeof it.savedAt === "string" ? it.savedAt : new Date(0).toISOString();
  const next: SavedItem = {
    ad: it.ad,
    collectionId: collections.some((c) => c.id === it.collectionId) ? it.collectionId : DEFAULT_COLLECTION_ID,
    savedAt,
    notes: migrateNotes(it, savedAt),
  };
  const analysis = it.analysis ? normalizeRecord(it.analysis) : undefined;
  if (analysis) next.analysis = analysis;
  return next;
}

function migrate(raw: unknown): SavedState {
  if (!raw || typeof raw !== "object") return INITIAL;
  const r = raw as Partial<SavedState>;
  const collections = Array.isArray(r.collections) ? r.collections.filter((c) => c && typeof c.id === "string" && typeof c.name === "string") : [];
  if (!collections.some((c) => c.id === DEFAULT_COLLECTION_ID)) collections.unshift(INITIAL.collections[0]);
  const items: Record<string, SavedItem> = {};
  if (r.items && typeof r.items === "object") {
    for (const [id, it] of Object.entries(r.items)) {
      if (!it || typeof it !== "object" || !it.ad || typeof it.ad.id !== "string") continue;
      items[id] = migrateItem(it, collections);
    }
  }
  return { version: 1, collections, items };
}

export const savedStore = createStore<SavedState>("adgym:saved:v1", INITIAL, migrate);
export const useSaved = savedStore.useStore;


export function isSaved(id: string): boolean {
  return Boolean(savedStore.read().items[id]);
}

/**
 * Notes + analysis of ads removed in this session, so "Geri al" (which calls saveAd again)
 * restores them instead of silently dropping the user's notes and a paid analysis.
 */
const recentlyRemoved = new Map<string, Pick<SavedItem, "notes" | "analysis" | "savedAt">>();

export function saveAd(ad: Ad, collectionId: string = DEFAULT_COLLECTION_ID) {
  savedStore.update((s) => {
    const prev = s.items[ad.id];
    const restored = prev ? undefined : recentlyRemoved.get(ad.id);
    recentlyRemoved.delete(ad.id);
    const item: SavedItem = {
      ad,
      collectionId,
      savedAt: prev?.savedAt ?? restored?.savedAt ?? new Date().toISOString(),
      notes: prev?.notes ?? restored?.notes ?? [],
    };
    const analysis = prev?.analysis ?? restored?.analysis;
    if (analysis) item.analysis = analysis;
    return { ...s, items: { ...s.items, [ad.id]: item } };
  });
}

export function removeAd(id: string) {
  savedStore.update((s) => {
    const prev = s.items[id];
    if (prev && (prev.notes.length || prev.analysis)) {
      recentlyRemoved.set(id, { notes: prev.notes, analysis: prev.analysis, savedAt: prev.savedAt });
    }
    const items = { ...s.items };
    delete items[id];
    return { ...s, items };
  });
}

/** Puts back an exact item (undo in /saved). */
export function restoreItem(item: SavedItem) {
  recentlyRemoved.delete(item.ad.id);
  savedStore.update((s) => ({
    ...s,
    items: { ...s.items, [item.ad.id]: { ...item, collectionId: s.collections.some((c) => c.id === item.collectionId) ? item.collectionId : DEFAULT_COLLECTION_ID } },
  }));
}

/** Returns true if the ad is saved after the toggle. */
export function toggleSaved(ad: Ad): boolean {
  if (isSaved(ad.id)) {
    removeAd(ad.id);
    return false;
  }
  saveAd(ad);
  return true;
}

export function moveAd(id: string, collectionId: string) {
  savedStore.update((s) => (s.items[id] ? { ...s, items: { ...s.items, [id]: { ...s.items[id], collectionId } } } : s));
}

function updateItem(id: string, fn: (it: SavedItem) => SavedItem) {
  savedStore.update((s) => (s.items[id] ? { ...s, items: { ...s.items, [id]: fn(s.items[id]) } } : s));
}

/** @deprecated single-note API (pre-notes list): upserts the first note. Prefer addNote/updateNote. */
export function setNote(id: string, note: string) {
  const first = savedStore.read().items[id]?.notes[0];
  if (first) {
    if (note.trim()) updateNote(id, first.id, note);
    else deleteNote(id, first.id);
  } else if (note.trim()) addNote(id, note);
}

/** Adds a note to a saved ad; returns the note id (undefined if the ad isn't saved / text empty). */
export function addNote(adId: string, text: string): string | undefined {
  const clean = text.trim();
  if (!clean || !savedStore.read().items[adId]) return undefined;
  const note: Note = { id: uid(), text: clean, createdAt: new Date().toISOString() };
  updateItem(adId, (it) => ({ ...it, notes: [...it.notes, note] }));
  return note.id;
}

export function updateNote(adId: string, noteId: string, text: string) {
  const clean = text.trim();
  if (!clean) return;
  updateItem(adId, (it) => ({
    ...it,
    notes: it.notes.map((n) => (n.id === noteId && n.text !== clean ? { ...n, text: clean, updatedAt: new Date().toISOString() } : n)),
  }));
}

export function deleteNote(adId: string, noteId: string) {
  updateItem(adId, (it) => ({ ...it, notes: it.notes.filter((n) => n.id !== noteId) }));
}

/** Re-inserts a deleted note at its old position (undo). */
export function restoreNote(adId: string, note: Note, index: number) {
  updateItem(adId, (it) => {
    if (it.notes.some((n) => n.id === note.id)) return it;
    const notes = [...it.notes];
    notes.splice(Math.min(Math.max(index, 0), notes.length), 0, note);
    return { ...it, notes };
  });
}

/** Stores a Gemini analysis on a saved ad (saving it first if `ad` is given and it isn't saved yet). */
export function setAnalysis(adId: string, analysis: AnalysisRecord, ad?: Ad) {
  if (!savedStore.read().items[adId] && ad) saveAd(ad);
  updateItem(adId, (it) => ({ ...it, analysis }));
}

export function clearAnalysis(adId: string) {
  updateItem(adId, (it) => {
    const next = { ...it };
    delete next.analysis;
    return next;
  });
}

export function createCollection(name: string): string {
  const id = uid();
  const clean = name.trim() || "Yeni koleksiyon";
  savedStore.update((s) => ({ ...s, collections: [...s.collections, { id, name: clean, createdAt: new Date().toISOString() }] }));
  return id;
}

export function renameCollection(id: string, name: string) {
  const clean = name.trim();
  if (!clean) return;
  savedStore.update((s) => ({ ...s, collections: s.collections.map((c) => (c.id === id ? { ...c, name: clean } : c)) }));
}

/** Deletes a collection; its ads move to the default collection. */
export function deleteCollection(id: string) {
  if (id === DEFAULT_COLLECTION_ID) return;
  savedStore.update((s) => {
    const items: Record<string, SavedItem> = {};
    for (const [k, v] of Object.entries(s.items)) items[k] = v.collectionId === id ? { ...v, collectionId: DEFAULT_COLLECTION_ID } : v;
    return { ...s, collections: s.collections.filter((c) => c.id !== id), items };
  });
}

// ---------------------------------------------------------------------------------------------
// Backup / restore ("Yedekle / Geri yükle") — localStorage is per device.

export interface SavedBackup {
  app: "adgym";
  kind: "saved";
  version: 1;
  exportedAt: string;
  data: SavedState;
}

export function exportSaved(): string {
  const backup: SavedBackup = { app: "adgym", kind: "saved", version: 1, exportedAt: new Date().toISOString(), data: savedStore.read() };
  return JSON.stringify(backup, null, 2);
}

export interface ImportResult {
  added: number;
  merged: number;
  collections: number;
}

/**
 * Merges a backup into the current data (never deletes anything): new ads are added, existing ones
 * get the union of notes (by id) and the newer analysis; collections are matched by id.
 * Throws a Turkish error message if the file isn't an AdGym backup.
 */
export function importSaved(json: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Dosya okunamadı (geçerli JSON değil).");
  }
  const r = raw as Partial<SavedBackup> & Partial<SavedState>;
  const payload = r && typeof r === "object" && r.kind === "saved" ? r.data : r; // a bare SavedState works too
  if (!payload || typeof payload !== "object" || !("items" in payload)) throw new Error("Bu bir AdGym yedeği değil.");
  const incoming = migrate(payload);

  const result: ImportResult = { added: 0, merged: 0, collections: 0 };
  savedStore.update((s) => {
    const collections = [...s.collections];
    for (const c of incoming.collections) {
      if (!collections.some((x) => x.id === c.id)) {
        collections.push(c);
        result.collections++;
      }
    }
    const items = { ...s.items };
    for (const [id, it] of Object.entries(incoming.items)) {
      const cur = items[id];
      if (!cur) {
        items[id] = it;
        result.added++;
        continue;
      }
      const notes = [...cur.notes];
      for (const n of it.notes) if (!notes.some((x) => x.id === n.id)) notes.push(n);
      notes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const analysis = !cur.analysis ? it.analysis : it.analysis && it.analysis.createdAt > cur.analysis.createdAt ? it.analysis : cur.analysis;
      const next: SavedItem = { ...cur, notes };
      if (analysis) next.analysis = analysis;
      items[id] = next;
      result.merged++;
    }
    return { ...s, collections, items };
  });
  return result;
}
