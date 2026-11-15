import type { Db } from "mongodb";
import type { Dog } from "./types";

export type ReviewStatus = "unreviewed" | "confirmed" | "rejected" | "corrected";
export type Observation = {
  observation_id: string;
  dog_id: string;
  dog_name: string;
  session_id: string;
  day: number;
  start_s: number;
  end_s: number;
  machine_label: string;
  confidence?: number;
  video_url?: string;
  source: "pipeline";
  pipeline_version?: string;
  review_status: ReviewStatus;
  review?: { reviewer: string; reviewed_at: string; review_status: ReviewStatus; original_label: string; corrected_label?: string; context?: string; note?: string };
};

export function observationId(dogId: string, day: number, event: { type: string; start_s: number; end_s: number }) {
  return `${dogId}:${day}:${event.type}:${event.start_s}:${event.end_s}`;
}
export async function listObservations(d: Db, dogs: Dog[]) {
  const rawReviews = await d.collection("behavior_observation_reviews").find({}, { projection: { _id: 0 } }).toArray();
  const reviews = new Map(rawReviews.map((r) => [String(r.observation_id), r]));
  return dogs.flatMap((dog) => (dog.events ?? []).map((event) => {
    const id = observationId(dog.dog_id, dog.day, event);
    const review = reviews.get(id) as Observation["review"] | undefined;
    return {
      observation_id: id, dog_id: dog.dog_id, dog_name: dog.name, session_id: `${dog.dog_id}:day-${dog.day}`,
      day: dog.day, start_s: event.start_s, end_s: event.end_s, machine_label: event.label,
      ...(dog.video_url ? { video_url: dog.video_url } : {}), source: "pipeline" as const,
      pipeline_version: typeof dog.pipeline_version === "string" ? dog.pipeline_version : undefined,
      review_status: (review?.review_status ?? "unreviewed") as ReviewStatus, ...(review ? { review } : {}),
    } as Observation;
  }));
}

export function qualitySummary(dog: Dog) {
  const evidence = dog.evidence;
  const coverage = (evidence as (typeof evidence & { detection_coverage?: number }) | undefined)?.detection_coverage;
  if (typeof coverage === "number" && Number.isFinite(coverage)) {
    const pct = coverage <= 1 ? coverage * 100 : coverage;
    const level = pct >= 80 ? "High" : pct >= 50 ? "Moderate" : "Low";
    return { level, detection_coverage_pct: Math.round(pct), basis: "pipeline detection coverage" };
  }
  return { level: "Unrated", basis: "This session did not persist video-quality metrics." };
}

export function compareSessions(previous: Record<string, unknown>, current: Record<string, unknown>) {
  const metrics = ["stress", "energy", "approachability", "confidence", "arousal_spikes"] as const;
  return metrics.flatMap((key) => {
    const before = Number(previous[key]); const after = Number(current[key]);
    return Number.isFinite(before) && Number.isFinite(after)
      ? [{ metric: key, previous: before, current: after, change: after - before }]
      : [];
  });
}
