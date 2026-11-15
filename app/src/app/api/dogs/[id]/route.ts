import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, safe } from "@/lib/http";

export const GET = safe(async (_req: NextRequest, ctx: RouteContext<"/api/dogs/[id]">) => {
  const { id } = await ctx.params;
  const dog = await (await db()).collection("dogs").findOne({ dog_id: id }, { projection: { _id: 0 } });
  return dog ? NextResponse.json(dog) : fail("Dog not found", 404);
});
