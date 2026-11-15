import { NextResponse, type NextRequest } from "next/server";
import { bedrock, bedrockLabel } from "@/lib/bedrock";
import { db } from "@/lib/db";
import { readDog } from "@/lib/dogs";
import { fail, safe } from "@/lib/http";
import { plain } from "@/lib/text";

// Adopter-facing summary for the passport. Written by Amazon Bedrock, cached in Mongo.
export const POST = safe(async (req: NextRequest, ctx: RouteContext<"/api/passport/[dogId]">) => {
  const { dogId } = await ctx.params;
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const d = await db();
  const passports = d.collection("passports");

  const cached = await passports.findOne({ dog_id: dogId }, { projection: { _id: 0 } });
  // Older cached entries didn't record which model wrote them; regenerate those so the label is accurate.
  if (cached?.provider && !fresh) return NextResponse.json({ ...cached, summary: plain(String(cached.summary)), cached: true });

  const dog = await readDog(d, dogId);
  if (!dog) return fail("Dog not found", 404);
  const behavior = {
    name: dog.name,
    days_observed: dog.day,
    energy: dog.energy,
    stress: dog.stress,
    approachability: dog.approachability,
    confidence: dog.confidence,
    excitement_spikes_per_session: dog.arousal_spikes,
    handling_level: dog.handling_level,
    needs: dog.needs,
  };

  const prompt = `Write exactly 3 short, plain sentences introducing this shelter dog to people thinking about adopting.
Use only the behavior data below. Do not mention or guess breed.
Do not use the words "aggressive", "dangerous" or "menace"; describe needs instead.
Do not use dashes, exclamation marks or marketing language. Output only the 3 sentences.

${JSON.stringify(behavior)}`;

  const out = await bedrock(prompt);
  const passport = {
    dog_id: dogId,
    summary: plain(out.text.trim()),
    provider: out.provider,
    model: out.model,
    label: out.provider === "bedrock" ? bedrockLabel(out.model) : "Gemini",
    created_at: new Date(),
  };
  await passports.replaceOne({ dog_id: dogId }, passport, { upsert: true });
  return NextResponse.json({ ...passport, cached: false });
});
