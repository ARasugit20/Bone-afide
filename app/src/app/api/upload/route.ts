import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fail, safe } from "@/lib/http";
import { PIPELINE_URL, pipelineFetch } from "@/lib/pipeline";
import { getObjectBytes, s3Config } from "@/lib/s3";
import type { JobStage, PipelineJob } from "@/lib/types";

const DOG_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const WAITING = "Video saved. Analysis runs when the pipeline server is connected.";
const PROGRESS: Record<JobStage, number> = { queued: 2, downloading: 10, detecting: 30, tracking: 55, scoring: 70, saving: 85, uploading_media: 95, done: 100, failed: 100 };

const jobs = async () => (await db()).collection<PipelineJob>("pipeline_jobs");

/**
 * Fallback for a pipeline without /analyze-s3: fetch the video from S3, send it to the classic /analyze, and record
 * progress in `pipeline_jobs` in the same shape the pipeline uses, so the page reads one format either way.
 */
async function runClassic(jobId: string, dogId: string, key: string, contentType: string, day: number, hour: number, name?: string) {
  const col = await jobs();
  const timings: Partial<Record<JobStage, number>> = {};
  let stage: JobStage = "queued";
  let t = Date.now();
  const enter = async (next: JobStage) => {
    timings[stage] = Math.round((Date.now() - t) / 100) / 10;
    stage = next;
    t = Date.now();
    await col.updateOne({ job_id: jobId }, { $set: { stage: next, progress: PROGRESS[next], stage_timings: timings, updated_at: new Date().toISOString() } });
  };
  try {
    await enter("downloading");
    const bytes = await getObjectBytes(key);
    await enter("tracking"); // the classic endpoint detects, tracks and scores in one call
    const form = new FormData();
    form.set("video", new Blob([Buffer.from(bytes)], { type: contentType }), key.split("/").pop());
    form.set("dog_id", dogId);
    form.set("day", String(day));
    form.set("hour", String(hour));
    if (name) form.set("name", name);
    const res = await pipelineFetch("/analyze", { method: "POST", body: form, timeoutMs: 15 * 60_000 });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(data.detail ?? `Analysis failed (${res.status})`));
    await enter("saving");
    const s = data.summary as Record<string, number | string>;
    timings[stage] = Math.round((Date.now() - t) / 100) / 10;
    await col.updateOne({ job_id: jobId }, { $set: {
      stage: "done", progress: 100, stage_timings: timings, updated_at: new Date().toISOString(),
      result: {
        dog_id: dogId,
        name: String(data.name ?? name ?? ""),
        handling_level: s.handling_level as NonNullable<PipelineJob["result"]>["handling_level"],
        scores: { energy: +s.energy, stress: +s.stress, approachability: +s.approachability, confidence: +s.confidence, arousal_spikes: +s.arousal_spikes },
        events_count: Array.isArray(data.events) ? data.events.length : 0,
        media_status: "pending",
      },
    } });
  } catch (err) {
    await col.updateOne({ job_id: jobId }, { $set: { stage: "failed", progress: 100, error: (err as Error).message, updated_at: new Date().toISOString() } });
  }
}

// Step 2 of an upload: the browser has PUT the video to S3. Hand the S3 key to the pipeline and return a job id.
// The page then polls GET /api/upload/{job_id}, which reads `pipeline_jobs` in Mongo (works on Amplify too).
export const POST = safe(async (req: Request) => {
  if (!s3Config()) return fail("Uploads aren't configured on this server.", 503);
  const body = await req.json();
  const dogId = String(body.dog_id ?? "").trim().toLowerCase();
  const key = String(body.key ?? "");
  const day = Number(body.day ?? 1);
  const name = String(body.name ?? "").trim().slice(0, 40) || undefined;
  const contentType = String(body.content_type ?? "video/mp4");
  const hour = new Date().getHours();
  if (!DOG_ID.test(dogId)) return fail("Invalid dog ID.", 400);
  if (!key.startsWith(`uploads/raw/${dogId}-`)) return fail("That upload key doesn't match this dog.", 400);
  if (!Number.isInteger(day) || day < 1 || day > 365) return fail("Day must be a whole number from 1 to 365.", 400);

  const waiting = async () => {
    // Keep a record so the video can be analyzed once a pipeline is connected.
    await (await db()).collection("pending_uploads").insertOne({ dog_id: dogId, s3_key: key, name, day, hour, created_at: new Date().toISOString() });
    return NextResponse.json({ status: "waiting", message: WAITING });
  };
  if (!PIPELINE_URL) return waiting();

  let res: Response | null = null;
  try {
    res = await pipelineFetch("/analyze-s3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ s3_key: key, dog_id: dogId, name, day, hour }),
      timeoutMs: 10_000,
    });
  } catch {
    res = null;
  }
  if (res?.ok) {
    const { job_id } = (await res.json()) as { job_id?: string };
    if (job_id) return NextResponse.json({ status: "started", job_id });
  }
  if (res && (res.status === 404 || res.status === 405)) {
    const job_id = randomUUID().replace(/-/g, "");
    const now = new Date().toISOString();
    await (await jobs()).insertOne({ job_id, dog_id: dogId, s3_key: key, stage: "queued", progress: PROGRESS.queued, stage_timings: {}, error: null, result: null, created_at: now, updated_at: now });
    after(() => runClassic(job_id, dogId, key, contentType, day, hour, name));
    return NextResponse.json({ status: "started", job_id });
  }
  return waiting();
});
