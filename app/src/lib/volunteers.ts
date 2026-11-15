import { EXPERIENCE_RANK } from "./dogs";
import type { Dog, Volunteer } from "./types";

export type Assignment = { volunteer: Volunteer; dogs: Dog[] };
export type Roster = { assignments: Assignment[]; unassigned: Dog[] };

/**
 * A volunteer can take dogs at or below their experience level (handler.min_experience).
 * Hardest dogs are placed first; each goes to the least-loaded eligible volunteer, preferring the lowest
 * sufficient level so experienced handlers stay free for dogs only they can take.
 */
export function assignDogs(dogs: Dog[], volunteers: Volunteer[]): Roster {
  const load = new Map(volunteers.map((v) => [v.volunteer_id, [] as Dog[]]));
  const need = (d: Dog) => EXPERIENCE_RANK[d.handler?.min_experience ?? "any"];
  const unassigned: Dog[] = [];
  for (const dog of [...dogs].sort((a, b) => need(b) - need(a) || a.name.localeCompare(b.name))) {
    const eligible = volunteers.filter((v) => EXPERIENCE_RANK[v.experience] >= need(dog));
    if (!eligible.length) {
      unassigned.push(dog);
      continue;
    }
    eligible.sort(
      (a, b) =>
        load.get(a.volunteer_id)!.length - load.get(b.volunteer_id)!.length ||
        EXPERIENCE_RANK[a.experience] - EXPERIENCE_RANK[b.experience] ||
        a.name.localeCompare(b.name),
    );
    load.get(eligible[0].volunteer_id)!.push(dog);
  }
  const order = (v: Volunteer) => -EXPERIENCE_RANK[v.experience];
  return {
    assignments: [...volunteers].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)).map((v) => ({ volunteer: v, dogs: load.get(v.volunteer_id)! })),
    unassigned,
  };
}
