"use client";
import { useEffect, useState } from "react";
import { Gate } from "@/components/AuthProvider";
import { Button, Card, Empty, PageHeader } from "@/components/ui";
import type { Dog } from "@/lib/types";
import { getJSON, postJSON } from "@/lib/ui";
import { compareSessions } from "@/lib/behavior-intelligence";
type Rec = { dog_id: string; name: string; sessions: Record<string, unknown>[]; interventions: { intervention_id: string; type: string; occurred_at: string; staff: string; notes: string; outcome_note: string; before_day?: number | null; after_day?: number | null }[] };
const field = "min-h-10 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm";
export default function InterventionsPage() { return <Gate allow={["staff", "vet"]}><Interventions /></Gate>; }
function Interventions() {
  const [dogs, setDogs] = useState<Dog[]>([]); const [records, setRecords] = useState<Rec[]>([]); const [dogId, setDogId] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function load() { try { const d = await getJSON<Dog[]>("/api/dogs"); setDogs(d); if (!dogId && d[0]) setDogId(d[0].dog_id); const data = await getJSON<{ records: Rec[] }>(`/api/behavior/export${dogId ? `?dog_id=${encodeURIComponent(dogId)}` : ""}`); setRecords(data.records); setError(""); } catch (e) { setError((e as Error).message); } }
  useEffect(() => {
    let active = true;
    getJSON<Dog[]>("/api/dogs").then(async (roster) => {
      if (!active) return;
      setDogs(roster);
      const chosenId = dogId || roster[0]?.dog_id || "";
      if (!chosenId) return;
      if (!dogId) setDogId(chosenId);
      const data = await getJSON<{ records: Rec[] }>(`/api/behavior/export?dog_id=${encodeURIComponent(chosenId)}`);
      if (active) { setRecords(data.records); setError(""); }
    }).catch((e) => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, [dogId]);
  const selected = records.find((r) => r.dog_id === dogId) ?? records[0];
  async function create(fd: FormData) { setBusy(true); try { const local = String(fd.get("occurred_at") ?? ""); await postJSON("/api/behavior/interventions", { dog_id: dogId, type: fd.get("type"), occurred_at: local ? new Date(local).toISOString() : "", staff: fd.get("staff"), notes: fd.get("notes"), concern: fd.get("concern"), context: fd.get("context") }); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function updateOutcome(id: string, fd: FormData) { try { const r = await fetch("/api/behavior/interventions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intervention_id: id, outcome_note: fd.get("outcome_note"), before_day: fd.get("before_day"), after_day: fd.get("after_day") }) }); if (!r.ok) { const body = await r.json(); throw new Error(body.error ?? "Could not save outcome"); } await load(); } catch (e) { setError((e as Error).message); } }
  return <div className="space-y-6"><PageHeader title="Intervention tracking" sub="Record a shelter action, then compare observed sessions before and after. A change does not establish cause." />
    <Card><label className="block max-w-sm text-sm">Dog<select value={dogId} onChange={(e) => setDogId(e.target.value)} className={`${field} mt-1`}>{dogs.map((d) => <option key={d.dog_id} value={d.dog_id}>{d.name}</option>)}</select></label></Card>
    <Card><h2 className="font-semibold">Record an intervention</h2><form action={create} className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Intervention<select className={field} name="type">{[["quieter_kennel", "Moved to quieter kennel"], ["enrichment", "Enrichment added"], ["foster_sleepover", "Foster / sleepover"], ["staff_interaction", "Staff interaction"], ["exercise_walk", "Exercise / walk"], ["medical_review", "Medical review"], ["training", "Training session"], ["housing_change", "Housing change"], ["other", "Other"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="text-sm">Date/time<input className={field} name="occurred_at" type="datetime-local" required defaultValue={new Date().toISOString().slice(0, 16)} /></label>
      <label className="text-sm">Staff member<input className={field} name="staff" placeholder="Shelter staff" /></label>
      <label className="text-sm">Related concern<input className={field} name="concern" placeholder="Optional behavior concern" /></label>
      <label className="text-sm">Context<select className={field} name="context"><option value="">Not recorded</option>{["kennel", "walk", "foster", "meet-and-greet", "play", "intake", "other"].map((v) => <option key={v}>{v}</option>)}</select></label>
      <label className="text-sm sm:col-span-2">Notes<textarea className={field} name="notes" maxLength={1000} rows={2} /></label>
      <div><Button type="submit" loading={busy}>Save intervention</Button></div>
    </form></Card>
    {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm">{error}</p>}
    {selected && <><Card><h2 className="font-semibold">Observed change by session</h2><p className="mt-1 text-sm text-muted">Compare actual recorded score summaries. Session context defaults to unspecified unless staff records it.</p>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b border-line text-muted"><th className="p-2">Session</th><th className="p-2">Stress</th><th className="p-2">Energy</th><th className="p-2">Confidence</th><th className="p-2">Events</th></tr></thead><tbody>{selected.sessions.map((s) => <tr key={String(s.session_id)} className="border-b border-line"><th className="p-2 font-medium">Day {String(s.day)} <span className="text-muted">({String(s.context)})</span></th><td className="p-2">{String(s.stress ?? "—")}</td><td className="p-2">{String(s.energy ?? "—")}</td><td className="p-2">{String(s.confidence ?? "—")}</td><td className="p-2">{String(s.arousal_spikes ?? "—")}</td></tr>)}</tbody></table></div>
      <p className="mt-3 text-xs text-muted">Values are session summaries, not causal effects. Current pipeline persistence keeps full events only for the latest dog record.</p></Card>
      <div className="space-y-3">{selected.interventions.map((r) => {
        const before = selected.sessions.find((s) => Number(s.day) === Number(r.before_day)); const after = selected.sessions.find((s) => Number(s.day) === Number(r.after_day));
        const deltas = before && after ? compareSessions(before, after) : [];
        return <Card key={r.intervention_id}><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{r.type.replaceAll("_", " ")}</h3><time className="text-sm text-muted">{new Date(r.occurred_at).toLocaleString()}</time></div><p className="mt-1 text-sm">{r.notes || "No intervention notes."} · {r.staff}</p><p className="mt-2 text-sm text-muted">Observed change after intervention. Association only; causation is not established.</p>
          <form action={(fd) => updateOutcome(r.intervention_id, fd)} className="mt-3 grid gap-2 sm:grid-cols-2"><label className="text-sm">Before session<select className={field} name="before_day" defaultValue={r.before_day ?? ""}><option value="">Choose session</option>{selected.sessions.map((s) => <option key={String(s.day)} value={String(s.day)}>Day {String(s.day)} · {String(s.context)}</option>)}</select></label><label className="text-sm">After session<select className={field} name="after_day" defaultValue={r.after_day ?? ""}><option value="">Choose session</option>{selected.sessions.map((s) => <option key={String(s.day)} value={String(s.day)}>Day {String(s.day)} · {String(s.context)}</option>)}</select></label><label className="text-sm sm:col-span-2">Outcome note<input name="outcome_note" className={field} maxLength={1000} defaultValue={r.outcome_note} placeholder="Record outcome or later observations" /></label><div><Button type="submit" variant="secondary">Save comparison</Button></div></form>
          {deltas.length > 0 && <div className="mt-3 rounded-xl bg-canvas p-3"><p className="text-sm font-semibold">Before → after session changes</p>{deltas.map((delta) => <p key={delta.metric} className="mt-1 text-sm capitalize">{delta.metric.replaceAll("_", " ")}: {delta.previous} → {delta.current} ({delta.change > 0 ? "+" : ""}{delta.change})</p>)}</div>}
        </Card>;
      })}</div>
    </>}
    {!selected && <Empty title="No session data yet" body="The before and after comparison appears after session summaries are available." />}
    <a href={`/api/behavior/export?dog_id=${encodeURIComponent(dogId)}`} className="text-sm font-semibold text-forest underline">Download shelter behavior record (JSON)</a>
  </div>;
}
