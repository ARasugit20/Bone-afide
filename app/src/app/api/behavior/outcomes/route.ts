import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { readDog } from "@/lib/dogs";
import { fail, safe } from "@/lib/http";

export const GET = safe(async (req: NextRequest) => {
  const dog_id = req.nextUrl.searchParams.get("dog_id");
  const rows = await (await db()).collection("post_adoption_outcomes").find(dog_id ? { dog_id } : {}, { projection: { _id: 0 } }).sort({ check_in_date: -1 }).toArray();
  return NextResponse.json(rows);
});

export const POST = safe(async (req: Request) => {
  const b = await req.json(); const dog_id = String(b.dog_id ?? "");
  const adoption_date = String(b.adoption_date ?? ""); const check_in_date = String(b.check_in_date ?? "");
  if (!dog_id || !Number.isFinite(Date.parse(adoption_date)) || !Number.isFinite(Date.parse(check_in_date))) return fail("dog_id, adoption_date, and check_in_date are required", 400);
  if (!(await readDog(await db(), dog_id))) return fail("Dog not found", 404);
  const record = { outcome_id: crypto.randomUUID(), dog_id, adoption_date: new Date(adoption_date).toISOString(), check_in_date: new Date(check_in_date).toISOString(),
    still_adopted: typeof b.still_adopted === "boolean" ? b.still_adopted : null,
    settling: ["yes", "somewhat", "not_yet"].includes(b.settling) ? b.settling : null,
    compatibility_feedback: String(b.compatibility_feedback ?? "").slice(0, 1000), behavioral_challenges: Array.isArray(b.behavioral_challenges) ? b.behavioral_challenges.map(String).slice(0, 20) : [],
    housing_challenge: String(b.housing_challenge ?? "").slice(0, 500), returned: typeof b.returned === "boolean" ? b.returned : null,
    return_reason: String(b.return_reason ?? "").slice(0, 500), note: String(b.note ?? "").slice(0, 1000), created_at: new Date().toISOString(), feeds_training_automatically: false };
  await (await db()).collection("post_adoption_outcomes").insertOne(record);
  return NextResponse.json(record, { status: 201 });
});
