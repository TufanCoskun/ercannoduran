import { useSyncExternalStore } from "react";

/** Tiny localStorage-backed store with cross-tab sync, safe for SSR (server snapshot = initial). */
export function createStore<T>(key: string, initial: T, migrate: (raw: unknown) => T = (r) => r as T) {
  let cache: T | undefined;
  const listeners = new Set<() => void>();

  function read(): T {
    if (cache !== undefined) return cache;
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      cache = raw ? migrate(JSON.parse(raw)) : initial;
    } catch {
      cache = initial;
    }
    return cache;
  }

  function write(next: T) {
    cache = next;
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* quota / private mode — keep in memory */
    }
    listeners.forEach((l) => l());
  }

  function update(fn: (prev: T) => T) {
    write(fn(read()));
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key || e.key === null) {
        cache = undefined;
        listener();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  const getServerSnapshot = () => initial;

  function useStore(): T {
    return useSyncExternalStore(subscribe, read, getServerSnapshot);
  }

  return { read, write, update, subscribe, useStore };
}

/** true after hydration (avoids rendering localStorage-dependent UI on the server). */
const noopSubscribe = () => () => {};
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
