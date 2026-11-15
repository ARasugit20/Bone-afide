import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safe } from "@/lib/http";
import { matchShelter } from "@/lib/match";
import type { Dog, Family } from "@/lib/types";

export const POST = safe(async () => {
  const d = await db();
  const dogs = await d.collection<Dog>("dogs").find({}, { projection: { _id: 0 } }).toArray();
  const families = await d.collection<Family>("families").find({}, { projection: { _id: 0 } }).toArray();
  const result = matchShelter(dogs, families);

  await d.collection("matches").deleteMany({});
  if (result.matches.length) await d.collection("matches").insertMany(result.matches.map((m) => ({ ...m })));

  return NextResponse.json(result);
});
