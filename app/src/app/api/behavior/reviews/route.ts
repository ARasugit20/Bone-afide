import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { listObservations } from "@/lib/behavior-intelligence";
import { readDogs } from "@/lib/dogs";
import { fail, safe } from "@/lib/http";

export const GET = safe(async (req: NextRequest) => {
  const d = await db();
  const observations = await listObservations(d, await readDogs(d));
  const p = req.nextUrl.searchParams;
  const status = p.get("status"); const dog = p.get("dog"); const behavior = p.get("behavior"); const session = p.get("session")?.toLowerCase();
  const minConfidence = Number(p.get("min_confidence"));
  return NextResponse.json(observations.filter((o) => (!status || status === "all" || o.review_status === status)
    && (!dog || o.dog_id === dog) && (!behavior || o.machine_label.toLowerCase().includes(behavior.toLowerCase()))
    && (!session || o.session_id.toLowerCase().includes(session) || String(o.day) === session)
    && (!Number.isFinite(minConfidence) || !p.has("min_confidence") || (o.confidence !== undefined && o.confidence >= minConfidence)))
    .sort((a, b) => Number(a.review_status !== "unreviewed") - Number(b.review_status !== "unreviewed") || a.day - b.day || a.start_s - b.start_s));
});

export const PATCH = safe(async (req: Request) => {
  const body = await req.json();
  const observation_id = String(body.observation_id ?? "").trim();
  const status = String(body.status ?? "");
  const reviewer = String(body.reviewer ?? "Shelter staff").trim().slice(0, 100) || "Shelter staff";
  const context = String(body.context ?? "").trim().slice(0, 500);
  const note = String(body.note ?? "").trim().slice(0, 1000);
  const corrected_label = String(body.corrected_label ?? "").trim().slice(0, 100);
  if (!observation_id || !["confirmed", "rejected", "corrected"].includes(status)) return fail("observation_id and a valid review status are required", 400);
  if (status === "corrected" && !corrected_label) return fail("A corrected label is required", 400);
  const d = await db();
  const observations = await listObservations(d, await readDogs(d));
  const observation = observations.find((o) => o.observation_id === observation_id);
  if (!observation) return fail("Observation not found", 404);
  const reviewed_at = new Date().toISOString();
  const entry = { observation_id, dog_id: observation.dog_id, session_id: observation.session_id, machine_label: observation.machine_label,
    review_status: status, reviewer, reviewed_at, original_label: observation.machine_label,
    ...(status === "corrected" ? { corrected_label } : {}), ...(context ? { context } : {}), ...(note ? { note } : {}) };
  await d.collection("behavior_observation_reviews").updateOne({ observation_id },
    { $set: entry, $push: { history: entry } } as never, { upsert: true });
  return NextResponse.json(entry, { status: 201 });
});
