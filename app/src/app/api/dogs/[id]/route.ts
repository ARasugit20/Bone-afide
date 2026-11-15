import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, safe } from "@/lib/http";

export const GET = safe(async (_req: NextRequest, ctx: RouteContext<"/api/dogs/[id]">) => {
  const { id } = await ctx.params;
  const dog = await (await db()).collection("dogs").findOne({ dog_id: id }, { projection: { _id: 0 } });
  return dog ? NextResponse.json(dog) : fail("Dog not found", 404);
});

// Only expert_reviewed can be changed here (vet sign-off); behavior scores come from the pipeline.
export const PATCH = safe(async (req: NextRequest, ctx: RouteContext<"/api/dogs/[id]">) => {
  const { id } = await ctx.params;
  const { expert_reviewed } = await req.json();
  if (typeof expert_reviewed !== "boolean") return fail("expert_reviewed (boolean) is required", 400);
  const dog = await (await db())
    .collection("dogs")
    .findOneAndUpdate({ dog_id: id }, { $set: { expert_reviewed } }, { returnDocument: "after", projection: { _id: 0 } });
  return dog ? NextResponse.json(dog) : fail("Dog not found", 404);
});
