import { NextResponse, type NextRequest } from "next/server";
import { bedrock } from "@/lib/bedrock";
import { db } from "@/lib/db";
import { readDog } from "@/lib/dogs";
import { fail, safe } from "@/lib/http";

export const POST = safe(async (_req: NextRequest, ctx: RouteContext<"/api/passport/[dogId]">) => {
  const { dogId } = await ctx.params;
  const d = await db();
  const passports = d.collection("passports");

  const cached = await passports.findOne({ dog_id: dogId }, { projection: { _id: 0 } });
  if (cached) return NextResponse.json({ ...cached, cached: true });

  const dog = await readDog(d, dogId);
  if (!dog) return fail("Dog not found", 404);
  const behavior: Partial<typeof dog> = { ...dog };
  delete behavior.updated_at; // keep the prompt to behavior only

  const prompt = `Write exactly 3 warm, plain-English sentences introducing this shelter dog to potential adopters.
Base it only on the behavior data below. Never mention or guess breed.
Never use the words "aggressive", "dangerous", or "menace"; describe the handling level and needs instead.
Output only the 3 sentences.

${JSON.stringify(behavior)}`;

  const summary = (await bedrock(prompt)).trim();
  const passport = { dog_id: dogId, summary, created_at: new Date() };
  await passports.insertOne({ ...passport });
  return NextResponse.json({ ...passport, cached: false });
});
