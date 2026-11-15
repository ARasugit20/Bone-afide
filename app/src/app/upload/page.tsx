"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Gate } from "@/components/AuthProvider";
import { Button, Card, ErrorNote, LevelChip, PageHeader, Source } from "@/components/ui";
import { STAFF_ONLY } from "@/lib/access";
import type { Dog, HandlingLevel } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const MAX_MB = 200;

type Summary = { dog_id: string; handling_level: HandlingLevel; energy: number; stress: number; approachability: number; confidence: number; arousal_spikes: number };
type Phase = { step: "idle" } | { step: "uploading"; pct: number } | { step: "analyzing"; since: number };

/** XHR instead of fetch so the upload can report progress. */
function send(form: FormData, onProgress: (pct: number) => void, onUploaded: () => void): Promise<{ dog_id: string; summary: Summary | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.upload.onload = onUploaded;
    xhr.onload = () => (xhr.status < 400 ? resolve(xhr.response) : reject(new Error(xhr.response?.error || `Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Network error while uploading."));
    xhr.send(form);
  });
}
const FIELD = "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/20";

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
  const [day, setDay] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [now, setNow] = useState(0); // set when analysis starts; never read the clock during prerender
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Summary | { dog_id: string } | null>(null);
  const busy = phase.step !== "idle";

  useEffect(() => {
    if (phase.step !== "analyzing") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase.step]);
  const fileRef = useRef<HTMLInputElement>(null);

  const id = dogId === "__new" ? newId.trim().toLowerCase() : dogId;
  const tooBig = file ? file.size > MAX_MB * 1024 * 1024 : false;

  function pickDog(value: string) {
    setDogId(value);
    const d = dogs.data?.find((x) => x.dog_id === value);
    if (d) setDay(d.day + 1);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !id || tooBig) return;
    setPhase({ step: "uploading", pct: 0 });
    setError(null);
    setDone(null);
    try {
      const form = new FormData();
      form.set("video", file);
      form.set("dog_id", id);
      form.set("day", String(day));
      const res = await send(
        form,
        (pct) => setPhase({ step: "uploading", pct }),
        () => {
          setNow(Date.now());
          setPhase({ step: "analyzing", since: Date.now() });
        },
      );
      setDone(res.summary ?? { dog_id: res.dog_id });
      dogs.reload();
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPhase({ step: "idle" });
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        back={{ href: "/", label: "Overview" }}
        title="Upload kennel video"
        sub="The pipeline tracks the dog, scores its behavior and updates its record."
      />
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="text-sm font-semibold">Dog</span>
            <select value={dogId} onChange={(e) => pickDog(e.target.value)} className={`mt-1.5 ${FIELD}`} required disabled={dogs.loading}>
              <option value="">{dogs.loading ? "Loading dogs" : "Choose a dog"}</option>
              {(dogs.data ?? []).map((d) => (
                <option key={d.dog_id} value={d.dog_id}>{d.name} ({d.dog_id})</option>
              ))}
              <option value="__new">New dog</option>
            </select>
          </label>
          {dogId === "__new" && (
            <label className="block">
              <span className="text-sm font-semibold">New dog ID</span>
              <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="bella-01" className={`mt-1.5 ${FIELD}`} required pattern="[a-z0-9][a-z0-9\-]{1,40}" />
              <span className="mt-1 block text-xs text-muted">Lowercase letters, numbers and dashes.</span>
            </label>
          )}
          <label className="block">
            <span className="text-sm font-semibold">Day in shelter</span>
            <input type="number" min={1} max={365} value={day} onChange={(e) => setDay(Number(e.target.value))} className={`mt-1.5 w-28 ${FIELD}`} required />
          </label>
          <div>
            <span className="text-sm font-semibold">Video</span>
            <input ref={fileRef} type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1.5 block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-sand file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink hover:file:bg-line" required />
            <span className={`mt-1 block text-xs ${tooBig ? "text-rose-700" : "text-muted"}`}>
              {file ? `${file.name}, ${(file.size / 1048576).toFixed(1)} MB` : `MP4 or MOV, up to ${MAX_MB} MB.`}
              {tooBig && ` Videos must be under ${MAX_MB} MB.`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button type="submit" loading={busy} disabled={!file || !id || tooBig}>
              {busy ? "Analyzing video" : "Upload and analyze"}
            </Button>
            {phase.step === "uploading" && <span role="status" className="text-sm text-muted">Uploading {phase.pct}%</span>}
            {phase.step === "analyzing" && (
              <span role="status" className="text-sm text-muted">
                Tracking and scoring, {Math.max(0, Math.round((now - phase.since) / 1000))} s. This usually takes a few minutes.
              </span>
            )}
          </div>
        </form>
      </Card>
      <div className="mt-4 space-y-3">
        {error && <ErrorNote message={error} />}
        {done && (
          <Card as="section">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">Scored {done.dog_id}</p>
              {"handling_level" in done && <LevelChip level={done.handling_level} showLabel />}
            </div>
            {"handling_level" in done && (
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm sm:grid-cols-5">
                {(["energy", "stress", "approachability", "confidence", "arousal_spikes"] as const).map((k) => (
                  <div key={k}>
                    <dt className="text-xs capitalize text-muted">{k === "arousal_spikes" ? "Spikes" : k}</dt>
                    <dd className="font-semibold tabular-nums">{done[k]}</dd>
                  </div>
                ))}
              </dl>
            )}
            <Link href={`/dogs/${done.dog_id}`} className="mt-3 inline-block text-sm font-semibold text-forest hover:underline">Open the dog&apos;s page</Link>
          </Card>
        )}
        <Source>Tracking with YOLO11 and camera-shake compensation. Scores saved to MongoDB Atlas, readings to Tiger Data.</Source>
      </div>
    </div>
  );
}
