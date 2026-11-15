import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safe } from "@/lib/http";
import { matchShelter } from "@/lib/match";
import type { Dog, Family, Match } from "@/lib/types";

// Last saved run. `ran` is false until POST has been called at least once.
export const GET = safe(async () => {
  const d = await db();
  const matches = await d.collection<Match>("matches").find({}, { projection: { _id: 0 } }).toArray();
  const dogIds = (await d.collection<Dog>("dogs").find({}, { projection: { dog_id: 1 } }).toArray()).map((x) => x.dog_id);
  const matched = new Set(matches.map((m) => m.dog_id));
  return NextResponse.json({
    ran: matches.length > 0,
    matches,
    unmatched: matches.length ? dogIds.filter((id) => !matched.has(id)) : [],
  });
});

export const POST = safe(async () => {
  const d = await db();
  const dogs = await d.collection<Dog>("dogs").find({}, { projection: { _id: 0 } }).toArray();
  const families = await d.collection<Family>("families").find({}, { projection: { _id: 0 } }).toArray();
  const result = matchShelter(dogs, families);

  await d.collection("matches").deleteMany({});
  if (result.matches.length) await d.collection("matches").insertMany(result.matches.map((m) => ({ ...m })));

  return NextResponse.json(result);
});
