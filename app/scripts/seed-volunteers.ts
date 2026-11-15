// Seeds 6 sample volunteers into Mongo `volunteers` (replaces existing ones with the same id).
// Usage: npx tsx --env-file=.env.local scripts/seed-volunteers.ts
import { closeDb, db } from "../src/lib/db";
import type { Volunteer } from "../src/lib/types";

const VOLUNTEERS: Volunteer[] = [
  { volunteer_id: "v-maya", name: "Maya Torres", experience: "any", shifts: ["Sat 9 to 12", "Sun 9 to 12"] },
  { volunteer_id: "v-ben", name: "Ben Okafor", experience: "any", shifts: ["Wed 4 to 7"] },
  { volunteer_id: "v-priya", name: "Priya Shah", experience: "some", shifts: ["Mon 8 to 11", "Thu 8 to 11"] },
  { volunteer_id: "v-luis", name: "Luis Romero", experience: "some", shifts: ["Tue 5 to 8"] },
  { volunteer_id: "v-hannah", name: "Hannah Kim", experience: "experienced", shifts: ["Mon 1 to 5", "Fri 1 to 5"] },
  { volunteer_id: "v-dana", name: "Dana Whitfield", experience: "staff", shifts: ["Mon to Fri 7 to 3"] },
];

async function main() {
  const col = (await db()).collection<Volunteer>("volunteers");
  for (const v of VOLUNTEERS) await col.replaceOne({ volunteer_id: v.volunteer_id }, v, { upsert: true });
  await col.createIndex({ volunteer_id: 1 }, { unique: true });
  console.log(`seeded ${VOLUNTEERS.length} volunteers`);
}

main()
  .catch((err) => {
    console.error("seed failed:", err.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
