"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { TrendChart, type TrendPoint } from "@/components/TrendChart";
import { Avatar, Bar, Button, Caption, Card, Empty, ErrorNote, LevelChip, NeedChip, ReviewBadge, Spinner, TrendBadge } from "@/components/ui";
import type { Dog } from "@/lib/types";
import { getJSON, LEVELS, needsReview, postJSON } from "@/lib/ui";
import { useApi } from "@/lib/useApi";

type Trend = { fake: boolean; series: TrendPoint[] };

export function DogView() {
  const { id } = useParams<{ id: string }>();
  const dog = useApi<Dog>(`/api/dogs/${id}`);
  const trend = useApi<Trend>(`/api/trend/${id}`);
  const auth = useAuth();
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

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

  if (dog.loading) return <Spinner label="Fetching this pup's profile…" />;
  if (dog.error || !dog.data)
    return (
      <Empty
        title="We couldn't find this dog"
        body={dog.error ?? "They may have already gone home!"}
        action={<Link href="/dogs" className="font-bold text-clay-dark underline">Back to all dogs</Link>}
      />
    );

  const d = dog.data;
  return (
    <div className="space-y-5">
      <Link href="/dogs" className="text-sm font-semibold text-muted hover:text-ink">← All dogs</Link>

      <Card className="rise">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar name={d.name} size="h-20 w-20 text-3xl" />
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-4xl font-semibold">{d.name}</h1>
              <TrendBadge trend={d.trend} />
              <ReviewBadge dog={d} />
            </div>
            <p className="text-sm text-muted">
              Day {d.day} at the shelter · {d.expert_reviewed ? "Reviewed by the behavior team" : "Awaiting behavior team review"}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <Link
              href={`/passport/${d.dog_id}`}
              className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-cream hover:bg-ink/90"
            >
              View behavior passport →
            </Link>
            {auth.role === "vet" && needsReview(d) && (
              <Button onClick={signOff} loading={signing}>Expert sign-off</Button>
            )}
          </div>
        </div>
        {signError && <div className="mt-3"><ErrorNote message={signError} onRetry={signOff} /></div>}
        <div className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Handling level</p>
            <LevelChip level={d.handling_level} showLabel />
          </div>
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Needs</p>
            <div className="flex flex-wrap gap-1.5">
              {d.needs.length ? d.needs.map((n) => <NeedChip key={n} need={n} />) : <span className="text-sm text-muted">No special needs noted</span>}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="rise">
          <h2 className="font-display text-xl font-semibold">Behavior scores</h2>
          <p className="mb-4 text-sm text-muted">Measured from kennel video over {d.day} days.</p>
          <div className="space-y-4">
            <Bar label="Energy" value={d.energy} color="bg-clay" />
            <Bar label="Stress" value={d.stress} color="bg-sage" hint={d.stress > 60 ? "needs a calm start" : undefined} />
            <Bar label="Approachability" value={d.approachability} color="bg-amber-400" />
            <Bar label="Confidence" value={d.confidence} color="bg-sky-400" />
            <Bar label="Excitement spikes" value={d.arousal_spikes} max={10} color={LEVELS[d.handling_level].dot} hint="per session" />
          </div>
          <Caption className="mt-4" />
        </Card>

        <Card className="rise">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold">Settling in</h2>
            {trend.data?.fake && (
              <span className="rounded-full bg-sand px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-muted">sample data</span>
            )}
          </div>
          <p className="mb-2 text-sm text-muted">Daily average stress and energy.</p>
          {trend.loading ? (
            <Spinner label="Drawing the trend…" />
          ) : trend.data?.series.length ? (
            <TrendChart series={trend.data.series} />
          ) : (
            <Empty title="No trend yet" body="Check back after a few days of video." />
          )}
          <Caption />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <AskCard dog={d} />
        <NoteForm dog={d} />
      </div>
    </div>
  );
}

function AskCard({ dog }: { dog: Dog }) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ answer: string; sources: string[] } | null>(null);
  const suggestions = [`Is ${dog.name} good with kids?`, `How is ${dog.name} on a leash?`, "Okay with cats?"];

  async function ask(question: string) {
    if (!question.trim()) return;
    setQ(question);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await postJSON("/api/ask", { dog_id: dog.dog_id, question }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <h2 className="font-display text-xl font-semibold">Ask about {dog.name}</h2>
      <p className="mb-3 text-sm text-muted">Answers come only from staff & volunteer notes.</p>
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`e.g. How does ${dog.name} handle visitors?`}
          className="min-w-0 flex-1 rounded-full border border-line bg-cream px-4 py-2.5 text-sm outline-none focus:border-clay focus:ring-2 focus:ring-clay/20"
        />
        <Button type="submit" loading={loading}>Ask</Button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button key={s} onClick={() => ask(s)} disabled={loading} className="rounded-full bg-sand px-3 py-1 text-xs font-semibold text-ink/70 hover:bg-line disabled:opacity-50">
            {s}
          </button>
        ))}
      </div>

      {loading && <Spinner rotate />}
      {error && <div className="mt-3"><ErrorNote message={error} onRetry={() => ask(q)} /></div>}
      {result && (
        <div className="rise mt-4 rounded-2xl bg-cream p-4 ring-1 ring-line">
          <p className="whitespace-pre-line text-sm leading-relaxed">{result.answer}</p>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-semibold text-clay-dark">
              Source notes ({result.sources.length})
            </summary>
            {result.sources.length ? (
              <ul className="mt-2 space-y-2">
                {result.sources.map((s, i) => (
                  <li key={i} className="rounded-xl bg-white px-3 py-2 text-xs text-ink/80 ring-1 ring-line">{s}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted">No notes matched this question yet.</p>
            )}
          </details>
        </div>
      )}
    </Card>
  );
}

function NoteForm({ dog }: { dog: Dog }) {
  const [day, setDay] = useState(dog.day);
  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setStatus("saving");
    try {
      const res = await postJSON<{ saved: boolean }>("/api/notes", { dog_id: dog.dog_id, day, author: author || "Volunteer", text });
      setStatus(res.saved ? "saved" : "error");
      if (res.saved) setText("");
    } catch {
      setStatus("error");
    }
  }

  const input = "w-full rounded-2xl border border-line bg-cream px-3 py-2 text-sm outline-none focus:border-clay focus:ring-2 focus:ring-clay/20";
  return (
    <Card>
      <h2 className="font-display text-xl font-semibold">Add a volunteer note</h2>
      <p className="mb-3 text-sm text-muted">What did you see today? Describe behavior and needs.</p>
      <form onSubmit={submit} className="space-y-2.5">
        <div className="grid grid-cols-[5rem_1fr] gap-2">
          <input type="number" min={1} value={day} onChange={(e) => setDay(Number(e.target.value))} className={input} aria-label="Day" />
          <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your name" className={input} />
        </div>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setStatus("idle"); }}
          rows={3}
          placeholder={`e.g. ${dog.name} walked calmly past the cat room.`}
          className={`${input} resize-none`}
        />
        <div className="flex items-center gap-3">
          <Button type="submit" loading={status === "saving"} disabled={!text.trim()}>Save note</Button>
          {status === "saved" && <span className="text-sm font-semibold text-emerald-700">Saved — thank you! It may take a minute to appear in answers.</span>}
          {status === "error" && <span className="text-sm font-semibold text-rose-700">Couldn&apos;t save. Please try again.</span>}
        </div>
      </form>
    </Card>
  );
}
