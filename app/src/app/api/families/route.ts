import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fail, safe } from "@/lib/http";
import type { Family } from "@/lib/types";

export const GET = safe(async () => {
  const families = await (await db()).collection("families").find({}, { projection: { _id: 0 } }).toArray();
  return NextResponse.json(families);
});

export const POST = safe(async (req: Request) => {
  const family = (await req.json()) as Family;
  if (!family.family_id || !family.name) return fail("family_id and name are required", 400);
  await (await db()).collection("families").replaceOne({ family_id: family.family_id }, family, { upsert: true });
  return NextResponse.json(family);
});
