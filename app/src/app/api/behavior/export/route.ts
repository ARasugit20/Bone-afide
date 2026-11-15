import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { compareSessions, listObservations, qualitySummary } from "@/lib/behavior-intelligence";
import { readDogs } from "@/lib/dogs";
import { safe } from "@/lib/http";

export const GET = safe(async (req: NextRequest) => {
  const d = await db(); const dogs = await readDogs(d); const dog_id = req.nextUrl.searchParams.get("dog_id");
  const format = req.nextUrl.searchParams.get("format") ?? "json";
  if (req.nextUrl.searchParams.has("training")) {
    const dogsWithEvents = await readDogs(d);
    const source = await listObservations(d, dogsWithEvents);
    const reviews = await d.collection("behavior_observation_reviews").find({ review_status: { $in: ["confirmed", "corrected"] } }, { projection: { _id: 0, history: 0 } }).toArray();
    const byId = new Map(source.map((o) => [o.observation_id, o]));
    const observations = reviews.map((review) => ({ ...byId.get(String(review.observation_id)), ...review,
      confidence: byId.get(String(review.observation_id))?.confidence ?? null,
      evidence_reference: byId.get(String(review.observation_id))?.video_url ?? null,
      pipeline_version: byId.get(String(review.observation_id))?.pipeline_version ?? null }));
    return NextResponse.json({ schema: "boneafide.training-observations.v1", automatic_retraining: false, observations });
  }
  const chosen = dogs.filter((dog) => !dog_id || dog.dog_id === dog_id);
  const observations = await listObservations(d, chosen);
  const records = await Promise.all(chosen.map(async (dog) => {
    const raw = await d.collection("dogs").findOne({ dog_id: dog.dog_id }, { projection: { history: 1, pipeline_version: 1 } });
    const history = Array.isArray(raw?.history) ? raw.history as Record<string, unknown>[] : [];
    const contexts = await d.collection("behavior_session_contexts").find({ dog_id: dog.dog_id }, { projection: { _id: 0 } }).toArray();
    const contextBySession = new Map(contexts.map((c) => [String(c.session_id), String(c.context)]));
    const ordered = [...history].sort((a, b) => Number(a.day) - Number(b.day));
    const current = ordered.at(-1); const previous = ordered.at(-2);
    const sessions: (Record<string, unknown> & { session_id: string; context: string })[] = ordered.map((s) => { const session_id = `${dog.dog_id}:day-${s.day}`; return { ...s, session_id, context: contextBySession.get(session_id) ?? "unspecified" }; });
    return { dog_id: dog.dog_id, name: dog.name, handling_level: dog.handling_level,
      sessions,
      observations: observations.filter((o) => o.dog_id === dog.dog_id), quality: qualitySummary(dog),
      session_change: previous && current ? compareSessions(previous, current) : [],
      interventions: await d.collection("behavior_interventions").find({ dog_id: dog.dog_id }, { projection: { _id: 0 } }).toArray(),
      pipeline_version: raw?.pipeline_version ?? null,
    };
  }));
  const payload = { schema: "boneafide.behavior-record.v1", generated_at: new Date().toISOString(), records };
  if (format === "csv") {
    const rows = records.flatMap((r) => r.sessions.map((s) => [r.dog_id, s.day, s.stress, s.energy, s.approachability, s.confidence, s.arousal_spikes]));
    const csv = ["dog_id,day,stress,energy,approachability,confidence,arousal_spikes", ...rows.map((row) => row.map((v) => JSON.stringify(v ?? "")).join(","))].join("\n");
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=boneafide-behavior.csv" } });
  }
  return NextResponse.json(payload);
});
