import { plain } from "./text";
import type { Dog, Family } from "./types";

export type Why = {
  lines: string[]; // up to 2 grounded lines
  source: "evidence" | "matcher";
  notFit: { text: string; conflict: boolean } | null;
};

// Does a "not suited for" phrase describe this family? Plain keyword rules, no AI.
function conflicts(item: string, f: Family): boolean {
  const t = item.toLowerCase();
  if (/(child|kid|toddler)/.test(t) && f.kids === "young") return true;
  if (/(teen)/.test(t) && f.kids !== "none") return true;
  if (/\bcats?\b/.test(t) && f.other_pets.includes("cats")) return true;
  if (/(other dogs|\bdogs\b)/.test(t) && f.other_pets.includes("dogs")) return true;
  if (/(small (pets|animals)|rabbit)/.test(t) && f.other_pets.includes("small")) return true;
  if (/(apartment|small space|shared hallway)/.test(t) && f.home === "apartment") return true;
  if (/(first-time|first time|new owner|inexperienced)/.test(t) && f.experience === 0) return true;
  if (/(alone|long hours)/.test(t) && f.hours_alone >= 7) return true;
  if (/(yard|gate|fence)/.test(t) && f.home !== "house_yard") return true;
  return false;
}

/**
 * Why a dog and family were paired. Facts come only from the pipeline's fit_notes (grounded in video and sessions);
 * for dogs without them (e.g. seed dogs) the matcher's own reasons are used. Nothing is generated.
 */
export function whyThisMatch(dog: Dog, family: Family, matcherReasons: string[] = []): Why {
  const fit = (dog.fit_notes ?? []).slice(0, 2);
  const lines = fit.length ? fit : matcherReasons.slice(0, 2).map(plain);
  const items = dog.not_suited_for ?? [];
  const hit = items.find((i) => conflicts(i, family));
  return {
    lines,
    source: fit.length ? "evidence" : "matcher",
    notFit: hit ? { text: hit, conflict: true } : items.length ? { text: items.slice(0, 2).join(", "), conflict: false } : null,
  };
}
