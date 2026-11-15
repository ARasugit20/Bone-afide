// One-off: make Mongo staff_notes and Supermemory agree.
// 1) Seed notes (already in Supermemory from scripts/seed.ts) are added to each seed dog's Mongo staff_notes.
// 2) Any Mongo note not yet in Supermemory is indexed there.
// Usage: npx tsx --env-file=.env.local scripts/sync-notes.ts
import { closeDb, db } from "../src/lib/db";
import { indexPendingNotes } from "../src/lib/notes";
import { seedNotes } from "../src/lib/seed-data";
import type { StaffNote } from "../src/lib/types";

async function main() {
  const d = await db();
  const dogs = d.collection("dogs");
  for (const [dogId, notes] of Object.entries(seedNotes)) {
    const doc = await dogs.findOne({ dog_id: dogId }, { projection: { staff_notes: 1 } });
    if (!doc) continue;
    const have = new Set(((doc.staff_notes ?? []) as StaffNote[]).map((n) => n.note));
    const missing: StaffNote[] = notes
      .filter((n) => !have.has(n.text))
      .map((n) => ({ author: n.author, note: n.text, day: n.day, created_at: new Date(Date.now() - (8 - n.day) * 86_400_000).toISOString(), indexed: true }));
    if (missing.length) await dogs.updateOne({ dog_id: dogId }, { $push: { staff_notes: { $each: missing } } } as never);
    console.log(`${dogId}: added ${missing.length} seed notes to Mongo`);
  }
  for (const { dog_id } of await dogs.find({}, { projection: { dog_id: 1 } }).toArray()) {
    const n = await indexPendingNotes(d, dog_id);
    if (n) console.log(`${dog_id}: indexed ${n} notes in Supermemory`);
  }
}

main()
  .catch((err) => {
    console.error("sync failed:", err.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
