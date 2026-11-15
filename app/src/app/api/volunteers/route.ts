import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readDogs } from "@/lib/dogs";
import { safe } from "@/lib/http";
import type { Volunteer } from "@/lib/types";
import { assignDogs } from "@/lib/volunteers";

// Today's handling roster: volunteers from Mongo, dogs assigned by handler.min_experience.
export const GET = safe(async () => {
  const d = await db();
  const [dogs, volunteers] = await Promise.all([readDogs(d), d.collection<Volunteer>("volunteers").find({}, { projection: { _id: 0 } }).toArray()]);
  return NextResponse.json(assignDogs(dogs, volunteers));
});
