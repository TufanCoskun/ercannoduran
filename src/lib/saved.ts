import type { Ad } from "./types";
import { createStore } from "./store";

export interface Collection {
  id: string;
  name: string;
  createdAt: string;
}

export interface SavedItem {
  ad: Ad; // snapshot, so saved ads survive data refreshes
  collectionId: string;
  savedAt: string;
  note?: string;
}

export interface SavedState {
  version: 1;
  collections: Collection[];
  items: Record<string, SavedItem>;
}

export const DEFAULT_COLLECTION_ID = "default";
export const DEFAULT_COLLECTION_NAME = "Kaydedilenler";

const INITIAL: SavedState = {
  version: 1,
  collections: [{ id: DEFAULT_COLLECTION_ID, name: DEFAULT_COLLECTION_NAME, createdAt: "1970-01-01T00:00:00.000Z" }],
  items: {},
};

function migrate(raw: unknown): SavedState {
  if (!raw || typeof raw !== "object") return INITIAL;
  const r = raw as Partial<SavedState>;
  const collections = Array.isArray(r.collections) ? r.collections.filter((c) => c && typeof c.id === "string" && typeof c.name === "string") : [];
  if (!collections.some((c) => c.id === DEFAULT_COLLECTION_ID)) collections.unshift(INITIAL.collections[0]);
  const items: Record<string, SavedItem> = {};
  if (r.items && typeof r.items === "object") {
    for (const [id, it] of Object.entries(r.items)) {
      if (!it || typeof it !== "object" || !it.ad || typeof it.ad.id !== "string") continue;
      items[id] = {
        ...it,
        collectionId: collections.some((c) => c.id === it.collectionId) ? it.collectionId : DEFAULT_COLLECTION_ID,
      };
    }
  }
  return { version: 1, collections, items };
}

export const savedStore = createStore<SavedState>("adgym:saved:v1", INITIAL, migrate);
export const useSaved = savedStore.useStore;

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export function isSaved(id: string): boolean {
  return Boolean(savedStore.read().items[id]);
}

export function saveAd(ad: Ad, collectionId: string = DEFAULT_COLLECTION_ID) {
  savedStore.update((s) => ({
    ...s,
    items: {
      ...s.items,
      [ad.id]: {
        ad,
        collectionId,
        savedAt: s.items[ad.id]?.savedAt ?? new Date().toISOString(),
        note: s.items[ad.id]?.note,
      },
    },
  }));
}

export function removeAd(id: string) {
  savedStore.update((s) => {
    const items = { ...s.items };
    delete items[id];
    return { ...s, items };
  });
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

export function setNote(id: string, note: string) {
  savedStore.update((s) => (s.items[id] ? { ...s, items: { ...s.items, [id]: { ...s.items[id], note } } } : s));
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
