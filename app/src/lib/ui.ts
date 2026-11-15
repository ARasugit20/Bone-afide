import type { Dog, Family, HandlingLevel } from "./types";

export const CAPTION = "Decision support, not a diagnosis.";

export const LEVELS: Record<HandlingLevel, { label: string; chip: string; dot: string; ring: string }> = {
  Green: { label: "Any loving home", chip: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "bg-emerald-500", ring: "ring-emerald-500" },
  Yellow: { label: "Some experience", chip: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-400", ring: "ring-amber-400" },
  Orange: { label: "Experienced home", chip: "bg-orange-50 text-orange-800 ring-orange-200", dot: "bg-orange-500", ring: "ring-orange-500" },
  Red: { label: "Behavior team / pro", chip: "bg-rose-50 text-rose-800 ring-rose-200", dot: "bg-rose-500", ring: "ring-rose-500" },
};

export const LEVEL_RANK: Record<HandlingLevel, number> = { Green: 0, Yellow: 1, Orange: 2, Red: 3 };

// Orange/Red placements are provisional until a vet signs off.
export const needsReview = (dog: Dog) => LEVEL_RANK[dog.handling_level] >= 2 && !dog.expert_reviewed;

export const EXPERIENCE = ["First-time", "Some", "Experienced", "Foster / pro"] as const;
export const ACTIVITY = { 1: "Relaxed", 2: "Moderate", 3: "Very active" } as const;
export const HOME: Record<Family["home"], string> = { apartment: "Apartment", house: "House", house_yard: "House + yard" };
export const KIDS: Record<Family["kids"], string> = { none: "No kids", teens: "Teens", young: "Young kids" };

export async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export const postJSON = <T>(url: string, body?: unknown) =>
  getJSON<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
