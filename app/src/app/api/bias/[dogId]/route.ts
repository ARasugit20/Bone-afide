import { NextResponse, type NextRequest } from "next/server";
import { fail, safe } from "@/lib/http";
import { pipelineFetch } from "@/lib/pipeline";
import { plain } from "@/lib/text";

type Side = { avg: Record<string, number>; runs: Record<string, number[]>; descriptions: string[] };
type PipelineBias = {
  dog_id: string;
  model: string;
  runs_per_label: number;
  labels: Record<string, string>;
  gemini: Record<string, Side>;
  comparison: { difference_pit_minus_lab: Record<string, number>; max_run_spread: Record<string, number>; exceeds_run_noise: Record<string, boolean> };
  pipeline_scores: Record<string, Record<string, number>> & { identical: boolean };
};

// Bias report the pipeline produced by sending the same kennel video to Gemini with two different breed labels.
// 404 means the pipeline hasn't run one for this dog; the client then offers the app's own check.
export const GET = safe(async (_req: NextRequest, ctx: RouteContext<"/api/bias/[dogId]">) => {
  const { dogId } = await ctx.params;
  let res: Response;
  try {
    res = await pipelineFetch(`/bias/${encodeURIComponent(dogId)}`, { timeoutMs: 10_000 });
  } catch {
    return fail("The behavior pipeline isn't reachable right now.", 503);
  }
  if (res.status === 404) return NextResponse.json({ dog_id: dogId, available: false });
  if (!res.ok) return fail(`Pipeline returned ${res.status}`, 502);

  const b = (await res.json()) as PipelineBias;
  const keys = Object.keys(b.labels);
  return NextResponse.json({
    dog_id: b.dog_id,
    available: true,
    model: b.model,
    runs_per_label: b.runs_per_label,
    sides: keys.map((k) => ({
      key: k,
      prompt: b.labels[k],
      label: k === "pit_bull" ? "pit bull" : k === "labrador" ? "Labrador mix" : k.replace(/_/g, " "),
      avg: b.gemini[k].avg,
      runs: b.gemini[k].runs,
      descriptions: b.gemini[k].descriptions.map((t) => plain(t)),
      pipeline: b.pipeline_scores[`${k}_run`] ?? null,
    })),
    difference: b.comparison.difference_pit_minus_lab,
    run_spread: b.comparison.max_run_spread,
    exceeds_noise: b.comparison.exceeds_run_noise,
    pipeline_identical: Boolean(b.pipeline_scores.identical),
  });
});
