import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fail, safe } from "@/lib/http";
import { pipelineFetch } from "@/lib/pipeline";

export const maxDuration = 900;
const MAX_BYTES = 200 * 1024 * 1024;

// Sends a kennel video to the pipeline's /analyze (YOLO11 tracking, camera-shake compensation, scoring).
// The pipeline writes the dog to MongoDB, the reading to Tiger Data, and the media to S3 (in the background).
export const POST = safe(async (req: Request) => {
  const form = await req.formData();
  const video = form.get("video");
  const dogId = String(form.get("dog_id") ?? "").trim().toLowerCase();
  const day = Number(form.get("day") ?? 1);
  const name = String(form.get("name") ?? "").trim().slice(0, 40);
  if (!(video instanceof File) || !video.size) return fail("Choose a video file.", 400);
  if (!video.type.startsWith("video/")) return fail("That file isn't a video.", 415);
  if (video.size > MAX_BYTES) return fail("Videos must be under 200 MB.", 413);
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(dogId)) return fail("Dog ID can use lowercase letters, numbers and dashes, like luna-01.", 400);
  if (!Number.isInteger(day) || day < 1 || day > 365) return fail("Day must be a whole number from 1 to 365.", 400);

  const out = new FormData();
  out.set("video", video, video.name);
  out.set("dog_id", dogId);
  out.set("day", String(day));
  out.set("hour", String(new Date().getHours()));
  if (name) out.set("name", name);

  let res: Response;
  try {
    res = await pipelineFetch("/analyze", { method: "POST", body: out, timeoutMs: 15 * 60_000 });
  } catch {
    return fail("The behavior pipeline isn't reachable right now.", 503);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return fail(String(data.detail ?? `Analysis failed (${res.status})`), res.status >= 500 ? 502 : 400);

  // The pipeline saves its own dogs (the five real dogs and any upload-* id) and reports it in `stored`.
  // For anything it refuses (e.g. a seed dog), save the returned scores here so the dog still updates.
  const summary = data.summary as Record<string, unknown> | null;
  const storedByPipeline = Boolean(data.stored?.mongo);
  if (summary && typeof summary.handling_level === "string" && !storedByPipeline) {
    const fields = ["day", "energy", "stress", "approachability", "confidence", "arousal_spikes", "handling_level", "trend", "needs"] as const;
    const set: Record<string, unknown> = Object.fromEntries(fields.filter((k) => summary[k] !== undefined).map((k) => [k, summary[k]]));
    set.updated_at = new Date().toISOString();
    set.source = "app-upload";
    if (Array.isArray(data.events)) set.events = data.events;
    if (data.welfare) set.welfare = data.welfare;
    await (await db()).collection("dogs").updateOne(
      { dog_id: dogId },
      { $set: set, $setOnInsert: { dog_id: dogId, name: name || dogId.split("-")[0].replace(/^./, (c) => c.toUpperCase()), expert_reviewed: false } },
      { upsert: true },
    );
  }
  return NextResponse.json({ dog_id: dogId, name: data.name ?? name, summary: summary ?? null, stored: data.stored ?? null, saved_by: storedByPipeline ? "pipeline" : "app" });
});
