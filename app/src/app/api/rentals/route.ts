import { NextResponse, type NextRequest } from "next/server";
import type { Db } from "mongodb";
import { db } from "@/lib/db";
import { fail, safe } from "@/lib/http";
import { plain } from "@/lib/text";
import type { RentalJob } from "@/lib/types";
import { cancelAgentRun, DEFAULT_LISTINGS_URL, getAgentRun, RUN_CAP_MS, saveRunResult, startAgentRun } from "@/lib/tinyfish";

const latestJob = (d: Db, dogId: string) =>
  d.collection<RentalJob>("rental_jobs").find({ dog_id: dogId }, { projection: { _id: 0 } }).sort({ started_at: -1 }).limit(1).next();

/** Checks a running job once against TinyFish and records the outcome. Safe to call repeatedly. */
async function advance(d: Db, job: RentalJob): Promise<RentalJob> {
  if (job.status !== "running") return job;
  const jobs = d.collection<RentalJob>("rental_jobs");
  const finish = async (patch: Partial<RentalJob>) => {
    const next = { ...job, ...patch, finished_at: new Date().toISOString() };
    // Only the first caller to see it running records the result.
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
    const saved = await saveRunResult(d, job.dog_id, run.result);
    return finish({ status: "done", kept: saved.kept, found: saved.found });
  } catch (err) {
    return finish({ status: "failed", error: (err as Error).message });
  }
}

// Saved listings plus the latest search job (advanced one step if it's still running).
export const GET = safe(async (req: NextRequest) => {
  const dogId = req.nextUrl.searchParams.get("dog_id");
  if (!dogId) return fail("dog_id is required", 400);
  const d = await db();
  const job0 = await latestJob(d, dogId);
  const job = job0 ? await advance(d, job0) : null;
  const rentals = await d.collection("rentals").find({ dog_id: dogId }, { projection: { _id: 0 } }).toArray();
  return NextResponse.json({
    rentals: rentals.map((r) => ({ ...r, pet_policy_text: plain(String(r.pet_policy_text ?? "")) })),
    job,
  });
});

// Starts a TinyFish web agent run and returns immediately. The page polls GET for the result.
export const POST = safe(async (req: Request) => {
  const { dog_id } = await req.json();
  if (!dog_id) return fail("dog_id is required", 400);
  const d = await db();
  const current = await latestJob(d, dog_id);
  if (current?.status === "running" && Date.now() - new Date(current.started_at).getTime() < RUN_CAP_MS) {
    return NextResponse.json({ job: current }); // already searching; don't start a second run
  }
  const run_id = await startAgentRun(DEFAULT_LISTINGS_URL);
  const job: RentalJob = { dog_id, run_id, status: "running", started_at: new Date().toISOString() };
  await d.collection<RentalJob>("rental_jobs").insertOne({ ...job });
  return NextResponse.json({ job });
});
