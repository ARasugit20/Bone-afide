import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, safe } from "@/lib/http";
import type { PipelineJob } from "@/lib/types";

const TIMEOUT_MS = 20 * 60_000;

// Job progress from Mongo `pipeline_jobs`, so it works on Amplify without reaching the pipeline.
export const GET = safe(async (_req: NextRequest, ctx: RouteContext<"/api/upload/[id]">) => {
  const { id } = await ctx.params;
  const job = await (await db()).collection<PipelineJob>("pipeline_jobs").findOne({ job_id: id }, { projection: { _id: 0 } });
  if (!job) return fail("Upload not found", 404);
  const age = Date.now() - new Date(job.updated_at ?? job.created_at ?? 0).getTime();
  if (job.stage !== "done" && job.stage !== "failed" && age > TIMEOUT_MS) {
    return NextResponse.json({ ...job, stage: "failed", progress: 100, error: "The analysis stopped responding." });
  }
  return NextResponse.json(job);
});
