import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { readDog } from "@/lib/dogs";
import { fail, safe } from "@/lib/http";

export const GET = safe(async (_req: NextRequest, ctx: RouteContext<"/api/dogs/[id]">) => {
  const { id } = await ctx.params;
  const dog = await readDog(await db(), id);
  return dog ? NextResponse.json(dog) : fail("Dog not found", 404);
});

// Only expert_reviewed can be changed here (vet sign-off); behavior scores come from the pipeline.
export const PATCH = safe(async (req: NextRequest, ctx: RouteContext<"/api/dogs/[id]">) => {
  const { id } = await ctx.params;
  const { expert_reviewed } = await req.json();
  if (typeof expert_reviewed !== "boolean") return fail("expert_reviewed (boolean) is required", 400);
  const d = await db();
  const res = await d.collection("dogs").updateOne({ dog_id: id }, { $set: { expert_reviewed } });
  if (!res.matchedCount) return fail("Dog not found", 404);
  const dog = await readDog(d, id);
  return dog ? NextResponse.json(dog) : fail("Dog record is incomplete right now — try again shortly", 409);
});
