import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readDog } from "@/lib/dogs";
import { fail, safe } from "@/lib/http";
const CONTEXTS = ["kennel", "walk", "foster", "meet-and-greet", "play", "intake", "other"];
export const GET = safe(async (req: Request) => {
  const url = new URL(req.url); const dog_id = url.searchParams.get("dog_id");
  if (!dog_id) return fail("dog_id is required", 400);
  const rows = await (await db()).collection("behavior_session_contexts").find({ dog_id }, { projection: { _id: 0 } }).toArray();
  return NextResponse.json(rows);
});
export const PATCH = safe(async (req: Request) => {
  const b = await req.json(); const dog_id = String(b.dog_id ?? ""); const session_id = String(b.session_id ?? ""); const context = String(b.context ?? "");
  if (!dog_id || !session_id || !CONTEXTS.includes(context)) return fail("dog_id, session_id, and valid context are required", 400);
  if (!(await readDog(await db(), dog_id))) return fail("Dog not found", 404);
  const record = { dog_id, session_id, context, updated_at: new Date().toISOString() };
  await (await db()).collection("behavior_session_contexts").updateOne({ dog_id, session_id }, { $set: record }, { upsert: true });
  return NextResponse.json(record);
});
