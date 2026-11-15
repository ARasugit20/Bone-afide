import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, safe } from "@/lib/http";
import { readDog } from "@/lib/dogs";

const TYPES = ["quieter_kennel", "enrichment", "foster_sleepover", "staff_interaction", "exercise_walk", "medical_review", "training", "housing_change", "other"];
export const GET = safe(async (req: NextRequest) => {
  const dog_id = req.nextUrl.searchParams.get("dog_id");
  const rows = await (await db()).collection("behavior_interventions").find(dog_id ? { dog_id } : {}, { projection: { _id: 0 } }).sort({ occurred_at: -1 }).toArray();
  return NextResponse.json(rows);
});
export const POST = safe(async (req: Request) => {
  const b = await req.json(); const dog_id = String(b.dog_id ?? ""); const type = String(b.type ?? "");
  const occurred_at = String(b.occurred_at ?? ""); const staff = String(b.staff ?? "Shelter staff").trim().slice(0, 100);
  const notes = String(b.notes ?? "").trim().slice(0, 1000); const concern = String(b.concern ?? "").trim().slice(0, 200);
  if (!dog_id || !TYPES.includes(type) || !Number.isFinite(Date.parse(occurred_at))) return fail("dog_id, valid intervention type, and date are required", 400);
  if (!(await readDog(await db(), dog_id))) return fail("Dog not found", 404);
  const record = { intervention_id: crypto.randomUUID(), dog_id, type, occurred_at: new Date(occurred_at).toISOString(), staff: staff || "Shelter staff", notes, concern, context: String(b.context ?? "").slice(0, 60), outcome_note: "", created_at: new Date().toISOString() };
  await (await db()).collection("behavior_interventions").insertOne(record);
  return NextResponse.json(record, { status: 201 });
});
export const PATCH = safe(async (req: Request) => {
  const b = await req.json(); const intervention_id = String(b.intervention_id ?? ""); const outcome_note = String(b.outcome_note ?? "").trim().slice(0, 1000);
  if (!intervention_id) return fail("intervention_id is required", 400);
  const d = await db();
  const existing = await d.collection("behavior_interventions").findOne({ intervention_id });
  if (!existing) return fail("Intervention not found", 404);
  const set: Record<string, unknown> = { outcome_note, outcome_updated_at: new Date().toISOString() };
  const dog = await d.collection("dogs").findOne({ dog_id: existing.dog_id }, { projection: { history: 1 } });
  const validDays = new Set((Array.isArray(dog?.history) ? dog.history : []).map((s: { day?: unknown }) => Number(s.day)));
  for (const key of ["before_day", "after_day"] as const) {
    if (b[key] === "" || b[key] === null || b[key] === undefined) { set[key] = null; continue; }
    const day = Number(b[key]);
    if (!Number.isInteger(day) || !validDays.has(day)) return fail(`${key} must refer to a stored session`, 400);
    set[key] = day;
  }
  if (typeof set.before_day === "number" && typeof set.after_day === "number" && set.before_day >= set.after_day) return fail("After session must be later than before session", 400);
  const r = await d.collection("behavior_interventions").updateOne({ intervention_id }, { $set: set });
  return r.matchedCount ? NextResponse.json({ saved: true }) : fail("Intervention not found", 404);
});
