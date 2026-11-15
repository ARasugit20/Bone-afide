"use client";

import { remember } from "./clientCache";
import type { Dog } from "./types";
import { getJSON, postJSON } from "./ui";

export type WarmPhase = "idle" | "warming" | "ready" | "partial";

let phase: WarmPhase = "idle";
const listeners = new Set<() => void>();
const set = (p: WarmPhase) => {
  phase = p;
  listeners.forEach((l) => l());
};

export const getWarmPhase = () => phase;
export function subscribeWarm(cb: () => void) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

const DEMO_DOG = "max-01";
// Visiting each page once makes the dev server compile it, so first clicks on stage are instant.
const PAGES = ["/", "/dogs", `/dogs/${DEMO_DOG}`, "/match", "/intake", "/bias-test", `/passport/${DEMO_DOG}`];

async function load<T>(url: string) {
  const data = await getJSON<T>(url);
  remember(url, data);
  return data;
}

/** Fetches everything the demo touches into the client cache. Never triggers new AI generations for bias tests. */
export async function prewarm() {
  if (phase === "warming" || phase === "ready") return;
  set("warming");
  const results = await Promise.allSettled([
    load<Dog[]>("/api/dogs").then((dogs) =>
      Promise.all(
        dogs.flatMap((d) => [
          load(`/api/dogs/${d.dog_id}`),
          load(`/api/trend/${d.dog_id}`),
          postJSON<{ answers?: unknown }>("/api/bias-test", { dog_id: d.dog_id, cached_only: true }).then((r) => {
            if (r.answers) remember(`bias:${d.dog_id}`, r);
          }),
        ]),
      ),
    ),
    load("/api/families"),
    load("/api/match"),
    load(`/api/rentals?dog_id=${DEMO_DOG}`),
    postJSON(`/api/passport/${DEMO_DOG}`).then((r) => remember(`passport:${DEMO_DOG}`, r)),
    ...PAGES.map((p) => fetch(p).then((r) => r.text())),
  ]);
  set(results.every((r) => r.status === "fulfilled") ? "ready" : "partial");
}
