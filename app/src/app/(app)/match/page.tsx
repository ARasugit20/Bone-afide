"use client";

import Link from "next/link";
import { useState } from "react";
import { Gate, useAuth } from "@/components/AuthProvider";
import { ExperienceFit } from "@/components/ExperienceFit";
import { FamilyCard } from "@/components/FamilyCard";
import { WhyLines } from "@/components/WhyLines";
import { Button, ButtonLink, Caption, Card, DogPhoto, Empty, ErrorNote, LevelChip, PageHeader, SectionTitle, Skeleton, Source } from "@/components/ui";
import { EVERYONE } from "@/lib/access";
import { displayName } from "@/lib/dogs";
import { fosterReason } from "@/lib/match";
import { formatDateTime, timeAgo } from "@/lib/text";
import type { Dog, Family, Match, MatchRun } from "@/lib/types";
import { ACTIVITY, HOME, KIDS, LEVEL_RANK, postJSON } from "@/lib/ui";
import { useApi } from "@/lib/useApi";
import { whyThisMatch } from "@/lib/why";

type Board = { ran?: boolean; matches: Match[]; unmatched: string[]; last_run?: MatchRun | null };
type Row = { m: Match; dog: Dog; fam: Family };

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

function familySummary(f: Family) {
  const parts = [HOME[f.home], KIDS[f.kids].toLowerCase(), f.other_pets.length ? `has ${f.other_pets.join(" and ")}` : "no other pets", `${ACTIVITY[f.activity].toLowerCase()} pace`];
  return parts.join(", ");
}

function MatchPage() {
  const auth = useAuth();
  const isFamily = auth.role === "family";
  const dogs = useApi<Dog[]>("/api/dogs");
  const families = useApi<Family[]>("/api/families");
  const board = useApi<Board>("/api/match");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  async function rerun() {
    setRunning(true);
    setRunError(null);
    try {
      board.setData(await postJSON<Board>("/api/match"));
      families.reload();
    } catch (err) {
      setRunError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const loading = dogs.loading || families.loading || board.loading;
  const error = dogs.error || families.error || board.error;
  const roster = dogs.data ?? [];
  const dogById = new Map(roster.map((d) => [d.dog_id, d]));
  const famById = new Map((families.data ?? []).map((f) => [f.family_id, f]));
  const rows = (board.data?.matches ?? [])
    .map((m) => ({ m, dog: dogById.get(m.dog_id), fam: famById.get(m.family_id) }))
    .filter((r): r is Row => Boolean(r.dog && r.fam))
    .filter((r) => !isFamily || r.fam.family_id === auth.familyId)
    .sort(byLevelThenScore);
  const unmatched = (board.data?.unmatched ?? []).map((id) => dogById.get(id)).filter((d): d is Dog => Boolean(d));
  const foster = unmatched
    .map((d) => ({ dog: d, reason: fosterReason(d, families.data ?? []) }))
    .filter((x): x is { dog: Dog; reason: string } => Boolean(x.reason));
  const waiting = unmatched.filter((d) => !foster.some((f) => f.dog.dog_id === d.dog_id));
  const hasRun = Boolean(board.data?.ran || board.data?.matches.length);
  const run = board.data?.last_run;
  const dogHref = (d: Dog) => (isFamily ? `/passport/${d.dog_id}` : `/dogs/${d.dog_id}`);

  const lastRunLine = run ? (
    <span title={formatDateTime(run.ran_at)}>
      Last run: {timeAgo(run.ran_at)}, {run.dogs} dogs, {run.families} families
    </span>
  ) : hasRun ? `${board.data?.matches.length ?? 0} matches saved` : "Not run yet";

  return (
    <div>
      <PageHeader
        title={isFamily ? "My match" : "Match board"}
        sub={isFamily ? "Matched on behavior and your home. Breed is never an input." : loading ? <Skeleton className="mt-1 h-5 w-64" /> : lastRunLine}
        actions={
          isFamily ? (
            families.data?.length && auth.mode === "demo" ? (
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted">Family</span>
                <select
                  value={auth.familyId ?? ""}
                  onChange={(e) => auth.setFamilyId(e.target.value || null)}
                  className="rounded-full border border-line bg-surface px-3 py-2 text-sm font-semibold outline-none focus:border-forest"
                >
                  <option value="">Choose a family</option>
                  {families.data.map((f) => <option key={f.family_id} value={f.family_id}>{f.name}</option>)}
                </select>
              </label>
            ) : null
          ) : (
            <Button onClick={rerun} loading={running} variant={hasRun ? "secondary" : "primary"}>
              {running ? "Running match" : "Run match"}
            </Button>
          )
        }
      />

      {(error || runError) && <div className="mb-4"><ErrorNote message={(runError || error)!} onRetry={runError ? rerun : board.reload} /></div>}

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : isFamily && !auth.familyId ? (
        <Empty
          title="Choose your family"
          body="Pick your family above, or complete the intake chat first."
          action={<ButtonLink href="/intake" variant="secondary">Start family intake</ButtonLink>}
        />
      ) : !hasRun ? (
        <Empty
          title="No matches yet"
          body={isFamily ? "The shelter hasn't run a match yet." : "Run the match to pair every dog with the family that fits best."}
          action={isFamily ? undefined : <Button onClick={rerun} loading={running}>Run match</Button>}
        />
      ) : isFamily ? (
        rows.length ? (
          <div className="space-y-4">
            {rows.map(({ m, dog, fam }) => (
              <Card key={m.dog_id} as="section">
                <div className="flex items-center gap-4">
                  <DogPhoto dog={dog} className="h-16 w-16" rounded="rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <Link href={dogHref(dog)} className="font-display text-xl font-semibold hover:text-forest">{displayName(dog, roster)}</Link>
                    <div className="mt-1"><LevelChip level={dog.handling_level} showLabel /></div>
                  </div>
                  <p className="text-right"><span className="block font-display text-2xl font-semibold tabular-nums">{m.score}</span><span className="text-xs text-muted">fit</span></p>
                </div>
                <div className="mt-3"><WhyLines why={whyThisMatch(dog, fam, m.reasons)} /></div>
                <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
                  <FamilyCard family={fam} />
                  <ExperienceFit dog={dog} family={fam} />
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Empty title="No match this round" body="New dogs are scored every week. Your profile stays in the next run." />
        )
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="pairs">
            <h2 id="pairs" className="sr-only">Pairs</h2>
            {rows.length === 0 ? (
              <Empty title="No safe pairings this round" body="Every possible pairing hit a need the family can't meet yet." />
            ) : (
              <>
                <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface md:block">
                  <table className="w-full text-sm">
                    <thead className="border-b border-line bg-canvas/60 text-left text-xs text-muted">
                      <tr>
                        <th scope="col" className="px-4 py-3 font-semibold">Dog</th>
                        <th scope="col" className="px-4 py-3 font-semibold">Family</th>
                        <th scope="col" className="px-4 py-3 text-right font-semibold">Fit</th>
                        <th scope="col" className="px-4 py-3 font-semibold">Why</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line align-top">
                      {rows.map(({ m, dog, fam }) => (
                        <tr key={m.dog_id}>
                          <td className="px-4 py-3">
                            <Link href={dogHref(dog)} className="flex items-center gap-3 hover:text-forest">
                              <DogPhoto dog={dog} className="h-10 w-10" rounded="rounded-lg" />
                              <span>
                                <span className="block font-semibold">{displayName(dog, roster)}</span>
                                <LevelChip level={dog.handling_level} />
                              </span>
                            </Link>
                          </td>
                          <td className="px-4 py-3">
                            <span className="block font-semibold">{fam.name}</span>
                            <span className="block max-w-[16rem] text-xs text-muted">{familySummary(fam)}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-display text-xl font-semibold tabular-nums">{m.score}</td>
                          <td className="px-4 py-3">
                            {dog.handling_level === "Red" && <p className="mb-1 text-xs font-semibold text-rose-800">Foster to adopt. Vet sign-off required.</p>}
                            <WhyLines why={whyThisMatch(dog, fam, m.reasons)} showSource={false} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <ul className="space-y-3 md:hidden">
                  {rows.map(({ m, dog, fam }) => (
                    <li key={m.dog_id} className="rounded-2xl border border-line bg-surface p-4">
                      <div className="flex items-center gap-3">
                        <DogPhoto dog={dog} className="h-12 w-12" rounded="rounded-lg" />
                        <div className="min-w-0 flex-1">
                          <Link href={dogHref(dog)} className="block truncate font-semibold">{displayName(dog, roster)}</Link>
                          <p className="truncate text-xs text-muted">with {fam.name}</p>
                        </div>
                        <span className="font-display text-xl font-semibold tabular-nums">{m.score}</span>
                      </div>
                      <div className="mt-3"><WhyLines why={whyThisMatch(dog, fam, m.reasons)} showSource={false} /></div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <Caption />
              <Source>Why lines come from the pipeline&apos;s video evidence where available, otherwise the matching rules. Data stored in MongoDB Atlas.</Source>
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <DogList
              title="Needs a foster or behavior plan"
              sub="Blocked for every waiting family by handling level or approachability."
              empty="No dog is blocked for every family this round."
              items={foster.map(({ dog, reason }) => ({ dog, note: reason }))}
              roster={roster}
            />
            <DogList
              title="Waiting for a family"
              sub="These dogs fit some families, but those families were paired with other dogs."
              empty="No dogs are waiting."
              items={waiting.map((dog) => ({ dog, note: `Day ${dog.day}` }))}
              roster={roster}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function DogList({ title, sub, empty, items, roster }: { title: string; sub: string; empty: string; items: { dog: Dog; note: string }[]; roster: Dog[] }) {
  return (
    <Card as="section" flush>
      <div className="px-4 pt-4 sm:px-6 sm:pt-6">
        <SectionTitle title={title} sub={sub} action={<span className="text-sm text-muted tabular-nums">{items.length}</span>} />
      </div>
      {items.length ? (
        <ul className="divide-y divide-line border-t border-line">
          {items.map(({ dog, note }) => (
            <li key={dog.dog_id}>
              <Link href={`/dogs/${dog.dog_id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-canvas sm:px-6">
                <DogPhoto dog={dog} className="h-9 w-9" rounded="rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{displayName(dog, roster)}</p>
                  <p className="truncate text-xs text-muted">{note}</p>
                </div>
                <LevelChip level={dog.handling_level} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 pb-6 text-sm text-muted sm:px-6">{empty}</p>
      )}
    </Card>
  );
}
