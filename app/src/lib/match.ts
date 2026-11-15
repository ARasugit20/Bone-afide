import type { Dog, Family, HandlingLevel, Match } from "./types";

export const MIN_EXPERIENCE: Record<HandlingLevel, number> = { Green: 0, Yellow: 1, Orange: 2, Red: 3 };
const ENERGY_TARGET = { 1: 30, 2: 55, 3: 80 } as const;
const MIN_APPROACHABILITY = 30;
const BLOCKED_COST = 1000;
const DUMMY_COST = 100;

export interface PairScore {
  score: number;
  blocked: boolean;
  reasons: string[];
}

// Maps a not_suited_for phrase to a family condition that should be avoided. Each
// rule: does this family trigger the phrase? If so, that pairing is penalized (or
// blocked). Phrases come from the pipeline's config/fit_rules.json.
const NOT_SUITED_RULES: { match: RegExp; triggers: (f: Family) => boolean; reason: (name: string) => string; block?: boolean }[] = [
  {
    match: /young children|young kids|small kids/i,
    triggers: (f) => f.kids === "young",
    reason: (name) => `${name} is not suited to homes with very young children right now`,
    block: true,
  },
  {
    match: /first-time owner|without a trainer/i,
    triggers: (f) => f.experience <= 0,
    reason: (name) => `${name} needs an owner with some handling experience right now`,
  },
  {
    match: /multi-pet|other pets|busy/i,
    triggers: (f) => f.other_pets.length > 0,
    reason: (name) => `${name} needs a calmer home without other pets until stress settles`,
  },
  {
    match: /doorway|gate|secure/i,
    triggers: (f) => f.home === "apartment",
    reason: (name) => `${name} needs a home with a secure entry, not a shared doorway, for now`,
  },
  {
    match: /immediately social|expecting an? .*social/i,
    triggers: () => true,
    reason: (name) => `${name} warms up slowly, so plan for a patient introduction`,
  },
];

// Returns [reasons, blocked] for the dog's not_suited_for list against this family.
function notSuitedConflicts(dog: Dog, family: Family): { reasons: string[]; blocked: boolean } {
  const reasons: string[] = [];
  let blocked = false;
  for (const phrase of dog.not_suited_for ?? []) {
    for (const rule of NOT_SUITED_RULES) {
      if (rule.match.test(phrase) && rule.triggers(family)) {
        reasons.push(rule.reason(dog.name));
        if (rule.block) blocked = true;
      }
    }
  }
  return { reasons, blocked };
}

function petConflict(dog: Dog, family: Family): string | null {
  const needs = dog.needs.map((n) => n.toLowerCase());
  for (const pet of family.other_pets) {
    // "no small kids yet" is about children, not small pets.
    const hit = needs.find((n) => n.includes(`no ${pet}`) && !n.includes("no small kids"));
    if (hit) return `${dog.name} isn't ready to live with ${pet === "small" ? "small pets" : pet} yet`;
  }
  return null;
}

export function scorePair(dog: Dog, family: Family): PairScore {
  const reasons: string[] = [];
  let blocked = false;
  const need = MIN_EXPERIENCE[dog.handling_level];

  if (family.experience < need) {
    blocked = true;
    reasons.push(`${dog.name} is ${dog.handling_level} level and needs a more experienced home for now`);
  }
  if (dog.approachability < MIN_APPROACHABILITY) {
    blocked = true;
    reasons.push(`${dog.name} needs time with the behavior team before meeting adopters`);
  }
  const pet = petConflict(dog, family);
  if (pet) {
    blocked = true;
    reasons.push(pet);
  }

  // Grounded not_suited_for rules: block hard ones (very young children), heavily
  // penalize the rest so the Hungarian matcher avoids those pairings.
  const ns = notSuitedConflicts(dog, family);
  if (ns.blocked) blocked = true;
  const notSuitedPenalty = ns.reasons.length * 30;
  for (const r of ns.reasons) if (!reasons.includes(r)) reasons.push(r);

  let score = 55;
  score -= notSuitedPenalty;
  if (family.experience > need) score += 5;

  const gap = Math.abs(dog.energy - ENERGY_TARGET[family.activity]);
  score += 20 - 0.5 * gap;
  if (gap < 15) reasons.push(`Energy level fits the family's pace`);

  if (family.kids === "young") {
    if (dog.arousal_spikes > 3 || dog.approachability < 50) score -= 25;
    else {
      score += 8;
      reasons.push(`${dog.name} stays calm and friendly, a good fit for young kids`);
    }
  }

  if (dog.stress > 60 && family.home === "apartment") score -= 10;
  if (dog.stress > 60 && family.hours_alone <= 4) {
    score += 6;
    reasons.push(`Someone is home most of the day, which helps ${dog.name} settle`);
  }
  if (dog.energy > 70 && family.home === "house_yard") {
    score += 6;
    reasons.push(`A yard gives ${dog.name} room to burn off energy`);
  }
  if (dog.trend === "improving") reasons.push("Stress has dropped since day 1");

  return {
    score: Math.round(Math.max(0, Math.min(100, score))),
    blocked,
    reasons: reasons.slice(0, 3),
  };
}

// Hungarian algorithm (Kuhn–Munkres with potentials), O(n^3), square min-cost matrix.
// Returns assignment[row] = column.
export function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0); // p[col] = row assigned to col (1-indexed, 0 = none)
  const way = new Array(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(INF);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const assignment = new Array(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j]) assignment[p[j] - 1] = j - 1;
  return assignment;
}

export interface GridCell {
  dog_id: string;
  family_id: string;
  score: number;
  blocked: boolean;
}

export function matchShelter(dogs: Dog[], families: Family[]) {
  const n = Math.max(dogs.length, families.length);
  const pairs = dogs.map((d) => families.map((f) => scorePair(d, f)));
  const cost = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      const s = pairs[i]?.[j];
      if (!s) return DUMMY_COST;
      return s.blocked ? BLOCKED_COST : 100 - s.score;
    }),
  );

  const assignment = n ? hungarian(cost) : [];
  const matches: Match[] = [];
  dogs.forEach((dog, i) => {
    const j = assignment[i];
    const s = pairs[i][j];
    if (j < families.length && s && !s.blocked) {
      matches.push({ dog_id: dog.dog_id, family_id: families[j].family_id, score: s.score, reasons: s.reasons });
    }
  });

  const matched = new Set(matches.map((m) => m.dog_id));
  const unmatched = dogs.filter((d) => !matched.has(d.dog_id)).map((d) => d.dog_id);
  const grid: GridCell[] = dogs.flatMap((d, i) =>
    families.map((f, j) => ({ dog_id: d.dog_id, family_id: f.family_id, score: pairs[i][j].score, blocked: pairs[i][j].blocked })),
  );

  return { matches, unmatched, grid };
}

/**
 * Why a dog cannot be offered to any current family, or null when at least one family is open
 * (so being unmatched just means the open families were paired elsewhere).
 */
export function fosterReason(dog: Dog, families: Family[]): string | null {
  if (!families.length || families.some((f) => !scorePair(dog, f).blocked)) return null;
  if (dog.approachability < MIN_APPROACHABILITY) {
    return `${dog.name} needs time with the behavior team before meeting adopters`;
  }
  if (families.every((f) => f.experience < MIN_EXPERIENCE[dog.handling_level])) {
    return `${dog.name} is ${dog.handling_level} level and needs a more experienced home for now`;
  }
  return "No current family meets this dog's needs yet";
}
