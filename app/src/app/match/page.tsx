"use client";

import { useState } from "react";
import { DogCard } from "@/components/DogCard";
import { ExperienceFit } from "@/components/ExperienceFit";
import { FamilyCard } from "@/components/FamilyCard";
import { Button, Caption, Card, Empty, ErrorNote, PageTitle, Spinner } from "@/components/ui";
import type { Dog, Family, Match } from "@/lib/types";
import { postJSON } from "@/lib/ui";
import { useApi } from "@/lib/useApi";

type Board = { ran?: boolean; matches: Match[]; unmatched: string[] };

function scoreTone(score: number) {
  if (score >= 80) return "bg-emerald-600";
  if (score >= 65) return "bg-clay";
  return "bg-amber-500";
}

export default function MatchPage() {
  const dogs = useApi<Dog[]>("/api/dogs");
  const families = useApi<Family[]>("/api/families");
  const board = useApi<Board>("/api/match");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  async function rerun() {
    setRunning(true);
    setRunError(null);
    try {
      const res = await postJSON<Board>("/api/match");
      board.setData({ ...res, ran: true });
    } catch (err) {
      setRunError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const loading = dogs.loading || families.loading || board.loading;
  const error = dogs.error || families.error || board.error;
  const dogById = new Map((dogs.data ?? []).map((d) => [d.dog_id, d]));
  const famById = new Map((families.data ?? []).map((f) => [f.family_id, f]));
  const rows = (board.data?.matches ?? [])
    .map((m) => ({ m, dog: dogById.get(m.dog_id), fam: famById.get(m.family_id) }))
    .filter((r): r is { m: Match; dog: Dog; fam: Family } => Boolean(r.dog && r.fam))
    .sort((a, b) => b.m.score - a.m.score);
  const unmatched = (board.data?.unmatched ?? []).map((id) => dogById.get(id)).filter((d): d is Dog => Boolean(d));
  const hasRun = board.data?.ran || rows.length > 0 || unmatched.length > 0;

  return (
    <div>
      <PageTitle
        title="Match Board"
        sub="The best overall pairing for the whole shelter — every dog and family considered together."
        right={
          <Button onClick={rerun} loading={running} variant={hasRun ? "ghost" : "primary"}>
            {running ? "Re-matching…" : hasRun ? "Re-run match" : "Run match"}
          </Button>
        }
      />

      {(error || runError) && <div className="mb-4"><ErrorNote message={(runError || error)!} onRetry={runError ? rerun : board.reload} /></div>}

      {loading || running ? (
        <Spinner label={running ? "Weighing every dog against every family…" : "Loading the board…"} />
      ) : !hasRun ? (
        <Empty
          title="No matches yet"
          body="Run the whole-shelter match to pair every dog with the family that fits best."
          action={<Button onClick={rerun}>Run whole-shelter match</Button>}
        />
      ) : (
        <div className="space-y-8">
          <section className="space-y-4">
            {rows.length === 0 && <Empty title="No safe pairings this round" body="Every possible pairing hit a need the family can't meet yet." />}
            {rows.map(({ m, dog, fam }) => (
              <Card key={m.dog_id} className="rise p-4 sm:p-5">
                <div className="grid items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
                  <DogCard dog={dog} compact />
                  <div className="flex flex-row items-center justify-center gap-3 md:flex-col">
                    <span className="hidden text-2xl text-line md:block" aria-hidden>⟷</span>
                    <div className={`grid h-16 w-16 place-items-center rounded-full text-white shadow-md ${scoreTone(m.score)}`}>
                      <span className="text-center leading-none">
                        <span className="block font-display text-2xl font-semibold">{m.score}</span>
                        <span className="text-[9px] font-bold uppercase tracking-wider opacity-80">fit</span>
                      </span>
                    </div>
                  </div>
                  <FamilyCard family={fam} />
                </div>
                <div className="mt-4 grid gap-4 border-t border-line pt-4 md:grid-cols-[1.4fr_1fr]">
                  <ul className="space-y-1.5">
                    {m.reasons.length ? (
                      m.reasons.map((r) => (
                        <li key={r} className="flex gap-2 text-sm">
                          <span className="mt-0.5 text-sage">✓</span>
                          <span>{r}</span>
                        </li>
                      ))
                    ) : (
                      <li className="text-sm text-muted">A solid all-round fit.</li>
                    )}
                  </ul>
                  <ExperienceFit dog={dog} family={fam} />
                </div>
                <Caption className="mt-3" />
              </Card>
            ))}
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="font-display text-2xl font-semibold">Needs behavior team / experienced foster</h2>
              <span className="rounded-full bg-sand px-2.5 py-0.5 text-xs font-bold text-muted">{unmatched.length}</span>
            </div>
            {unmatched.length ? (
              <div className="rounded-3xl border-2 border-dashed border-orange-200 bg-orange-50/40 p-4">
                <p className="mb-3 text-sm text-muted">
                  No waiting family can meet these dogs&apos; needs yet. They&apos;re a great fit for a foster or a behavior-team plan.
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {unmatched.map((d) => <DogCard key={d.dog_id} dog={d} />)}
                </div>
              </div>
            ) : (
              <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200">
                Every dog has a family this round.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
