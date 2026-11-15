"use client";

import Link from "next/link";
import { useState } from "react";
import { Gate, useAuth } from "@/components/AuthProvider";
import { DogCard } from "@/components/DogCard";
import { ExperienceFit } from "@/components/ExperienceFit";
import { FamilyCard } from "@/components/FamilyCard";
import { Button, Caption, Card, Empty, ErrorNote, PageTitle, Spinner } from "@/components/ui";
import { EVERYONE } from "@/lib/access";
import { displayName } from "@/lib/dogs";
import { fosterReason } from "@/lib/match";
import type { Dog, Family, Match } from "@/lib/types";
import { LEVEL_RANK, postJSON } from "@/lib/ui";
import { useApi } from "@/lib/useApi";

type Board = { ran?: boolean; matches: Match[]; unmatched: string[] };
type Row = { m: Match; dog: Dog; fam: Family };

function scoreTone(score: number) {
  if (score >= 80) return "bg-emerald-700";
  if (score >= 65) return "bg-clay-dark";
  return "bg-amber-700";
}

// Green/Yellow first, Orange/Red last; best score first within each group.
const byLevelThenScore = (a: Row, b: Row) =>
  Number(LEVEL_RANK[a.dog.handling_level] >= 2) - Number(LEVEL_RANK[b.dog.handling_level] >= 2) || b.m.score - a.m.score;

export default function Page() {
  return (
    <Gate allow={EVERYONE}>
      <MatchPage />
    </Gate>
  );
}

function MatchPage() {
  const auth = useAuth();
  const isFamily = auth.role === "family";
  const dogs = useApi<Dog[]>("/api/dogs");
  const families = useApi<Family[]>("/api/families");
  const board = useApi<Board>("/api/match");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runId, setRunId] = useState(0); // bumps on each run so the cards replay their entrance

  async function rerun() {
    setRunning(true);
    setRunError(null);
    try {
      const res = await postJSON<Board>("/api/match");
      board.setData({ ...res, ran: true });
      setRunId((n) => n + 1);
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
    .filter((r): r is Row => Boolean(r.dog && r.fam))
    .filter((r) => !isFamily || r.fam.family_id === auth.familyId)
    .sort(byLevelThenScore);
  const unmatched = (board.data?.unmatched ?? []).map((id) => dogById.get(id)).filter((d): d is Dog => Boolean(d));
  const roster = dogs.data ?? [];
  const foster = unmatched
    .map((d) => ({ dog: d, reason: fosterReason(d, families.data ?? []) }))
    .filter((x): x is { dog: Dog; reason: string } => Boolean(x.reason))
    .map((x) => ({ ...x, reason: x.reason.replace(x.dog.name, displayName(x.dog, roster)) }));
  const waiting = unmatched.filter((d) => !foster.some((f) => f.dog.dog_id === d.dog_id));
  const hasRun = board.data?.ran || (board.data?.matches.length ?? 0) > 0;
  const dogHref = (d: Dog) => (isFamily ? `/passport/${d.dog_id}` : `/dogs/${d.dog_id}`);

  return (
    <div>
      <PageTitle
        title={isFamily ? "Your match" : "Match Board"}
        sub={
          isFamily
            ? "Picked from real behavior, never breed — with every family and dog considered together."
            : "The best overall pairing for the whole shelter — every dog and family considered together."
        }
        right={
          isFamily ? (
            auth.mode === "demo" && families.data?.length ? (
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted">Viewing as</span>
                <select
                  value={auth.familyId ?? ""}
                  onChange={(e) => auth.setFamilyId(e.target.value || null)}
                  className="rounded-full border border-line bg-white px-3 py-2 font-semibold outline-none focus:border-clay"
                >
                  <option value="">Choose a family…</option>
                  {families.data.map((f) => <option key={f.family_id} value={f.family_id}>{f.name}</option>)}
                </select>
              </label>
            ) : null
          ) : (
            <Button onClick={rerun} loading={running} variant={hasRun ? "ghost" : "primary"}>
              {running ? "Re-matching…" : hasRun ? "Re-run match" : "Run match"}
            </Button>
          )
        }
      />

      {(error || runError) && <div className="mb-4"><ErrorNote message={(runError || error)!} onRetry={runError ? rerun : board.reload} /></div>}

      {loading || running ? (
        <Spinner label={running ? "Weighing every dog against every family…" : "Loading the board…"} />
      ) : isFamily && !auth.familyId ? (
        <Empty
          title="Let's get to know you first"
          body="Finish a quick intake chat and your match will appear here after the shelter's next run."
          action={<Link href="/intake" className="font-bold text-clay-dark underline">Start family intake</Link>}
        />
      ) : !hasRun ? (
        <Empty
          title="No matches yet"
          body={isFamily ? "The shelter hasn't run a match yet — check back soon." : "Run the whole-shelter match to pair every dog with the family that fits best."}
          action={isFamily ? undefined : <Button onClick={rerun}>Run whole-shelter match</Button>}
        />
      ) : (
        <div className="space-y-8">
          <section key={runId} className="space-y-4 sm:space-y-5">
            {rows.length === 0 && (
              <Empty
                title={isFamily ? "No match for you this round" : "No safe pairings this round"}
                body={isFamily ? "That's okay — new dogs arrive every week, and the right one is worth the wait." : "Every possible pairing hit a need the family can't meet yet."}
              />
            )}
            {rows.map(({ m, dog, fam }, i) => (
              <Card key={m.dog_id} className="rise p-4 sm:p-5" style={{ animationDelay: `${i * 90}ms` }}>
                <div className="relative grid items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
                  {/* Soft connector between the paired cards: vertical when stacked, horizontal side by side. */}
                  <span
                    aria-hidden
                    className="draw-y absolute bottom-8 left-1/2 top-8 w-1 -translate-x-1/2 rounded-full bg-gradient-to-b from-clay/10 via-clay/40 to-clay/10 md:hidden"
                    style={{ animationDelay: `${i * 90 + 200}ms` }}
                  />
                  <span
                    aria-hidden
                    className="draw-x absolute left-[20%] right-[20%] top-1/2 hidden h-1 -translate-y-1/2 rounded-full bg-gradient-to-r from-clay/10 via-clay/40 to-clay/10 md:block"
                    style={{ animationDelay: `${i * 90 + 200}ms` }}
                  />
                  <div className="relative z-10"><DogCard dog={dog} compact href={dogHref(dog)} roster={roster} /></div>
                  <div className="relative z-10 flex flex-row items-center justify-center gap-3 md:flex-col">
                    <div
                      className={`grid h-16 w-16 place-items-center rounded-full text-white shadow-md ring-4 ring-white ${scoreTone(m.score)}`}
                      aria-label={`Fit score ${m.score}`}
                    >
                      <span className="text-center leading-none">
                        <span className="block font-display text-2xl font-semibold">{m.score}</span>
                        <span className="text-[11px] font-bold uppercase tracking-wider opacity-90">fit</span>
                      </span>
                    </div>
                    {dog.handling_level === "Red" && (
                      <span className="max-w-[10rem] rounded-xl bg-rose-50 px-2.5 py-1 text-center text-[11px] font-bold leading-tight text-rose-800 ring-1 ring-rose-200">
                        Foster-to-adopt · expert sign-off required
                      </span>
                    )}
                  </div>
                  <div className="relative z-10"><FamilyCard family={fam} /></div>
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

          {!isFamily && (
            <div className="space-y-8">
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="font-display text-2xl font-semibold">Needs behavior team / experienced foster</h2>
                  <span className="rounded-full bg-sand px-2.5 py-0.5 text-xs font-bold text-muted">{foster.length}</span>
                </div>
                {foster.length ? (
                  <div className="rounded-3xl border-2 border-dashed border-orange-200 bg-orange-50/40 p-4">
                    <p className="mb-3 text-sm text-muted">
                      Blocked for every waiting family by handling level or approachability. A foster or a behavior-team plan comes first.
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {foster.map(({ dog: d, reason }) => (
                        <div key={d.dog_id}>
                          <DogCard dog={d} roster={roster} />
                          <p className="mt-2 px-1 text-sm font-semibold text-amber-900">{reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200">
                    No dog is blocked for every family this round.
                  </p>
                )}
              </section>
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="font-display text-2xl font-semibold">Waiting for the right family</h2>
                  <span className="rounded-full bg-sand px-2.5 py-0.5 text-xs font-bold text-muted">{waiting.length}</span>
                </div>
                {waiting.length ? (
                  <div className="rounded-3xl border-2 border-dashed border-line bg-white/60 p-4">
                    <p className="mb-3 text-sm text-muted">
                      These dogs fit some families, but those families were paired elsewhere. They&apos;re waiting for the next family.
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {waiting.map((d) => <DogCard key={d.dog_id} dog={d} roster={roster} />)}
                    </div>
                  </div>
                ) : (
                  <p className="rounded-2xl bg-sand px-4 py-3 text-sm text-muted">
                    Nobody is left over because families ran out.
                  </p>
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
