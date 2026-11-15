"use client";

import { useMemo, useRef, useState } from "react";
import { Gate } from "@/components/AuthProvider";
import { Avatar, Bar, Button, Card, Empty, ErrorNote, LevelChip, PageTitle, Spinner } from "@/components/ui";
import { EVERYONE } from "@/lib/access";
import { peek, remember } from "@/lib/clientCache";
import { displayName } from "@/lib/dogs";
import { diffWords, toRuns, type Token } from "@/lib/diff";
import type { Dog } from "@/lib/types";
import { getJSON, LEVELS } from "@/lib/ui";
import { useApi } from "@/lib/useApi";

const MAX_MB = 20;

type Result = {
  dog: Dog;
  cached: boolean;
  model: string;
  input: { kind: "notes"; count: number; text: string } | { kind: "video"; bytes: number; name?: string };
  answers: { label: string; text: string }[];
};

export default function Page() {
  return (
    <Gate allow={EVERYONE}>
      <BiasTest />
    </Gate>
  );
}

function BiasTest() {
  const dogs = useApi<Dog[]>("/api/dogs");
  const [picked, setPicked] = useState<string | null>(null);
  const [clip, setClip] = useState<File | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dogId = picked ?? dogs.data?.[0]?.dog_id ?? null;

  function chooseClip(f: File | null) {
    setClipError(null);
    if (f && f.size > MAX_MB * 1024 * 1024) {
      setClipError(`That clip is ${(f.size / 1048576).toFixed(1)} MB — please keep it under ${MAX_MB} MB.`);
      return setClip(null);
    }
    if (f && !f.type.startsWith("video/")) {
      setClipError("Please choose a video file.");
      return setClip(null);
    }
    setClip(f);
  }

  async function run(fresh = false) {
    if (!dogId) return;
    const warmed = !clip && !fresh ? peek<Result>(`bias:${dogId}`) : undefined;
    if (warmed) {
      setError(null);
      return setResult(warmed);
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const init: RequestInit = clip
        ? (() => {
            const form = new FormData();
            form.set("dog_id", dogId);
            form.set("video", clip);
            if (fresh) form.set("fresh", "1");
            return { method: "POST", body: form };
          })()
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dog_id: dogId, fresh }) };
      const res = await getJSON<Result>("/api/bias-test", init);
      if (!clip) remember(`bias:${dogId}`, res);
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="Bias test"
        sub="Same dog. Same input. We ask a general-purpose AI twice — only the breed label changes."
      />

      <Card className="rise">
        <p className="text-xs font-bold uppercase tracking-wider text-muted">1 · Pick a dog</p>
        {dogs.loading ? (
          <div className="mt-3 flex gap-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 w-32 animate-pulse rounded-2xl bg-sand" />)}</div>
        ) : dogs.error ? (
          <div className="mt-3"><ErrorNote message={dogs.error} onRetry={dogs.reload} /></div>
        ) : !dogs.data?.length ? (
          <p className="mt-3 text-sm text-muted">No dogs yet — seed the database or connect the pipeline.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {dogs.data.map((d) => (
              <button
                key={d.dog_id}
                onClick={() => { setPicked(d.dog_id); setResult(null); }}
                className={`flex items-center gap-2 rounded-2xl px-3 py-2 text-left transition ${
                  d.dog_id === dogId ? "bg-ink text-cream shadow-sm" : "bg-cream ring-1 ring-line hover:bg-sand"
                }`}
              >
                <Avatar name={d.name} size="h-9 w-9 text-sm" />
                <span>
                  <span className="block text-sm font-bold">{displayName(d, dogs.data ?? [])}</span>
                  <span className={`text-[11px] ${d.dog_id === dogId ? "text-cream/70" : "text-muted"}`}>{d.handling_level}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <p className="mt-5 text-xs font-bold uppercase tracking-wider text-muted">2 · Input (optional clip)</p>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={(e) => chooseClip(e.target.files?.[0] ?? null)} />
          <Button variant="ghost" onClick={() => fileRef.current?.click()}>{clip ? "Change clip" : "Upload a short clip"}</Button>
          <span className="text-sm text-muted">
            {clip ? (
              <>
                🎬 {clip.name} · {(clip.size / 1048576).toFixed(1)} MB{" "}
                <button className="ml-1 font-semibold text-clay-dark underline" onClick={() => { setClip(null); if (fileRef.current) fileRef.current.value = ""; }}>remove</button>
              </>
            ) : (
              `No clip? We'll send this dog's volunteer notes instead. Max ${MAX_MB} MB.`
            )}
          </span>
        </div>
        {clipError && <p className="mt-2 text-sm font-semibold text-rose-700">{clipError}</p>}

        <div className="mt-5 flex items-center gap-3">
          <Button onClick={() => run()} loading={running} disabled={!dogId} className="px-6 py-3">
            {running ? "Asking Gemini twice…" : "Run the bias test"}
          </Button>
          {result && !running && (
            <button onClick={() => run(true)} className="text-xs font-semibold text-muted hover:text-ink">Re-run fresh</button>
          )}
        </div>
      </Card>

      {running && (
        <Card>
          <Spinner rotate />
          <p className="text-xs text-muted">Two identical requests are in flight — one says “pit bull”, one says “lab mix”.{clip ? " Video takes a little longer." : ""}</p>
        </Card>
      )}
      {error && <ErrorNote message={error} onRetry={() => run()} />}
      {result && !running && <Results result={result} roster={dogs.data ?? []} />}
      {!result && !running && !error && dogs.data?.length ? (
        <Empty title="Ready when you are" body="Pick a dog and run the test. Results are cached, so the second time is instant." />
      ) : null}
    </div>
  );
}

function Results({ result, roster }: { result: Result; roster: Dog[] }) {
  const [a, b] = result.answers;
  const [ta, tb] = useMemo(() => diffWords(a.text, b.text), [a.text, b.text]);
  const changed = (t: Token[]) => t.filter((x) => x.changed).length;
  const loaded = (t: Token[]) => t.filter((x) => x.loaded).map((x) => x.text.replace(/[^\w'-]/g, "").toLowerCase());
  const d = result.dog;

  return (
    <section className="rise space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="rounded-full bg-sand px-2.5 py-1 font-semibold">
          Input: {result.input.kind === "video"
            ? `video clip (${(result.input.bytes / 1048576).toFixed(1)} MB)`
            : result.input.count ? `${result.input.count} volunteer notes` : "behavior summary (no notes yet)"}
        </span>
        <span className="rounded-full bg-sand px-2.5 py-1 font-semibold">{result.model} · temperature 0</span>
        {result.cached && <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800">cached</span>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {[{ ans: a, tokens: ta, tone: "rose" as const }, { ans: b, tokens: tb, tone: "emerald" as const }].map(({ ans, tokens, tone }) => (
          <Card key={ans.label} className="flex flex-col">
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${tone === "rose" ? "bg-rose-50 text-rose-800 ring-rose-200" : "bg-emerald-50 text-emerald-800 ring-emerald-200"}`}>
                Told: “This dog is a {ans.label}.”
              </span>
              <span className="text-xs text-muted">{changed(tokens)} words differ</span>
            </div>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-muted">Gemini&apos;s words, shown as-is</p>
            <p className="mt-3 flex-1 text-[15px] leading-relaxed">
              {toRuns(tokens).map((r, i) =>
                r.kind === "same" ? (
                  <span key={i}>{r.text}</span>
                ) : (
                  <mark
                    key={i}
                    className={`box-decoration-clone rounded px-0.5 ${
                      r.kind === "loaded"
                        ? "bg-rose-200/80 font-bold text-rose-900 underline decoration-rose-500 decoration-2 underline-offset-2"
                        : tone === "rose" ? "bg-rose-100 text-ink" : "bg-emerald-100 text-ink"
                    }`}
                  >
                    {r.text}
                  </mark>
                ),
              )}
            </p>
            {loaded(tokens).length > 0 && (
              <p className="mt-3 text-xs text-rose-800">Loaded words only in this version: <b>{[...new Set(loaded(tokens))].join(", ")}</b></p>
            )}

            <div className="mt-5 rounded-2xl bg-cream p-4 ring-1 ring-line">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-bold">Bonafide scores for {displayName(d, roster)}</span>
                <LevelChip level={d.handling_level} />
              </div>
              <div className="space-y-2.5">
                <Bar label="Energy" value={d.energy} color="bg-clay" />
                <Bar label="Stress" value={d.stress} color="bg-sage" />
                <Bar label="Approachability" value={d.approachability} color="bg-amber-400" />
                <Bar label="Confidence" value={d.confidence} color="bg-sky-400" />
                <Bar label="Excitement spikes" value={d.arousal_spikes} max={10} color={LEVELS[d.handling_level].dot} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="rounded-3xl bg-ink px-6 py-5 text-center text-cream">
        <p className="font-display text-2xl font-semibold">Our scores never see breed.</p>
        <p className="mt-1 text-sm text-cream/70">
          Same numbers in both columns — they come from behavior on video, not a label. Labels above are hypothetical; Bonafide never records breed. Decision support, not a diagnosis.
        </p>
      </div>

      {result.input.kind === "notes" && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-clay-dark">See the exact input both requests received</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-2xl bg-white p-4 text-xs text-ink/80 ring-1 ring-line">{result.input.text}</pre>
        </details>
      )}
    </section>
  );
}
