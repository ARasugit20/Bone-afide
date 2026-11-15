import { closeDb, db } from "../src/lib/db";
import { seedFamilies } from "../src/lib/seed-data";

// Families only. Real dogs now come from the video pipeline, so this never reads or writes `dogs`.
async function main() {
  const d = await db();
  const families = d.collection("families");
  for (const family of seedFamilies) {
    await families.updateOne({ family_id: family.family_id }, { $set: family }, { upsert: true });
  }
  await families.createIndex({ family_id: 1 }, { unique: true });
  console.log(`Upserted ${seedFamilies.length} families; dogs collection left untouched`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
