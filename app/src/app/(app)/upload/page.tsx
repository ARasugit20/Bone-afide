"use client";

import { useEffect, useRef, useState } from "react";
import { Gate } from "@/components/AuthProvider";
import { Button, ButtonLink, Card, ErrorNote, LevelChip, PageHeader, Source } from "@/components/ui";
import { WhyLines } from "@/components/WhyLines";
import { STAFF_ONLY } from "@/lib/access";
import type { Dog, Family, JobStage, PipelineJob } from "@/lib/types";
import { remember } from "@/lib/clientCache";
import { getJSON, postJSON } from "@/lib/ui";
import { useApi } from "@/lib/useApi";
import type { Why } from "@/lib/why";

const MAX_MB = 500;
const FIELD = "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/20";

// The pipeline's stages, in plain words. "send" is the browser's own upload to S3.
const STEPS: { id: "send" | JobStage; label: string }[] = [
  { id: "send", label: "Sending video" },
  { id: "downloading", label: "Downloading" },
  { id: "detecting", label: "Finding the dog" },
  { id: "tracking", label: "Tracking movement" },
  { id: "scoring", label: "Scoring behavior" },
  { id: "saving", label: "Saving" },
  { id: "uploading_media", label: "Uploading video" },
];
const ORDER = STEPS.map((s) => s.id);

type Top = { family: Family; score: number; why: Why };
type Running = { state: "running"; step: (typeof STEPS)[number]["id"]; pct: number; started: number; timings: Partial<Record<JobStage, number>> };
type Run = { state: "idle" } | Running | { state: "done"; job: PipelineJob; seconds: number } | { state: "waiting"; message: string };

/** PUT straight to S3 with the presigned URL. XHR instead of fetch so the upload can report progress. */
function putToS3(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`S3 rejected the upload (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error("Network error while uploading to S3."));
    xhr.send(file);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Page() {
  return (
    <Gate allow={STAFF_ONLY}>
      <Upload />
    </Gate>
  );
}

function Upload() {
  const dogs = useApi<Dog[]>("/api/dogs");
  const [dogId, setDogId] = useState("");
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [day, setDay] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [run, setRun] = useState<Run>({ state: "idle" });
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = run.state === "running";

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [busy]);

  // The pipeline saves new dogs only under the upload- prefix.
  const id = dogId === "__new" ? (newId.trim() ? `upload-${newId.trim().toLowerCase().replace(/^upload-/, "")}` : "") : dogId;
  const tooBig = file ? file.size > MAX_MB * 1024 * 1024 : false;

  function pickDog(value: string) {
    setDogId(value);
    const d = dogs.data?.find((x) => x.dog_id === value);
    if (d) setDay(d.day + 1);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !id || tooBig) return;
    const started = Date.now();
    setNow(started);
    setError(null);
    setRun({ state: "running", step: "send", pct: 0, started, timings: {} });
    try {
      const type = file.type || "video/mp4";
      const { url, key } = await postJSON<{ url: string; key: string }>("/api/upload/presign", { dog_id: id, content_type: type, size: file.size });
      await putToS3(url, new File([file], file.name, { type }), (pct) => setRun({ state: "running", step: "send", pct, started, timings: {} }));
      const start = await postJSON<{ status: "started"; job_id: string } | { status: "waiting"; message: string }>("/api/upload", {
        dog_id: id, key, day, content_type: type, size: file.size, name: dogId === "__new" ? newName.trim() : undefined,
      });
      if (start.status === "waiting") {
        setRun({ state: "waiting", message: start.message });
        return;
      }
      // Poll the pipeline's job record (Mongo `pipeline_jobs`) until it finishes.
      let job: PipelineJob | null = null;
      let prefetched = false;
      const topUrl = `/api/match/dog/${encodeURIComponent(id)}`;
      while (Date.now() - started < 20 * 60_000) {
        job = await getJSON<PipelineJob>(`/api/upload/${start.job_id}`);
        // The dog is saved before its video finishes uploading: fetch the top matches now so they show instantly.
        if (!prefetched && (job.stage === "uploading_media" || job.stage === "done")) {
          prefetched = true;
          getJSON(topUrl).then((data) => remember(topUrl, data), () => {});
        }
        if (job.stage === "done" || job.stage === "failed") break;
        const step = job.stage === "queued" ? "downloading" : job.stage;
        setRun({ state: "running", step, pct: job.progress, started, timings: job.stage_timings ?? {} });
        await sleep(1500);
      }
      if (!job || job.stage !== "done" || !job.result) throw new Error(job?.error || "The analysis didn't finish.");
      setRun({ state: "done", job, seconds: Math.round((Date.now() - started) / 1000) });
      dogs.reload();
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError((err as Error).message);
      setRun({ state: "idle" });
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader back={{ href: "/", label: "Overview" }} title="Upload kennel video" sub="The pipeline tracks the dog, scores its behavior and finds the families that fit." />

      {run.state === "done" ? (
        <Result job={run.job} seconds={run.seconds} onAgain={() => setRun({ state: "idle" })} />
      ) : (
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="text-sm font-semibold">Dog</span>
              <select value={dogId} onChange={(e) => pickDog(e.target.value)} className={`mt-1.5 ${FIELD}`} required disabled={dogs.loading || busy}>
                <option value="">{dogs.loading ? "Loading dogs" : "Choose a dog"}</option>
                {(dogs.data ?? []).map((d) => (
                  <option key={d.dog_id} value={d.dog_id}>{d.name} ({d.dog_id})</option>
                ))}
                <option value="__new">New dog</option>
              </select>
            </label>
            {dogId === "__new" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-semibold">Name</span>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Bella" maxLength={40} className={`mt-1.5 ${FIELD}`} required disabled={busy} />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold">Dog ID</span>
                  <span className="mt-1.5 flex items-center rounded-xl border border-line bg-surface focus-within:border-forest focus-within:ring-2 focus-within:ring-forest/20">
                    <span className="pl-3 text-sm text-muted">upload-</span>
                    <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="bella-01" required pattern="[a-z0-9][a-z0-9\-]{1,30}" disabled={busy} className="w-full min-w-0 rounded-xl bg-transparent py-2.5 pr-3 text-sm outline-none" />
                  </span>
                </label>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
              <label className="block">
                <span className="text-sm font-semibold">Day in shelter</span>
                <input type="number" min={1} max={365} value={day} onChange={(e) => setDay(Number(e.target.value))} className={`mt-1.5 ${FIELD}`} required disabled={busy} />
              </label>
              <div>
                <span className="text-sm font-semibold">Video</span>
                <input ref={fileRef} type="file" accept="video/*" aria-label="Video file" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1.5 block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-sand file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink hover:file:bg-line" required />
                <span className={`mt-1 block text-xs ${tooBig ? "text-rose-700" : "text-muted"}`}>
                  {file ? `${file.name}, ${(file.size / 1048576).toFixed(1)} MB` : `MP4 or MOV, up to ${MAX_MB} MB.`}
                  {tooBig && ` Videos must be under ${MAX_MB} MB.`}
                </span>
              </div>
            </div>

            {run.state === "running" ? (
              <Stepper run={run} now={now} />
            ) : (
              <div className="border-t border-line pt-4">
                <Button type="submit" disabled={!file || !id || tooBig}>Upload and analyze</Button>
              </div>
            )}
          </form>
        </Card>
      )}

      <div className="mt-4 space-y-3">
        {error && <ErrorNote message={error} />}
        {run.state === "waiting" && <p role="status" className="rounded-xl bg-sand px-4 py-3 text-sm">{run.message}</p>}
        <Source>Video uploads straight to Amazon S3. Tracking with YOLO11 and camera-shake compensation. Scores saved to MongoDB Atlas, readings to Tiger Data.</Source>
      </div>
    </div>
  );
}

function Stepper({ run, now }: { run: Running; now: number }) {
  const current = ORDER.indexOf(run.step);
  const bar = run.step === "send" ? Math.round(run.pct / 10) : Math.max(10, run.pct);
  return (
    <div className="border-t border-line pt-4" role="status" aria-live="polite">
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-semibold">
          {STEPS[current]?.label}
          {run.step === "send" ? `, ${run.pct}%` : ""}
        </span>
        <span className="tabular-nums text-muted">{Math.max(0, Math.round((now - run.started) / 1000))} s</span>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-sand">
        <div className="h-full rounded-full bg-forest transition-all duration-500" style={{ width: `${bar}%` }} />
      </div>
      <ol className="grid gap-1.5 sm:grid-cols-2">
        {STEPS.map((s, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";
          const t = s.id !== "send" ? run.timings[s.id as JobStage] : undefined;
          return (
            <li key={s.id} className={`flex items-center gap-2 text-sm ${state === "todo" ? "text-muted" : ""}`}>
              <span aria-hidden className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${state === "done" ? "bg-forest text-on-dark" : state === "active" ? "border-2 border-forest" : "border border-line"}`}>
                {state === "done" ? "✓" : state === "active" ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-forest" /> : null}
              </span>
              <span className="flex-1">{s.label}</span>
              {state === "done" && typeof t === "number" && <span className="text-xs tabular-nums text-muted">{t.toFixed(1)} s</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Result({ job, seconds, onAgain }: { job: PipelineJob; seconds: number; onAgain: () => void }) {
  const r = job.result!;
  const top = useApi<{ families_considered: number; top: Top[] }>(`/api/match/dog/${encodeURIComponent(job.dog_id)}`);
  const scores = [
    ["Energy", r.scores.energy],
    ["Stress", r.scores.stress],
    ["Approach.", r.scores.approachability],
    ["Confidence", r.scores.confidence],
    ["Spikes", r.scores.arousal_spikes],
  ] as const;
  return (
    <div className="space-y-4">
      <Card as="section">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted">Scored in {seconds} s</p>
            <h2 className="font-display text-2xl font-semibold">{r.name || job.dog_id}</h2>
          </div>
          <LevelChip level={r.handling_level} showLabel />
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-sm sm:grid-cols-5">
          {scores.map(([k, v]) => (
            <div key={k} className="rounded-xl bg-canvas px-3 py-2">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="font-display text-xl font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card as="section">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Top family matches</h2>
          {top.data && <span className="text-xs text-muted">{top.data.families_considered} families considered</span>}
        </div>
        {top.loading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-sand" />)}</div>
        ) : top.error ? (
          <ErrorNote message={top.error} onRetry={top.reload} />
        ) : top.data?.top.length ? (
          <ol className="divide-y divide-line">
            {top.data.top.map((t, i) => (
              <li key={t.family.family_id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                <span className="w-5 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-muted">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-semibold">{t.family.name}</p>
                    <p className="font-display text-xl font-semibold tabular-nums">
                      {t.score}
                      <span className="ml-1 text-xs font-normal text-muted">fit</span>
                    </p>
                  </div>
                  <div className="mt-1"><WhyLines why={t.why} showSource={i === top.data!.top.length - 1} /></div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted">No family fits yet. This dog stays on the board for the next match.</p>
        )}
      </Card>

      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/dogs/${job.dog_id}`}>Open dog page</ButtonLink>
        <Button variant="secondary" onClick={onAgain}>Upload another</Button>
      </div>
    </div>
  );
}
