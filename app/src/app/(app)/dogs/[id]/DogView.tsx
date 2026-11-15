"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { TrackingVideo } from "@/components/TrackingVideo";
import { TrendChart, type TrendPoint } from "@/components/TrendChart";
import {
  Bar, Button, ButtonLink, Caption, Card, DogPhoto, Empty, ErrorNote, LevelChip, NeedChip, PageHeader, ReviewBadge, SectionTitle, Skeleton, Source, UpdatedAt,
} from "@/components/ui";
import { displayName } from "@/lib/dogs";
import { formatDateTime, timeAgo } from "@/lib/text";
import type { Dog, StaffNote } from "@/lib/types";
import { getJSON, LEVELS, needsReview, postJSON } from "@/lib/ui";
import { useApi } from "@/lib/useApi";

type Trend = { series: TrendPoint[] };
const FIELD = "w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/20";

export function DogView() {
  const { id } = useParams<{ id: string }>();
  const dog = useApi<Dog>(`/api/dogs/${id}`);
  const roster = useApi<Dog[]>("/api/dogs");
  const auth = useAuth();
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const mediaPending = dog.data?.media_status === "pending" && !dog.data?.video_url;
  const { setData } = dog;

  // Right after an upload the pipeline sends the video to S3 in the background. Check until it's there.
  useEffect(() => {
    if (!mediaPending) return;
    const t = setInterval(() => {
      getJSON<Dog>(`/api/dogs/${id}`).then(setData, () => {});
    }, 5000);
    return () => clearInterval(t);
  }, [mediaPending, id, setData]);

  async function signOff() {
    setSigning(true);
    setSignError(null);
    try {
      dog.setData(await getJSON<Dog>(`/api/dogs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expert_reviewed: true }),
      }));
    } catch (err) {
      setSignError((err as Error).message);
    } finally {
      setSigning(false);
    }
  }

  if (dog.loading) return <DogSkeleton />;
  if (dog.error || !dog.data)
    return (
      <Empty
        title="Dog not found"
        body={dog.error ?? "This dog may have been adopted or removed."}
        action={<ButtonLink href="/dogs" variant="secondary">Back to dogs</ButtonLink>}
      />
    );

  const d = dog.data;
  const name = displayName(d, roster.data ?? [d]);
  return (
    <div>
      <PageHeader
        back={{ href: "/dogs", label: "Dogs" }}
        title={
          <span className="flex items-center gap-4">
            <DogPhoto dog={d} className="h-14 w-14 sm:h-16 sm:w-16" rounded="rounded-2xl" priority />
            <span>{name}</span>
          </span>
        }
        sub={
          <span className="mt-2 flex flex-wrap items-center gap-2">
            <LevelChip level={d.handling_level} showLabel />
            <ReviewBadge dog={d} />
            <span className="text-sm text-muted">
              Day {d.day} in shelter{d.updated_at ? ", " : ""}
              <UpdatedAt iso={d.updated_at} className="text-sm" prefix="scanned" />
            </span>
          </span>
        }
        actions={
          <>
            {auth.role === "vet" && needsReview(d) && <Button onClick={signOff} loading={signing}>Confirm level</Button>}
            <ButtonLink href={`/passport/${d.dog_id}`} variant="secondary">Behavior passport</ButtonLink>
          </>
        }
      />
      {signError && <div className="mb-4"><ErrorNote message={signError} onRetry={signOff} /></div>}
      <WelfareNote dog={d} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <Card as="section">
            <SectionTitle title="Tracking video" sub="YOLO11 tracking with camera-shake compensation." />
            {d.video_url ? (
              <TrackingVideo src={d.video_url} poster={d.photo} events={d.events ?? []} />
            ) : mediaPending ? (
              <p role="status" className="flex items-center gap-2 rounded-xl bg-canvas px-4 py-6 text-sm text-muted">
                <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-forest" />
                Uploading the tracking video to Amazon S3. This page updates when it&apos;s ready.
              </p>
            ) : (
              <Empty title="No tracking video yet" body="Upload a kennel video to create one." action={<ButtonLink href="/upload" variant="secondary">Upload kennel video</ButtonLink>} />
            )}
          </Card>

          <TrendCard dogId={d.dog_id} />

          <Card as="section">
            <SectionTitle title="Behavior report" sub={d.behavior_report_at ? `Generated ${formatDateTime(d.behavior_report_at)}` : undefined} />
            {d.behavior_report ? (
              <>
                <p className="whitespace-pre-line text-[15px] leading-relaxed">{d.behavior_report}</p>
                {d.behavior_report_by && <Source className="mt-3">Written by {d.behavior_report_by}</Source>}
              </>
            ) : (
              <p className="text-sm text-muted">No report yet. The pipeline writes one after it scores a video.</p>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card as="section">
            <SectionTitle title="Scores from video" sub={`Measured over ${d.day} ${d.day === 1 ? "day" : "days"}.`} />
            <div className="space-y-4">
              <Bar label="Energy" value={d.energy} />
              <Bar label="Stress" value={d.stress} color="bg-grass" />
              <Bar label="Approachability" value={d.approachability} color="bg-sky-400" />
              <Bar label="Confidence" value={d.confidence} color="bg-forest-dark" />
              <Bar label="Excitement spikes" value={d.arousal_spikes} max={10} hint="per session" color={LEVELS[d.handling_level].dot} />
            </div>
            <div className="mt-6 border-t border-line pt-4">
              <p className="mb-2 text-sm font-semibold">Needs</p>
              <div className="flex flex-wrap gap-2">
                {d.needs.length ? d.needs.map((n) => <NeedChip key={n} need={n} />) : <span className="text-sm text-muted">None noted.</span>}
              </div>
            </div>
            <Caption className="mt-4" />
          </Card>

          <NotesCard dog={d} name={d.name} />
          <VetAskBox dog={d} name={name} />
        </div>
      </div>
    </div>
  );
}

/** Grounded vet-adjacent Q&A: answers only from this dog's record, always ends with
 *  the medical disclaimer, refuses dosing/diagnosis, labels the model, and offers a
 *  TinyFish "find a vet nearby" search. */
function VetAskBox({ dog, name }: { dog: Dog; name: string }) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ question: string; answer: string; model: string } | null>(null);
  const [vetJob, setVetJob] = useState<{ status: string } | null>(null);
  const [vets, setVets] = useState<{ name: string; url: string; address?: string }[]>([]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const question = q.trim();
    if (!question) return;
    setLoading(true);
    setError(null);
    try {
      const res = await postJSON<{ answer: string; model: string }>("/api/vet-ask", { dog_id: dog.dog_id, question });
      setResult({ question, ...res });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function findVet() {
    setVetJob({ status: "running" });
    try {
      await postJSON("/api/vet-nearby");
      const poll = async (): Promise<void> => {
        const d = await getJSON<{ job: { status: string } | null; results: { name: string; url: string; address?: string }[] }>("/api/vet-nearby");
        setVetJob(d.job);
        setVets(d.results ?? []);
        if (d.job?.status === "running") setTimeout(poll, 5000);
      };
      await poll();
    } catch (err) {
      setError((err as Error).message);
      setVetJob(null);
    }
  }

  return (
    <Card as="section">
      <SectionTitle title="Ask a vet question" sub={`Answers use only ${name}'s record. Not a diagnosis.`} />
      <form onSubmit={ask} className="mt-3 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Is ${name} due for any care?`} aria-label="Vet question" className={`${FIELD} min-w-0 flex-1`} />
        <Button type="submit" variant="secondary" loading={loading} disabled={!q.trim()}>Ask</Button>
      </form>
      {error && <div className="mt-3"><ErrorNote message={error} /></div>}
      {result && (
        <div className="mt-4 rounded-xl bg-canvas p-4">
          <p className="text-xs text-muted">{result.question}</p>
          <p className="mt-1 text-sm leading-relaxed">{result.answer}</p>
          <Source className="mt-2">Written by {result.model}</Source>
        </div>
      )}
      <div className="mt-4 border-t border-line pt-4">
        <Button variant="secondary" onClick={findVet} loading={vetJob?.status === "running"}>
          {vetJob?.status === "running" ? "Searching" : "Find a vet nearby"}
        </Button>
        {vets.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {vets.map((v, i) => (
              <li key={i}>
                <a href={v.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-forest hover:underline">{v.name}</a>
                {v.address && <span className="text-muted"> {v.address}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/** Kennel-decline alert computed by the pipeline from the last 3 Tiger sessions. Stable shows nothing. */
function WelfareNote({ dog }: { dog: Dog }) {
  const w = dog.welfare;
  if (!w || w.status === "stable") return null;
  if (w.status === "rising_stress") {
    return (
      <div role="alert" className="mb-6 flex flex-col gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200 sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="font-semibold">Stress rising.</span> {w.message}
        </p>
        <a href="#stress-trend" className="shrink-0 font-semibold underline underline-offset-2">See the chart</a>
      </div>
    );
  }
  return (
    <p className="mb-6 rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
      Settling in: {w.message}
    </p>
  );
}

function TrendCard({ dogId }: { dogId: string }) {
  const trend = useApi<Trend>(`/api/trend/${dogId}`);
  return (
    <Card as="section" className="scroll-mt-24">
      <span id="stress-trend" className="block scroll-mt-24" />
      <SectionTitle title="Stress and energy over observation sessions" />
      {trend.loading ? (
        <Skeleton className="h-40" />
      ) : trend.error ? (
        <ErrorNote message={trend.error} onRetry={trend.reload} />
      ) : trend.data?.series.length ? (
        <TrendChart series={trend.data.series} />
      ) : (
        <p className="text-sm text-muted">No sessions recorded yet. Readings appear after the first scored video.</p>
      )}
      <Source className="mt-3">Time series from Tiger Data</Source>
    </Card>
  );
}

function NotesCard({ dog, name }: { dog: Dog; name: string }) {
  const notes = useApi<StaffNote[]>(`/api/notes?dog_id=${encodeURIComponent(dog.dog_id)}`);
  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await postJSON<{ note: StaffNote; indexed: boolean }>("/api/notes", { dog_id: dog.dog_id, day: dog.day, author, text });
      notes.setData([res.note, ...(notes.data ?? [])]);
      setText("");
      if (!res.indexed) setSaveError("Saved, but search indexing failed. Questions may not find this note yet.");
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card as="section" className="space-y-6">
      <div>
        <SectionTitle title="Staff notes" />
        <form onSubmit={add} className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder={`What did you see? For example: ${name} walked calmly past the cat room.`}
            aria-label="Note"
            className={`${FIELD} resize-y`}
          />
          <div className="flex gap-2">
            <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your name" aria-label="Your name" className={`${FIELD} min-w-0 flex-1`} />
            <Button type="submit" loading={saving} disabled={!text.trim()}>Add note</Button>
          </div>
          {saveError && <p className="text-sm text-amber-800">{saveError}</p>}
        </form>

        <div className="mt-4">
          {notes.loading ? (
            <div className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
          ) : notes.error ? (
            <ErrorNote message={notes.error} onRetry={notes.reload} />
          ) : notes.data?.length ? (
            <ol className="relative space-y-4 border-l border-line pl-4">
              {notes.data.map((n, i) => (
                <li key={`${n.created_at ?? ""}-${i}`} className="relative">
                  <span aria-hidden className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-forest" />
                  <p className="text-sm">{n.note}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {n.author}
                    {n.day ? `, day ${n.day}` : ""}
                    {n.created_at ? `, ${timeAgo(n.created_at)}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">No notes yet.</p>
          )}
        </div>
      </div>

      <AskBox dog={dog} name={name} />
    </Card>
  );
}

function AskBox({ dog, name }: { dog: Dog; name: string }) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ question: string; answer: string; sources: string[] } | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const question = q.trim();
    if (!question) return;
    setLoading(true);
    setError(null);
    try {
      const res = await postJSON<{ answer: string; sources: string[] }>("/api/ask", { dog_id: dog.dog_id, question });
      setResult({ question, ...res });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-t border-line pt-6">
      <h3 className="font-display text-lg font-semibold">Ask about this dog</h3>
      <p className="mt-0.5 text-sm text-muted">Answers use only the staff notes.</p>
      <form onSubmit={ask} className="mt-3 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`How is ${name} with visitors?`} aria-label="Question" className={`${FIELD} min-w-0 flex-1`} />
        <Button type="submit" variant="secondary" loading={loading} disabled={!q.trim()}>Ask</Button>
      </form>
      {error && <div className="mt-3"><ErrorNote message={error} /></div>}
      {result && (
        <div className="mt-4 rounded-xl bg-canvas p-4">
          <p className="text-xs text-muted">{result.question}</p>
          <p className="mt-1 text-sm leading-relaxed">{result.answer}</p>
          {result.sources.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-muted">Notes used</p>
              <ul className="mt-1 space-y-1">
                {result.sources.map((s, i) => (
                  <li key={i} className="border-l-2 border-line pl-2 text-xs text-ink">{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <Source className="mt-3">Answers from notes via Supermemory</Source>
    </div>
  );
}

function DogSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dog">
      <div className="mb-8 flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-2xl" />
        <div className="space-y-2"><Skeleton className="h-7 w-40" /><Skeleton className="h-5 w-64" /></div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-6"><Skeleton className="h-80 rounded-2xl" /><Skeleton className="h-48 rounded-2xl" /></div>
        <div className="space-y-6"><Skeleton className="h-72 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>
      </div>
    </div>
  );
}
