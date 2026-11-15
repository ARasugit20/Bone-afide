import type { Dog, Playgroup } from "./types";

// Safe pairing rules, from behavior scores only (never breed):
//  - both must be Green or Yellow (never Orange or Red in a playgroup)
//  - neither may have rising stress
//  - similar energy (within 25 points)
//  - decent approachability (>= 45) so they tolerate company
const SAFE_LEVELS = new Set(["Green", "Yellow"]);
const ENERGY_GAP = 25;
const MIN_APPROACH = 45;

export function eligible(dog: Dog): boolean {
  return (
    SAFE_LEVELS.has(dog.handling_level) &&
    dog.welfare?.status !== "rising_stress" &&
    dog.trend !== "worsening" &&
    dog.approachability >= MIN_APPROACH
  );
}

function pairReasons(a: Dog, b: Dog): string[] {
  const reasons: string[] = [];
  const gap = Math.abs(a.energy - b.energy);
  reasons.push(gap <= 10 ? "Very similar energy levels" : "Similar energy levels");
  if (a.handling_level === "Green" && b.handling_level === "Green") reasons.push("Both are Green level");
  else reasons.push(`Both are calm enough (${a.handling_level} and ${b.handling_level})`);
  // Grounded line from fit_notes/evidence when available.
  const calmA = a.fit_notes?.find((n) => /calm/i.test(n));
  const calmB = b.fit_notes?.find((n) => /calm/i.test(n));
  if (calmA && calmB) reasons.push("Both show calm sessions on record");
  return reasons.slice(0, 3);
}

/** Suggest safe pairs. Greedy: sort by energy, pair adjacent eligible dogs within the gap. */
export function suggestPlaygroups(dogs: Dog[]): Playgroup[] {
  const pool = dogs.filter(eligible).sort((a, b) => a.energy - b.energy);
  const used = new Set<string>();
  const groups: Playgroup[] = [];
  for (let i = 0; i < pool.length; i++) {
    if (used.has(pool[i].dog_id)) continue;
    for (let j = i + 1; j < pool.length; j++) {
      if (used.has(pool[j].dog_id)) continue;
      if (Math.abs(pool[i].energy - pool[j].energy) > ENERGY_GAP) break; // sorted, so no closer match later
      groups.push({ dog_ids: [pool[i].dog_id, pool[j].dog_id], reasons: pairReasons(pool[i], pool[j]) });
      used.add(pool[i].dog_id);
      used.add(pool[j].dog_id);
      break;
    }
  }
  return groups;
}
