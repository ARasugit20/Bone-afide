import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safe } from "@/lib/http";

export const GET = safe(async () => {
  const dogs = await (await db()).collection("dogs").find({}, { projection: { _id: 0 } }).toArray();
  return NextResponse.json(dogs);
});
