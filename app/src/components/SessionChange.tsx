"use client";
import { useEffect, useState } from "react";
import { compareSessions } from "@/lib/behavior-intelligence";
import { Card, SectionTitle } from "./ui";
type RecordData = { sessions: Record<string, unknown>[]; session_change: { metric: string; previous: number; current: number; change: number }[] };
export function SessionChange({ dogId }: { dogId: string }) {
  const [data, setData] = useState<RecordData | null>(null);
  useEffect(() => { fetch(`/api/behavior/export?dog_id=${encodeURIComponent(dogId)}`).then((r) => r.ok ? r.json() : null).then((payload) => setData(payload?.records?.[0] ?? null)).catch(() => setData(null)); }, [dogId]);
  const sessions = data?.sessions ?? []; const older = sessions.at(-2); const latest = sessions.at(-1);
  const changes = older && latest ? compareSessions(older, latest) : [];
  return <Card as="section"><SectionTitle title="Why did this change?" sub="Observable score changes between the two latest stored sessions." />
    {!older || !latest ? <p className="mt-3 text-sm text-muted">A previous session is needed to compare changes.</p> : <><p className="mt-3 text-sm">Session day {String(older.day)} → day {String(latest.day)} · changes associated with the latest indicator</p><ul className="mt-3 space-y-2 text-sm">{changes.map((x) => <li key={x.metric} className="flex justify-between gap-4 border-b border-line pb-2"><span className="capitalize">{x.metric.replaceAll("_", " ")}</span><span className="tabular-nums">{x.previous} → {x.current} ({x.change > 0 ? "+" : ""}{x.change})</span></li>)}</ul><p className="mt-3 text-xs text-muted">These are session-level associations; they do not establish that one behavior caused another or caused a score change.</p></>}
  </Card>;
}
