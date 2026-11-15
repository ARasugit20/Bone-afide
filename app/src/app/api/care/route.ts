import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { readDogs } from "@/lib/dogs";
import { fail, safe } from "@/lib/http";
import { CARE_LABELS, sortCare, viewCareItem } from "@/lib/care";
import { careForDog } from "@/lib/seed-extras";
import type { CareRecord, CareType } from "@/lib/types";

const CARE_TYPES: CareType[] = ["nail_trim", "bath", "vaccines", "vet_checkup", "flea_tick"];

// Care items per dog, each with next_due / overdue. Seeds records the first time.
export const GET = safe(async () => {
  const d = await db();
  const col = d.collection<CareRecord>("care");
  const dogs = await readDogs(d);
  if ((await col.estimatedDocumentCount()) === 0 && dogs.length) {
    const seed = dogs.flatMap((dog) => careForDog(dog.dog_id));
    if (seed.length) await col.insertMany(seed);
  }
  const records = await col.find({}, { projection: { _id: 0 } }).toArray();
  const byDog = new Map<string, CareRecord[]>();
  for (const r of records) {
    const list = byDog.get(r.dog_id);
    if (list) list.push(r);
    else byDog.set(r.dog_id, [r]);
  }
  const dogsOut = dogs.map((dog) => ({
    dog_id: dog.dog_id,
    name: dog.name,
    photo: dog.photo,
    items: sortCare((byDog.get(dog.dog_id) ?? []).map((r) => viewCareItem(r))),
  }));
  return NextResponse.json({ dogs: dogsOut });
});

// Mark a care item done today (resets last_date to now).
export const POST = safe(async (req: NextRequest) => {
  const { dog_id, type } = (await req.json()) as { dog_id?: string; type?: CareType };
  if (!dog_id || !type || !CARE_TYPES.includes(type)) return fail("dog_id and a valid type are required", 400);
  const d = await db();
  const today = new Date().toISOString().slice(0, 10);
  await d.collection<CareRecord>("care").updateOne(
    { dog_id, type },
    { $set: { dog_id, type, last_date: today }, $setOnInsert: { interval_days: 30 } },
    { upsert: true },
  );
  return NextResponse.json({ ok: true, dog_id, type, last_date: today, label: CARE_LABELS[type] });
});
