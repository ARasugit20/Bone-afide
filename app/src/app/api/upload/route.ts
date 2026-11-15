import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fail, safe } from "@/lib/http";
import { PIPELINE_URL, pipelineFetch } from "@/lib/pipeline";
import { getObjectBytes, s3Config } from "@/lib/s3";
import type { UploadJob } from "@/lib/types";

const DOG_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const WAITING = "Video saved. Analysis runs when the pipeline server is connected.";

async function update(uploadId: string, patch: Partial<UploadJob>) {
  await (await db()).collection<UploadJob>("uploads").updateOne({ upload_id: uploadId }, { $set: { ...patch, updated_at: new Date().toISOString() } });
}

/**
 * The pipeline saves its own dogs (the five real dogs and upload-* ids). For a dog it refuses (e.g. a seed dog),
 * save the scores it returned so the dog still updates.
 */
async function saveIfPipelineDidNot(job: UploadJob, data: Record<string, unknown>) {
  const summary = data.summary as Record<string, unknown> | null;
  const stored = data.stored as { mongo?: boolean } | undefined;
  if (!summary || typeof summary.handling_level !== "string" || stored?.mongo) return;
  const fields = ["day", "energy", "stress", "approachability", "confidence", "arousal_spikes", "handling_level", "trend", "needs"] as const;
  const set: Record<string, unknown> = Object.fromEntries(fields.filter((k) => summary[k] !== undefined).map((k) => [k, summary[k]]));
  set.updated_at = new Date().toISOString();
  set.source = "app-upload";
  if (Array.isArray(data.events)) set.events = data.events;
  if (data.welfare) set.welfare = data.welfare;
  await (await db()).collection("dogs").updateOne(
    { dog_id: job.dog_id },
    { $set: set, $setOnInsert: { dog_id: job.dog_id, name: job.name || job.dog_id.split("-")[0].replace(/^./, (c) => c.toUpperCase()), expert_reviewed: false } },
    { upsert: true },
  );
}

/** Used until the pipeline has /analyze-s3: fetch the video from S3 and send it to the classic /analyze. */
async function analyzeViaClassicEndpoint(job: UploadJob) {
  try {
    await update(job.upload_id, { status: "processing", message: "Tracking and scoring" });
    const bytes = await getObjectBytes(job.key);
    const form = new FormData();
    form.set("video", new Blob([Buffer.from(bytes)], { type: job.content_type }), job.key.split("/").pop());
    form.set("dog_id", job.dog_id);
    form.set("day", String(job.day));
    form.set("hour", String(job.hour));
    if (job.name) form.set("name", job.name);
    const res = await pipelineFetch("/analyze", { method: "POST", body: form, timeoutMs: 15 * 60_000 });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(data.detail ?? `Analysis failed (${res.status})`));
    await saveIfPipelineDidNot(job, data);
    await update(job.upload_id, { status: "done", summary: data.summary as UploadJob["summary"], message: undefined });
  } catch (err) {
    await update(job.upload_id, { status: "failed", error: (err as Error).message });
  }
}

// Step 2 of an upload: the browser has PUT the video to S3. Record it and hand it to the pipeline.
// Returns right away; the page polls GET /api/upload/{upload_id}, which reads Mongo.
export const POST = safe(async (req: Request) => {
  const cfg = s3Config();
  if (!cfg) return fail("Uploads aren't configured on this server.", 503);
  const body = await req.json();
  const dogId = String(body.dog_id ?? "").trim().toLowerCase();
  const key = String(body.key ?? "");
  const day = Number(body.day ?? 1);
  const name = String(body.name ?? "").trim().slice(0, 40) || undefined;
  if (!DOG_ID.test(dogId)) return fail("Invalid dog ID.", 400);
  if (!key.startsWith(`uploads/raw/${dogId}-`)) return fail("That upload key doesn't match this dog.", 400);
  if (!Number.isInteger(day) || day < 1 || day > 365) return fail("Day must be a whole number from 1 to 365.", 400);

  const now = new Date().toISOString();
  const job: UploadJob = {
    upload_id: randomUUID(),
    dog_id: dogId,
    name,
    day,
    hour: new Date().getHours(),
    bucket: cfg.bucket,
    key,
    content_type: String(body.content_type ?? "video/mp4"),
    size: Number(body.size ?? 0),
    status: "uploaded",
    created_at: now,
    updated_at: now,
  };
  const uploads = (await db()).collection<UploadJob>("uploads");
  await uploads.insertOne({ ...job });

  if (!PIPELINE_URL) {
    await update(job.upload_id, { status: "waiting_for_pipeline", message: WAITING });
    return NextResponse.json({ ...job, status: "waiting_for_pipeline", message: WAITING });
  }

  // Preferred: the pipeline reads the video from S3 itself and updates this upload record as it works.
  let res: Response | null = null;
  try {
    res = await pipelineFetch("/analyze-s3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_id: job.upload_id, bucket: job.bucket, key, dog_id: dogId, day, hour: job.hour, name }),
      timeoutMs: 10_000,
    });
  } catch {
    res = null;
  }
  if (res && (res.status === 202 || res.ok)) {
    await update(job.upload_id, { status: "queued" });
    return NextResponse.json({ ...job, status: "queued" });
  }
  if (res && (res.status === 404 || res.status === 405)) {
    // Pipeline is reachable but predates /analyze-s3: run the classic path after responding.
    after(() => analyzeViaClassicEndpoint(job));
    return NextResponse.json({ ...job, status: "processing" });
  }
  await update(job.upload_id, { status: "waiting_for_pipeline", message: WAITING });
  return NextResponse.json({ ...job, status: "waiting_for_pipeline", message: WAITING });
});
