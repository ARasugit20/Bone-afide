"use client";
import { useEffect, useState } from "react";
import type { Dog } from "@/lib/types";
import { qualitySummary } from "@/lib/behavior-intelligence";
import { Card, SectionTitle } from "./ui";

const CONTEXTS = ["kennel", "walk", "foster", "meet-and-greet", "play", "intake", "other"];
export function BehaviorEvidence({ dog }: { dog: Dog }) {
  const quality = qualitySummary(dog); const sessionId = `${dog.dog_id}:day-${dog.day}`;
  const [context, setContext] = useState(""); const [saved, setSaved] = useState(false);
  useEffect(() => { fetch(`/api/behavior/context?dog_id=${encodeURIComponent(dog.dog_id)}`).then((r) => r.ok ? r.json() : []).then((rows: { session_id: string; context: string }[]) => setContext(rows.find((r) => r.session_id === sessionId)?.context ?? "")).catch(() => {}); }, [dog.dog_id, sessionId]);
  async function save() { if (!context) return; const r = await fetch("/api/behavior/context", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dog_id: dog.dog_id, session_id: sessionId, context }) }); if (!r.ok) throw new Error("Could not save context"); setSaved(true); }
  return <Card as="section"><SectionTitle title="Observed during this session" sub="Machine observations with event timestamps; context matters." />
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <div className="rounded-xl bg-canvas p-4"><h3 className="text-xs font-bold uppercase tracking-wide text-muted">Measured observations</h3><ul className="mt-2 space-y-1 text-sm">
        <li>Video events detected: {dog.events?.length ?? "not recorded"}</li>
        <li>Settled time: {dog.evidence ? `${dog.evidence.pct_time_calm}% of analyzed clip` : "not recorded"}</li>
        <li>Session duration: {dog.evidence ? `${dog.evidence.clip_seconds}s` : "not recorded"}</li>
        {dog.events?.slice(0, 4).map((e, i) => <li key={`${e.start_s}-${i}`}><a href="#tracking-evidence" className="text-forest underline">{e.label} at {Math.floor(e.start_s / 60)}:{String(Math.round(e.start_s % 60)).padStart(2, "0")}</a></li>)}
      </ul></div>
      <div className="rounded-xl bg-canvas p-4"><h3 className="text-xs font-bold uppercase tracking-wide text-muted">Interpretation</h3><p className="mt-2 text-sm">{dog.stress >= 61 ? "Elevated stress-associated pattern in this session; review recommended." : dog.stress >= 31 ? "Some stress-associated signals were measured in this session; review the observations in context." : "The measured stress score was in the lower range for this session."}</p><p className="mt-2 text-xs text-muted">This is a session-level signal, not a diagnosis or permanent temperament label.</p></div>
    </div>
    <div className="mt-4 flex flex-col gap-2 rounded-xl border border-line p-3 sm:flex-row sm:items-end"><label className="flex-1 text-sm">Session context<select className="mt-1 min-h-10 w-full rounded-xl border border-line bg-surface px-3" value={context} onChange={(e) => { setContext(e.target.value); setSaved(false); }}><option value="">Not recorded</option>{CONTEXTS.map((c) => <option key={c}>{c}</option>)}</select></label><button type="button" disabled={!context} onClick={() => void save()} className="min-h-10 rounded-xl bg-forest px-4 text-sm font-semibold text-white disabled:opacity-50">{saved ? "Context saved" : "Save context"}</button></div>
    <div className="mt-4 border-t border-line pt-4"><h3 className="text-sm font-semibold">Analysis quality: {quality.level}</h3>{quality.detection_coverage_pct !== undefined ? <p className="mt-1 text-sm text-muted">Dog detection coverage was {quality.detection_coverage_pct}% of frames. This summary uses pipeline metadata.</p> : <p className="mt-1 text-sm text-muted">{quality.basis} Confidence should not be inferred from this score alone.</p>}</div>
  </Card>;
}
