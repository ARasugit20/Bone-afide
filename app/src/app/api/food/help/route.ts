import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { db } from "@/lib/db";
import { safe } from "@/lib/http";
import { plain } from "@/lib/text";
import type { FoodHelpJob } from "@/lib/types";
import { cancelAgentRun, getAgentRun, RUN_CAP_MS, saveFoodHelpResult, startFoodHelpRun } from "@/lib/tinyfish";

const latestJob = (d: Db) =>
  d.collection<FoodHelpJob>("food_help_jobs").find({}, { projection: { _id: 0 } }).sort({ started_at: -1 }).limit(1).next();

async function advance(d: Db, job: FoodHelpJob): Promise<FoodHelpJob> {
  if (job.status !== "running") return job;
  const jobs = d.collection<FoodHelpJob>("food_help_jobs");
  const finish = async (patch: Partial<FoodHelpJob>) => {
    const next = { ...job, ...patch, finished_at: new Date().toISOString() };
    const res = await jobs.updateOne({ run_id: job.run_id, status: "running" }, { $set: next });
    return res.modifiedCount ? next : ((await jobs.findOne({ run_id: job.run_id }, { projection: { _id: 0 } })) ?? next);
  };
  if (Date.now() - new Date(job.started_at).getTime() > RUN_CAP_MS) {
    await cancelAgentRun(job.run_id);
    return finish({ status: "timed_out", error: "The search took longer than 6 minutes." });
  }
  const run = await getAgentRun(job.run_id);
  if (!run || run.status === "PENDING" || run.status === "RUNNING") return job;
  if (run.status !== "COMPLETED") return finish({ status: "failed", error: run.error?.message || `The web agent run ${String(run.status).toLowerCase()}.` });
  try {
    const found = await saveFoodHelpResult(d, run.result);
    return finish({ status: "done", found });
  } catch (err) {
    return finish({ status: "failed", error: (err as Error).message });
  }
}

export const GET = safe(async () => {
  const d = await db();
  const job0 = await latestJob(d);
  const job = job0 ? await advance(d, job0) : null;
  const results = await d.collection("food_help").find({}, { projection: { _id: 0 } }).toArray();
  return NextResponse.json({
    results: results.map((r) => ({ ...r, name: plain(String(r.name ?? "")), address: plain(String(r.address ?? "")) })),
    job,
  });
});

export const POST = safe(async () => {
  const d = await db();
  const current = await latestJob(d);
  if (current?.status === "running" && Date.now() - new Date(current.started_at).getTime() < RUN_CAP_MS) {
    return NextResponse.json({ job: current });
  }
  const run_id = await startFoodHelpRun();
  const job: FoodHelpJob = { run_id, status: "running", started_at: new Date().toISOString() };
  await d.collection<FoodHelpJob>("food_help_jobs").insertOne({ ...job });
  return NextResponse.json({ job });
});
