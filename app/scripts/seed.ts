import { closeDb, db } from "../src/lib/db";
import { addMemory, dogTag } from "../src/lib/memory";
import { seedDogs, seedFamilies, seedNotes } from "../src/lib/seed-data";

async function main() {
  const d = await db();
  await Promise.all(["dogs", "families", "matches", "passports"].map((c) => d.collection(c).deleteMany({})));
  await d.collection("dogs").insertMany(seedDogs.map((x) => ({ ...x })));
  await d.collection("families").insertMany(seedFamilies.map((x) => ({ ...x })));
  await d.collection("dogs").createIndex({ dog_id: 1 }, { unique: true });
  await d.collection("families").createIndex({ family_id: 1 }, { unique: true });
  console.log(`Inserted ${seedDogs.length} dogs and ${seedFamilies.length} families`);

  let ok = 0;
  let total = 0;
  for (const [dogId, notes] of Object.entries(seedNotes)) {
    for (const n of notes) {
      total++;
      if (await addMemory(dogTag(dogId), `Day ${n.day}, ${n.author}: ${n.text}`)) ok++;
    }
  }
  console.log(`Saved ${ok}/${total} volunteer notes to Supermemory`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
