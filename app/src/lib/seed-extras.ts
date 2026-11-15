import type { AlumniPost, CareRecord, CareType, Diet, InventoryItem } from "./types";
import { DEFAULT_INTERVALS } from "./care";

const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

// Deterministic per-dog offsets so records look realistic and some land overdue.
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Care records for one dog. Some items are intentionally overdue so the demo shows alerts. */
export function careForDog(dogId: string): CareRecord[] {
  const h = hash(dogId);
  const types: CareType[] = ["vaccines", "vet_checkup", "flea_tick", "nail_trim", "bath"];
  return types.map((type, i) => {
    const interval = DEFAULT_INTERVALS[type];
    // last done between 0.3x and 1.3x the interval ago -> some are overdue.
    const frac = 0.3 + ((h >> (i * 3)) % 100) / 100;
    const sinceDays = Math.round(interval * frac);
    return { dog_id: dogId, type, last_date: daysAgo(sinceDays), interval_days: interval };
  });
}

const FOOD_TYPES = ["Chicken and rice kibble", "Salmon kibble", "Turkey and sweet potato", "Lamb and barley"];
const ALLERGY_POOL = [[], ["chicken"], ["grain"], [], ["beef"]];

export function dietForDog(dogId: string): Diet {
  const h = hash(dogId);
  return {
    dog_id: dogId,
    food_type: FOOD_TYPES[h % FOOD_TYPES.length],
    grams_per_day: 200 + (h % 5) * 50,
    allergies: ALLERGY_POOL[h % ALLERGY_POOL.length],
    notes: "",
  };
}

export const SEED_INVENTORY: InventoryItem[] = [
  { sku: "kibble-chicken", name: "Chicken and rice kibble", unit: "kg", on_hand: 18, daily_use: 3.2, low_stock_days: 7 },
  { sku: "kibble-salmon", name: "Salmon kibble", unit: "kg", on_hand: 6, daily_use: 2.0, low_stock_days: 7 },
  { sku: "canned-food", name: "Canned food", unit: "cans", on_hand: 40, daily_use: 12, low_stock_days: 5 },
  { sku: "puppy-formula", name: "Puppy formula", unit: "kg", on_hand: 2, daily_use: 0.8, low_stock_days: 5 },
  { sku: "treats", name: "Training treats", unit: "bags", on_hand: 9, daily_use: 1, low_stock_days: 5 },
];

export function seedAlumni(): AlumniPost[] {
  return [
    {
      post_id: "alum-1", dog_id: "luna-02", dog_name: "Luna", family_name: "The Ramirez family",
      text: "Three weeks home and Luna already has a favorite spot by the window. She naps all afternoon and greets us at the door.",
      created_at: new Date(Date.now() - 2 * DAY_MS).toISOString(),
    },
    {
      post_id: "alum-2", dog_id: "pepper-04", dog_name: "Pepper", family_name: "Dana and Sam",
      text: "Pepper passed her first obedience class. The calm start the shelter recommended made the difference.",
      created_at: new Date(Date.now() - 6 * DAY_MS).toISOString(),
    },
    {
      post_id: "alum-3", dog_id: "max-01", dog_name: "Max", family_name: "The Okafor family",
      text: "Max loves the morning jog. His energy score was spot on. We added a fenced yard and he is thriving.",
      created_at: new Date(Date.now() - 12 * DAY_MS).toISOString(),
    },
    {
      post_id: "alum-4", dog_id: "biscuit-03", dog_name: "Biscuit", family_name: "Priya",
      text: "Biscuit needed a quiet home and that is exactly what we gave him. He trusts us more every day.",
      created_at: new Date(Date.now() - 20 * DAY_MS).toISOString(),
    },
  ];
}
