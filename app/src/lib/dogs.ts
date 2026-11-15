import type { Db } from "mongodb";
import type { Dog, HandlingLevel } from "./types";

const LEVELS: HandlingLevel[] = ["Green", "Yellow", "Orange", "Red"];
const TRENDS: Dog["trend"][] = ["improving", "stable", "worsening"];
const SCORES = ["energy", "stress", "approachability", "confidence"] as const;

const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));
const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, Math.round(n)));

/**
 * Pipeline docs may be partial, mid-update, or carry extra fields.
 * Returns a clean Dog, or null (with a warning) when the doc can't be trusted for matching.
 * Safety-relevant fields (level, scores, spikes) are never guessed — missing ones skip the doc.
 */
export function normalizeDog(raw: unknown): Dog | null {
  if (!raw || typeof raw !== "object") return skip(raw, "not an object");
  const r = raw as Record<string, unknown>;

  const dog_id = typeof r.dog_id === "string" || typeof r.dog_id === "number" ? String(r.dog_id).trim() : "";
  if (!dog_id) return skip(r, "missing dog_id");

  const level = typeof r.handling_level === "string" ? r.handling_level.trim() : "";
  const handling_level = LEVELS.find((l) => l.toLowerCase() === level.toLowerCase());
  if (!handling_level) return skip(r, `invalid handling_level "${level}"`, dog_id);

  const scores = {} as Record<(typeof SCORES)[number], number>;
  for (const key of SCORES) {
    const n = num(r[key]);
    if (!Number.isFinite(n)) return skip(r, `missing ${key}`, dog_id);
    scores[key] = clamp(n);
  }
  const spikes = num(r.arousal_spikes);
  if (!Number.isFinite(spikes)) return skip(r, "missing arousal_spikes", dog_id);

  const needs = Array.isArray(r.needs)
    ? r.needs.filter((n): n is string => typeof n === "string" && n.trim() !== "").map((n) => n.trim())
    : typeof r.needs === "string"
      ? r.needs.split(",").map((n) => n.trim()).filter(Boolean)
      : [];
  const trend = TRENDS.find((t) => t === r.trend) ?? "stable";
  const day = num(r.day);
  const updated = r.updated_at ? new Date(r.updated_at as string) : null;

  return {
    dog_id,
    name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : nameFromId(dog_id),
    day: Number.isFinite(day) && day >= 1 ? Math.round(day) : 1,
    ...scores,
    arousal_spikes: Math.max(0, Math.round(spikes)),
    handling_level,
    trend,
    needs,
    ...(typeof r.photo === "string" && r.photo ? { photo: r.photo } : {}),
    ...(typeof r.video_url === "string" && r.video_url.startsWith("http") ? { video_url: r.video_url } : {}),
    ...(typeof r.behavior_report === "string" && r.behavior_report.trim() ? { behavior_report: r.behavior_report.trim() } : {}),
    ...(r.behavior_report_at ? { behavior_report_at: String(r.behavior_report_at) } : {}),
    ...(typeof r.behavior_report_provider === "string" ? { behavior_report_provider: r.behavior_report_provider } : {}),
    expert_reviewed: r.expert_reviewed === true,
    ...(updated && !isNaN(updated.getTime()) ? { updated_at: updated.toISOString() } : {}),
  };
}

// "max-01" -> "Max"
function nameFromId(id: string) {
  const base = id.split(/[-_]/)[0] || id;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function skip(r: unknown, why: string, id?: string): null {
  console.warn(`[dogs] skipping ${id ? `dog "${id}"` : "doc"}: ${why}`, id ? "" : JSON.stringify(r)?.slice(0, 120));
  return null;
}

/** "Luna · 02" when another dog shares the display name; otherwise just the name. */
export function displayName(dog: { name: string; dog_id: string }, roster: { name: string; dog_id: string }[]): string {
  const key = dog.name.trim().toLowerCase();
  const shared = roster.filter((other) => other.name.trim().toLowerCase() === key).length > 1;
  if (!shared) return dog.name;
  const suffix = dog.dog_id.includes("-") ? dog.dog_id.slice(dog.dog_id.lastIndexOf("-") + 1) : dog.dog_id;
  return `${dog.name} · ${suffix}`;
}

export async function readDogs(d: Db): Promise<Dog[]> {
  const docs = await d.collection("dogs").find({}, { projection: { _id: 0 } }).toArray();
  return docs.map(normalizeDog).filter((x): x is Dog => x !== null);
}

export async function readDog(d: Db, dogId: string): Promise<Dog | null> {
  const doc = await d.collection("dogs").findOne({ dog_id: dogId }, { projection: { _id: 0 } });
  return doc ? normalizeDog(doc) : null;
}
