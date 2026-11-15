import type { Db } from "mongodb";
import { addMemory, dogTag } from "./memory";
import type { StaffNote } from "./types";

export const memoryText = (n: StaffNote) => `${n.day ? `Day ${n.day}, ` : ""}${n.author}: ${n.note}`;

/** Copies any of this dog's Mongo notes that aren't in Supermemory yet (e.g. added through the pipeline API). */
export async function indexPendingNotes(d: Db, dogId: string): Promise<number> {
  const doc = await d.collection("dogs").findOne({ dog_id: dogId }, { projection: { staff_notes: 1 } });
  const notes = (doc?.staff_notes ?? []) as StaffNote[];
  let added = 0;
  for (const n of notes) {
    if (n.indexed || !n.note) continue;
    if (await addMemory(dogTag(dogId), memoryText(n))) {
      n.indexed = true;
      added++;
    }
  }
  if (added) await d.collection("dogs").updateOne({ dog_id: dogId }, { $set: { staff_notes: notes } });
  return added;
}
