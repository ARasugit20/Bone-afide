import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { readDogs } from "@/lib/dogs";
import { EXPERIENCE_RANK } from "@/lib/dogs";
import { fail, safe } from "@/lib/http";
import { suggestPlaygroups } from "@/lib/playgroups";
import type { Dog, Playdate, Volunteer } from "@/lib/types";

// Suggested safe groups + scheduled playdates.
export const GET = safe(async () => {
  const d = await db();
  const dogs = await readDogs(d);
  const byId = new Map(dogs.map((x) => [x.dog_id, x]));
  const groups = suggestPlaygroups(dogs).map((g) => ({
    ...g,
    dogs: g.dog_ids.map((id) => {
      const dog = byId.get(id);
      return dog ? { dog_id: dog.dog_id, name: dog.name, photo: dog.photo, energy: dog.energy, handling_level: dog.handling_level } : { dog_id: id };
    }),
  }));
  const playdates = await d.collection<Playdate>("playdates").find({}, { projection: { _id: 0 } }).sort({ scheduled_for: 1 }).toArray();
  return NextResponse.json({ groups, playdates });
});

// Schedule a playdate for a set of dogs, assigning a volunteer at the right level.
export const POST = safe(async (req: NextRequest) => {
  const { dog_ids, scheduled_for } = (await req.json()) as { dog_ids?: string[]; scheduled_for?: string };
  if (!Array.isArray(dog_ids) || dog_ids.length < 2) return fail("dog_ids (2 or more) are required", 400);
  const d = await db();
  const dogs = (await readDogs(d)).filter((x) => dog_ids.includes(x.dog_id));
  if (dogs.length < 2) return fail("dogs not found", 404);

  // Need a volunteer whose experience covers the hardest dog in the group.
  const need = Math.max(...dogs.map((dog: Dog) => EXPERIENCE_RANK[dog.handler?.min_experience ?? "any"]));
  const volunteers = await d.collection<Volunteer>("volunteers").find({}, { projection: { _id: 0 } }).toArray();
  const picked = volunteers
    .filter((v) => EXPERIENCE_RANK[v.experience] >= need)
    .sort((a, b) => EXPERIENCE_RANK[a.experience] - EXPERIENCE_RANK[b.experience])[0];

  const playdate: Playdate = {
    playdate_id: randomUUID(),
    dog_ids,
    scheduled_for: scheduled_for || new Date(Date.now() + 86_400_000).toISOString(),
    volunteer_id: picked?.volunteer_id,
    volunteer_name: picked?.name,
    created_at: new Date().toISOString(),
  };
  await d.collection<Playdate>("playdates").insertOne({ ...playdate });
  return NextResponse.json({ playdate, assigned: Boolean(picked) });
});
