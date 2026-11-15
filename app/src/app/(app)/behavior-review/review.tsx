"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth, Gate } from "@/components/AuthProvider";
import { Button, Card, Empty, PageHeader } from "@/components/ui";
import type { Dog } from "@/lib/types";
import { getJSON } from "@/lib/ui";

type Item = { observation_id: string; dog_id: string; dog_name: string; session_id: string; day: number; start_s: number; end_s: number; machine_label: string; confidence?: number; video_url?: string; review_status: string; review?: { reviewer: string; reviewed_at: string; corrected_label?: string; context?: string; note?: string } };
const field = "min-h-10 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm";
export function BehaviorReview() {
  const auth = useAuth();
  return <Gate allow={["staff", "vet"]}><Queue reviewer={auth.userLabel ?? "Shelter staff"} /></Gate>;
}
function Queue({ reviewer }: { reviewer: string }) {
  const [items, setItems] = useState<Item[]>([]); const [dogs, setDogs] = useState<Dog[]>([]); const [error, setError] = useState("");
  const [status, setStatus] = useState("all"); const [dog, setDog] = useState("all"); const [behavior, setBehavior] = useState(""); const [session, setSession] = useState(""); const [minConfidence, setMinConfidence] = useState("");
  async function reload() {
    const query = new URLSearchParams(); if (status !== "all") query.set("status", status); if (dog !== "all") query.set("dog", dog); if (behavior) query.set("behavior", behavior); if (session) query.set("session", session); if (minConfidence) query.set("min_confidence", minConfidence);
    try { const [queue, roster] = await Promise.all([getJSON<Item[]>(`/api/behavior/reviews?${query}`), getJSON<Dog[]>("/api/dogs")]); setItems(queue); setDogs(roster); setError(""); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => {
    const query = new URLSearchParams(); if (status !== "all") query.set("status", status); if (dog !== "all") query.set("dog", dog); if (behavior) query.set("behavior", behavior); if (minConfidence) query.set("min_confidence", minConfidence);
    let active = true;
    Promise.all([getJSON<Item[]>(`/api/behavior/reviews?${query}`), getJSON<Dog[]>("/api/dogs")])
      .then(([queue, roster]) => { if (active) { setItems(queue); setDogs(roster); setError(""); } })
      .catch((e) => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, [status, dog, behavior, session, minConfidence]);
  const counts = useMemo(() => Object.fromEntries(["unreviewed", "confirmed", "corrected", "rejected"].map((s) => [s, items.filter((x) => x.review_status === s).length])), [items]);
  async function review(item: Item, verdict: string, form: FormData) {
    try { const r = await fetch("/api/behavior/reviews", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ observation_id: item.observation_id, status: verdict, reviewer, context: form.get("context"), note: form.get("note"), corrected_label: form.get("corrected_label") }) }); const result = await r.json(); if (!r.ok) throw new Error(result.error ?? "Could not save review"); await reload(); }
    catch (e) { setError((e as Error).message); }
  }
  return <div className="space-y-6">
    <PageHeader title="Behavior observation review" sub="Review machine observations against their video evidence. A review is staff context, not a diagnosis." />
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Object.entries(counts).map(([s, n]) => <Card key={s}><p className="text-2xl font-semibold tabular-nums">{n}</p><p className="text-sm capitalize text-muted">{s}</p></Card>)}</div>
    <Card><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">Dog<select className={`${field} mt-1`} value={dog} onChange={(e) => setDog(e.target.value)}><option value="all">All dogs</option>{dogs.map((d) => <option key={d.dog_id} value={d.dog_id}>{d.name}</option>)}</select></label>
      <label className="text-sm">Review status<select className={`${field} mt-1`} value={status} onChange={(e) => setStatus(e.target.value)}>{["all", "unreviewed", "confirmed", "corrected", "rejected"].map((s) => <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>)}</select></label>
      <label className="text-sm">Behavior<input className={`${field} mt-1`} value={behavior} onChange={(e) => setBehavior(e.target.value)} placeholder="Filter label" /></label>
      <label className="text-sm">Session / day<input className={`${field} mt-1`} value={session} onChange={(e) => setSession(e.target.value)} placeholder="Session ID or day number" /></label>
      <label className="text-sm">Minimum confidence<input className={`${field} mt-1`} value={minConfidence} onChange={(e) => setMinConfidence(e.target.value)} type="number" min="0" max="1" step="0.05" placeholder="Not available for most events" /></label>
    </div></Card>
    {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
    {items.length === 0 ? <Empty title="No observations match" body="Try another status or dog. Machine observations appear after pipeline video analysis." /> : <div className="grid gap-4">{items.map((item) => <ObservationCard key={item.observation_id} item={item} onReview={review} />)}</div>}
    <p className="text-xs text-muted"><a className="underline" href="/api/behavior/export?training=1">Download confirmed and corrected observations (JSON)</a></p>
  </div>;
}
function ObservationCard({ item, onReview }: { item: Item; onReview: (item: Item, verdict: string, form: FormData) => Promise<void> }) {
  const ref = useRef<HTMLVideoElement>(null); const [correct, setCorrect] = useState(false);
  const label = item.machine_label || "Unlabeled event";
  return <Card as="article" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2"><div><a className="font-semibold text-forest underline" href={`/dogs/${encodeURIComponent(item.dog_id)}`}>{item.dog_name}</a><p className="text-xs text-muted">Session {item.session_id} · day {item.day}</p></div><span className="rounded-full bg-sand px-3 py-1 text-xs font-semibold capitalize">{item.review_status}</span></div>
      <div className="mt-4 rounded-xl bg-canvas p-4"><p className="text-[11px] font-bold uppercase tracking-wide text-muted">Machine observation</p><p className="mt-1 text-lg font-semibold">{label}</p><p className="text-sm text-muted">{Math.floor(item.start_s / 60)}:{String(Math.round(item.start_s % 60)).padStart(2, "0")}–{Math.floor(item.end_s / 60)}:{String(Math.round(item.end_s % 60)).padStart(2, "0")} · {item.confidence === undefined ? "Confidence not available" : `Confidence ${Math.round(item.confidence * 100)}%`}</p></div>
      {item.review && <div className="mt-3 rounded-xl border border-line p-3 text-sm"><p className="font-semibold">Human review · {item.review.reviewer}</p><p className="text-xs text-muted">{new Date(item.review.reviewed_at).toLocaleString()}</p><p>Original label: {item.review.original_label}{item.review.corrected_label ? ` · corrected to ${item.review.corrected_label}` : ""}</p>{item.review.context && <p>Context: {item.review.context}</p>}{item.review.note && <p>Note: {item.review.note}</p>}</div>}
      {item.review_status === "unreviewed" && <form action={async (fd) => { const v = String(fd.get("verdict") ?? "confirmed"); await onReview(item, v, fd); }} className="mt-4 space-y-3">
        <label className="block text-sm">Context<select name="context" className={`${field} mt-1`}><option value="">Choose context (optional)</option>{["kennel", "walk", "foster", "meet-and-greet", "play", "intake", "other"].map((v) => <option key={v}>{v}</option>)}</select></label>
        <label className="block text-sm">Staff note<input name="note" className={`${field} mt-1`} maxLength={1000} placeholder="Optional context for the next reviewer" /></label>
        {correct && <label className="block text-sm">Corrected behavior label<input name="corrected_label" className={`${field} mt-1`} required maxLength={100} placeholder="Enter observed behavior" /></label>}
        <div className="flex flex-wrap gap-2">{correct ? <Button type="submit" name="verdict" value="corrected">Save correction</Button> : <><Button type="submit" name="verdict" value="confirmed">Confirm observation</Button><Button type="submit" name="verdict" value="rejected" variant="secondary">Reject</Button><Button type="button" variant="secondary" onClick={() => setCorrect(true)}>Correct label</Button></>}</div>
      </form>}
    </div>
    <div>{item.video_url ? <><video ref={ref} src={item.video_url} controls muted playsInline preload="metadata" className="aspect-video w-full rounded-xl bg-bark" /><button type="button" onClick={() => { if (ref.current) { ref.current.currentTime = item.start_s; void ref.current.play().catch(() => {}); } }} className="mt-2 text-sm font-semibold text-forest underline">Play evidence at {Math.floor(item.start_s / 60)}:{String(Math.round(item.start_s % 60)).padStart(2, "0")}</button></> : <p className="rounded-xl bg-canvas p-6 text-sm text-muted">Video evidence is unavailable for this observation.</p>}</div>
  </Card>;
}
