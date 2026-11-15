import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readDogs } from "@/lib/dogs";
import { safe } from "@/lib/http";
import { matchShelter } from "@/lib/match";
import type { Family, Match, MatchRun } from "@/lib/types";

// Last saved run, read live from MongoDB Atlas. `ran` is false until POST has been called at least once.
export const GET = safe(async () => {
  const d = await db();
  const matches = await d.collection<Match>("matches").find({}, { projection: { _id: 0 } }).toArray();
  const run = await d.collection<MatchRun>("match_runs").find({}, { projection: { _id: 0 } }).sort({ ran_at: -1 }).limit(1).next();
  const dogIds = (await readDogs(d)).map((x) => x.dog_id);
  const matched = new Set(matches.map((m) => m.dog_id));
  return NextResponse.json({
    ran: matches.length > 0,
    matches,
    unmatched: matches.length ? dogIds.filter((id) => !matched.has(id)) : [],
    last_run: run ?? null,
  });
});

export const POST = safe(async () => {
  const d = await db();
  const dogs = await readDogs(d);
  const families = await d.collection<Family>("families").find({}, { projection: { _id: 0 } }).toArray();
  const result = matchShelter(dogs, families);

  await d.collection("matches").deleteMany({});
  if (result.matches.length) await d.collection("matches").insertMany(result.matches.map((m) => ({ ...m })));
  const last_run: MatchRun = { ran_at: new Date().toISOString(), dogs: dogs.length, families: families.length, matches: result.matches.length };
  await d.collection("match_runs").insertOne({ ...last_run });

  return NextResponse.json({ ...result, ran: true, last_run });
});
