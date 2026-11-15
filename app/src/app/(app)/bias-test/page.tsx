"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Gate } from "@/components/AuthProvider";
import { Button, Card, DogPhoto, Empty, ErrorNote, LevelChip, PageHeader, SectionTitle, Skeleton, Source } from "@/components/ui";
import { EVERYONE } from "@/lib/access";
import { diffWords, toRuns } from "@/lib/diff";
import { plain } from "@/lib/text";
import type { Dog } from "@/lib/types";
import { getJSON } from "@/lib/ui";
import { useApi } from "@/lib/useApi";

type Side = {
  key: string;
  label: string;
  prompt: string;
  avg: Record<string, number>;
  runs: Record<string, number[]>;
  descriptions: string[];
  pipeline: Record<string, number> | null;
};
type PipelineBias =
  | { dog_id: string; available: false }
  | {
      dog_id: string;
      available: true;
      model: string;
      runs_per_label: number;
      sides: Side[];
      difference: Record<string, number>;
      run_spread: Record<string, number>;
      exceeds_noise: Record<string, boolean>;
      pipeline_identical: boolean;
    };
type AppCheck = { model: string; input: { kind: string; count?: number }; answers: { label: string; text: string }[] };

const RATINGS: { key: string; label: string }[] = [
  { key: "friendliness", label: "Friendliness" },
  { key: "child_safety", label: "Safe with young kids" },
  { key: "adoptability", label: "Adoptability" },
];
const SCORES: { key: string; label: string }[] = [
  { key: "energy", label: "Energy" },
  { key: "stress", label: "Stress" },
  { key: "approachability", label: "Approachability" },
  { key: "confidence", label: "Confidence" },
  { key: "arousal_spikes", label: "Excitement spikes" },
];
const PREFERRED = ["kinder-01", "katie-01"];
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));

export default function Page() {
  return (
    <Gate allow={EVERYONE}>
      <BiasCheck />
    </Gate>
  );
}

function BiasCheck() {
  const dogs = useApi<Dog[]>("/api/dogs");
  // Only dogs scored from real kennel video can have a pipeline bias report.
  const real = (dogs.data ?? []).filter((d) => d.photo);
  const [picked, setPicked] = useState<string | null>(null);
  const dogId = picked ?? PREFERRED.find((id) => real.some((d) => d.dog_id === id)) ?? real[0]?.dog_id ?? null;
  const dog = real.find((d) => d.dog_id === dogId) ?? null;
  const report = useApi<PipelineBias>(dogId ? `/api/bias/${dogId}` : null);
  const selected = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = selected.current;
    const row = el?.parentElement;
    if (el && row) row.scrollTo({ left: el.offsetLeft - row.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
  }, [dogId, real.length]);

  return (
    <div>
      <PageHeader
        title="Bias check"
        sub="We send the same kennel video to Gemini twice. Only the breed label in the prompt changes."
      />

      {dogs.loading ? (
        <div className="mb-6 flex gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-32 rounded-full" />)}</div>
      ) : dogs.error ? (
        <div className="mb-6"><ErrorNote message={dogs.error} onRetry={dogs.reload} /></div>
      ) : real.length ? (
        <div role="tablist" aria-label="Dog" className="no-scrollbar -mx-1 mb-6 flex gap-2 overflow-x-auto px-1 py-1">
          {real.map((d) => (
            <button
              key={d.dog_id}
              ref={d.dog_id === dogId ? selected : undefined}
              type="button"
              role="tab"
              aria-selected={d.dog_id === dogId}
              onClick={() => setPicked(d.dog_id)}
              className={`flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-4 text-sm font-semibold transition ${
                d.dog_id === dogId ? "bg-forest text-on-dark" : "bg-surface ring-1 ring-line hover:ring-forest"
              }`}
            >
              <DogPhoto dog={d} className="h-8 w-8" rounded="rounded-full" sizes="32px" />
              {d.name}
            </button>
          ))}
        </div>
      ) : (
        <Empty title="No scored dogs yet" body="Upload a kennel video first. The check needs a real video." />
      )}

      {dog &&
        (report.loading ? (
          <div className="grid gap-6 md:grid-cols-2"><Skeleton className="h-96 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>
        ) : report.error ? (
          <ErrorNote message={report.error} onRetry={report.reload} />
        ) : report.data?.available ? (
          <PipelineReport dog={dog} r={report.data} />
        ) : (
          <AppFallback dog={dog} />
        ))}
    </div>
  );
}

function PipelineReport({ dog, r }: { dog: Dog; r: Extract<PipelineBias, { available: true }> }) {
  const [a, b] = r.sides;
  const biggest = RATINGS.map((x) => ({ ...x, d: r.difference[x.key] ?? 0 })).sort((p, q) => Math.abs(q.d) - Math.abs(p.d))[0];
  const spread = Math.max(...Object.values(r.run_spread));
  const anyBeyondNoise = Object.values(r.exceeds_noise).some(Boolean);

  return (
    <div className="space-y-6">
      <Card as="section">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <DogPhoto dog={dog} className="h-20 w-20" rounded="rounded-xl" priority sizes="80px" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold">{dog.name}</h2>
              <LevelChip level={dog.handling_level} />
            </div>
            <p className="mt-1 text-sm text-muted">
              Same video, {r.runs_per_label} runs per label. The largest gap was {biggest.label.toLowerCase()}: {signed(biggest.d)} points for &quot;{a.label}&quot;.
              {" "}
              {anyBeyondNoise
                ? "That is larger than Gemini's run-to-run spread."
                : `Gemini's own run-to-run spread was up to ${spread} points, so small gaps are within noise.`}
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {[a, b].map((s) => (
          <Card key={s.key} as="section" className="flex flex-col">
            <p className="text-sm font-semibold">Label used: {s.label}</p>
            <p className="mt-0.5 text-xs text-muted">Prompt began: &quot;{plain(s.prompt)}&quot;</p>

            <table className="mt-4 w-full text-sm">
              <caption className="sr-only">Gemini ratings with the {s.label} label</caption>
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th scope="col" className="pb-2 font-semibold">Gemini rating</th>
                  <th scope="col" className="pb-2 text-right font-semibold">Average</th>
                  <th scope="col" className="pb-2 text-right font-semibold">Runs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line border-t border-line">
                {RATINGS.map((x) => (
                  <tr key={x.key}>
                    <th scope="row" className="py-2 text-left font-normal">{x.label}</th>
                    <td className="py-2 text-right font-semibold tabular-nums">{fmt(s.avg[x.key])}</td>
                    <td className="py-2 text-right text-muted tabular-nums">{(s.runs[x.key] ?? []).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {s.descriptions[0] && (
              <div className="mt-4 flex-1 rounded-xl bg-canvas p-4">
                <p className="text-xs font-semibold text-muted">Gemini&apos;s description, run 1</p>
                <p className="mt-1 text-sm leading-relaxed">{s.descriptions[0]}</p>
              </div>
            )}
          </Card>
        ))}
      </div>

      <Card as="section">
        <SectionTitle title="Scores from video" sub="Bonafide scores and Gemini ratings for the same video, by label used." />
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th scope="col" className="pb-2 font-semibold"><span className="sr-only">Measure</span></th>
              <th scope="col" className="pb-2 text-right font-semibold capitalize">{a.label}</th>
              <th scope="col" className="pb-2 pl-2 text-right font-semibold">{b.label}</th>
              <th scope="col" className="pb-2 pl-2 text-right font-semibold">Diff.</th>
            </tr>
          </thead>
          <tbody className="border-t border-line">
            <tr><th scope="rowgroup" colSpan={4} className="pb-1 pt-3 text-left text-xs font-semibold text-muted">Bonafide scores</th></tr>
            {SCORES.map((x) => (
              <tr key={x.key} className="border-t border-line">
                <th scope="row" className="py-2 text-left font-normal">{x.label}</th>
                <td className="py-2 text-right font-semibold tabular-nums">{a.pipeline?.[x.key] ?? "n/a"}</td>
                <td className="py-2 pl-2 text-right font-semibold tabular-nums">{b.pipeline?.[x.key] ?? "n/a"}</td>
                <td className="py-2 pl-2 text-right font-semibold tabular-nums">
                  {a.pipeline && b.pipeline ? signed((a.pipeline[x.key] ?? 0) - (b.pipeline[x.key] ?? 0)) : "n/a"}
                </td>
              </tr>
            ))}
            <tr className="border-t border-line"><th scope="rowgroup" colSpan={4} className="pb-1 pt-4 text-left text-xs font-semibold text-muted">Gemini ratings (average of {r.runs_per_label})</th></tr>
            {RATINGS.map((x) => (
              <tr key={x.key} className="border-t border-line">
                <th scope="row" className="py-2 text-left font-normal">{x.label}</th>
                <td className="py-2 text-right tabular-nums">{fmt(a.avg[x.key])}</td>
                <td className="py-2 pl-2 text-right tabular-nums">{fmt(b.avg[x.key])}</td>
                <td className="py-2 pl-2 text-right font-semibold tabular-nums">{signed(r.difference[x.key] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-sm font-semibold">
          {r.pipeline_identical
            ? "Scores don't change with the label because breed is never an input."
            : "Pipeline scores differed between runs. Check the pipeline output."}
        </p>
        <Source className="mt-2">Ratings from {r.model} on the same video. Report produced by the Bonafide pipeline.</Source>
      </Card>
    </div>
  );
}

/** Used only when the pipeline has no bias report for this dog: asks Gemini about the dog's staff notes twice. */
function AppFallback({ dog }: { dog: Dog }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AppCheck | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      setResult(await getJSON<AppCheck>("/api/bias-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dog_id: dog.dog_id }),
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card as="section">
        <SectionTitle
          title={`No video report for ${dog.name} yet`}
          sub="Run a quicker check instead: Gemini reads this dog's staff notes twice, once per label."
          action={<Button onClick={run} loading={running}>{running ? "Running" : result ? "Run again" : "Run check"}</Button>}
        />
        {error && <ErrorNote message={error} onRetry={run} />}
      </Card>
      {result && <AnswerPair result={result} />}
    </div>
  );
}

function AnswerPair({ result }: { result: AppCheck }) {
  const [a, b] = result.answers;
  const [ta, tb] = useMemo(() => diffWords(plain(a.text), plain(b.text)), [a.text, b.text]);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {[{ ans: a, tokens: ta }, { ans: b, tokens: tb }].map(({ ans, tokens }) => (
        <Card key={ans.label} as="section">
          <p className="text-sm font-semibold">Label used: {ans.label === "lab mix" ? "Labrador mix" : ans.label}</p>
          <p className="mt-3 text-sm leading-relaxed">
            {toRuns(tokens).map((r, i) =>
              r.kind === "same" ? <span key={i}>{r.text}</span> : <mark key={i} className={`rounded px-0.5 ${r.kind === "loaded" ? "bg-rose-100 font-semibold text-rose-900" : "bg-amber-50 text-ink"}`}>{r.text}</mark>,
            )}
          </p>
          <Source className="mt-3">Highlighted words differ between the two answers. {result.model}, temperature 0.</Source>
        </Card>
      ))}
    </div>
  );
}
