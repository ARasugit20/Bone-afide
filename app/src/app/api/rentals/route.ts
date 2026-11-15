import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, safe } from "@/lib/http";

export const GET = safe(async (req: NextRequest) => {
  const dogId = req.nextUrl.searchParams.get("dog_id");
  if (!dogId) return fail("dog_id is required", 400);
  const rentals = await (await db()).collection("rentals").find({ dog_id: dogId }, { projection: { _id: 0 } }).toArray();
  return NextResponse.json(rentals);
});
