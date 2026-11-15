import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fail, safe } from "@/lib/http";
import { pipelineFetch } from "@/lib/pipeline";

export const maxDuration = 900;
const MAX_BYTES = 200 * 1024 * 1024;

// Sends a kennel video to the pipeline's /analyze (YOLO11 tracking, camera-shake compensation, scoring).
// The pipeline writes the scores to MongoDB and the readings to Tiger Data.
export const POST = safe(async (req: Request) => {
  const form = await req.formData();
  const video = form.get("video");
  const dogId = String(form.get("dog_id") ?? "").trim().toLowerCase();
  const day = Number(form.get("day") ?? 1);
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

  let res: Response;
  try {
    res = await pipelineFetch("/analyze", { method: "POST", body: out, timeoutMs: 15 * 60_000 });
  } catch {
    return fail("The behavior pipeline isn't reachable right now.", 503);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return fail(String(data.detail ?? `Analysis failed (${res.status})`), res.status >= 500 ? 502 : 400);

  // The pipeline only writes its own five dogs to MongoDB. For any other dog, save the scores it returned here
  // so the dog shows up in the app. Records the pipeline just wrote are left alone.
  const summary = data.summary as Record<string, unknown> | null;
  if (summary && typeof summary.handling_level === "string") {
    const dogs = (await db()).collection("dogs");
    const fresh = await dogs.findOne({ dog_id: dogId, updated_at: { $gte: new Date(Date.now() - 15 * 60_000).toISOString() } }, { projection: { _id: 1 } });
    if (!fresh) {
      const fields = ["day", "energy", "stress", "approachability", "confidence", "arousal_spikes", "handling_level", "trend", "needs"] as const;
      const set: Record<string, unknown> = Object.fromEntries(fields.filter((k) => summary[k] !== undefined).map((k) => [k, summary[k]]));
      set.updated_at = new Date().toISOString();
      set.source = "app-upload";
      await dogs.updateOne(
        { dog_id: dogId },
        { $set: set, $setOnInsert: { dog_id: dogId, name: dogId.split("-")[0].replace(/^./, (c) => c.toUpperCase()), expert_reviewed: false } },
        { upsert: true },
      );
    }
  }
  return NextResponse.json({ dog_id: dogId, summary: summary ?? null });
});
