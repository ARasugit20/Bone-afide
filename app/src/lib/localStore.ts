"use client";

import { useCallback, useSyncExternalStore } from "react";

// Tiny localStorage-backed state that is SSR-safe (server snapshot = fallback).
const EVENT = "bonafide-store";

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

export function useLocalStore<T extends string>(key: string, fallback: T | null) {
  const value = useSyncExternalStore(
    subscribe,
    () => (localStorage.getItem(key) as T | null) ?? fallback,
    () => fallback,
  );
  const set = useCallback(
    (v: T | null) => {
      if (v === null) localStorage.removeItem(key);
      else localStorage.setItem(key, v);
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );
  return [value, set] as const;
}
