import { NextResponse, type NextRequest } from "next/server";
import { bedrockLabel } from "@/lib/bedrock";
import { db } from "@/lib/db";
import { readDog } from "@/lib/dogs";
import { fail, safe } from "@/lib/http";
import { plain } from "@/lib/text";
import type { Dog } from "@/lib/types";

function withReportLabel(dog: Dog): Dog {
  if (!dog.behavior_report) return dog;
  return {
    ...dog,
    behavior_report: plain(dog.behavior_report),
    behavior_report_by: dog.behavior_report_provider === "bedrock" ? bedrockLabel() : dog.behavior_report_provider,
  };
}

export const GET = safe(async (_req: NextRequest, ctx: RouteContext<"/api/dogs/[id]">) => {
  const { id } = await ctx.params;
  const dog = await readDog(await db(), id);
  return dog ? NextResponse.json(withReportLabel(dog)) : fail("Dog not found", 404);
});

// Only expert_reviewed can be changed here (vet sign-off). Behavior scores come from the pipeline.
export const PATCH = safe(async (req: NextRequest, ctx: RouteContext<"/api/dogs/[id]">) => {
  const { id } = await ctx.params;
  const { expert_reviewed } = await req.json();
  if (typeof expert_reviewed !== "boolean") return fail("expert_reviewed (boolean) is required", 400);
  const d = await db();
  const res = await d.collection("dogs").updateOne({ dog_id: id }, { $set: { expert_reviewed } });
  if (!res.matchedCount) return fail("Dog not found", 404);
  const dog = await readDog(d, id);
  return dog ? NextResponse.json(withReportLabel(dog)) : fail("Dog record is incomplete right now. Try again shortly.", 409);
});
