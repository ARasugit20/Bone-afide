"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Gate } from "@/components/AuthProvider";
import { Button, ButtonLink, Card, DogPhoto, Empty, ErrorNote, LevelChip, SectionTitle, Skeleton, Today, UpdatedAt } from "@/components/ui";
import { STAFF_ONLY } from "@/lib/access";
import { displayName } from "@/lib/dogs";
import type { Dog, Family, HandlingLevel, Match, MatchRun } from "@/lib/types";
import { LEVEL_RANK, LEVELS, needsReview, postJSON } from "@/lib/ui";
import { useApi } from "@/lib/useApi";

const LEVEL_ORDER: HandlingLevel[] = ["Green", "Yellow", "Orange", "Red"];
const GRID_LIMIT = 6;

type Board = { ran: boolean; matches: Match[]; last_run: MatchRun | null };

export default function Page() {
  return (
    <Gate allow={STAFF_ONLY}>
      <Overview />
    </Gate>
  );
}

/** Dogs scored from real kennel video (they have an S3 photo) come first, then by name. */
const byRealThenName = (a: Dog, b: Dog) => Number(Boolean(b.photo)) - Number(Boolean(a.photo)) || a.name.localeCompare(b.name);

function Overview() {
  const router = useRouter();
  const dogs = useApi<Dog[]>("/api/dogs");
  const families = useApi<Family[]>("/api/families");
  const board = useApi<Board>("/api/match");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  async function runMatch() {
    setRunning(true);
    setRunError(null);
    try {
      await postJSON("/api/match");
      router.push("/match");
    } catch (err) {
      setRunError((err as Error).message);
    } finally {
      setRunning(false); // never leave the button busy, even if this page is restored from the router cache
    }
  }

  const list = (dogs.data ?? []).slice().sort(byRealThenName);
  const matchedFamilies = new Set((board.data?.matches ?? []).map((m) => m.family_id));
  const waiting = (families.data ?? []).filter((f) => !matchedFamilies.has(f.family_id)).length;
  const review = list.filter(needsReview).length;

  const stats = [
    { label: "Dogs in care", value: list.length, href: "/dogs", loading: dogs.loading },
    { label: "Families waiting", value: waiting, href: "/match", loading: families.loading || board.loading },
    { label: "Matches made", value: board.data?.matches.length ?? 0, href: "/match", loading: board.loading },
    { label: "Need vet review", value: review, href: "/dogs", loading: dogs.loading },
  ];
  const error = dogs.error || families.error || board.error;

  return (
    <div className="space-y-6 sm:space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Shelter overview</h1>
          <Today className="mt-1 text-sm text-muted" />
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/upload">Upload kennel video</ButtonLink>
          <Button variant="secondary" onClick={runMatch} loading={running}>
            {running ? "Running match" : "Run match"}
          </Button>
        </div>
      </header>

      {runError && <ErrorNote message={runError} onRetry={runMatch} />}
      {error && <ErrorNote message={error} onRetry={() => { dogs.reload(); families.reload(); board.reload(); }} />}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="rounded-2xl border border-line bg-surface px-4 py-4 transition hover:border-forest/40 sm:px-6">
            <dt className="text-sm text-muted">{s.label}</dt>
            <dd className="mt-1 font-display text-3xl font-semibold tabular-nums">
              {s.loading ? <Skeleton className="h-9 w-12" /> : s.value}
            </dd>
          </Link>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-8">
        <section aria-labelledby="dogs-in-care" className="order-2 lg:order-none">
          <SectionTitle
            id="dogs-in-care"
            title="Dogs in care"
            sub="Scores come from kennel video. Breed is never an input."
            action={<Link href="/dogs" className="text-sm font-semibold text-forest hover:underline">View all</Link>}
          />
          {dogs.loading ? (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
              {Array.from({ length: GRID_LIMIT }).map((_, i) => <Skeleton key={i} className="h-52 rounded-2xl sm:h-64" />)}
            </div>
          ) : list.length ? (
            <ul className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
              {list.slice(0, GRID_LIMIT).map((d, i) => <DogTile key={d.dog_id} dog={d} roster={list} priority={i < 3} />)}
            </ul>
          ) : (
            !dogs.error && <Empty title="No dogs yet" body="Upload a kennel video to score the first dog." action={<ButtonLink href="/upload">Upload kennel video</ButtonLink>} />
          )}
        </section>

        <div className="order-1 space-y-6 lg:order-none">
          <NeedsAttention dogs={list} loading={dogs.loading} />
          <LevelSummary dogs={list} loading={dogs.loading} />
        </div>
      </div>
    </div>
  );
}

function DogTile({ dog, roster, priority }: { dog: Dog; roster: Dog[]; priority?: boolean }) {
  return (
    <li>
      <Link href={`/dogs/${dog.dog_id}`} className="group block overflow-hidden rounded-2xl border border-line bg-surface transition hover:border-forest/40 hover:shadow-card">
        <DogPhoto dog={dog} className="aspect-[4/3] w-full" rounded="rounded-none" sizes="(min-width: 1280px) 280px, 50vw" priority={priority} eager />
        <div className="p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <h3 className="truncate font-semibold group-hover:text-forest">{displayName(dog, roster)}</h3>
            <LevelChip level={dog.handling_level} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted">Stress</dt>
              <dd className="font-semibold tabular-nums">{dog.stress}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted"><span className="sm:hidden">Approach.</span><span className="hidden sm:inline">Approachability</span></dt>
              <dd className="font-semibold tabular-nums">{dog.approachability}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">{dog.updated_at ? <UpdatedAt iso={dog.updated_at} /> : "Not scanned yet"}</p>
        </div>
      </Link>
    </li>
  );
}

type Attention = { dog: Dog; reason: string; action: string; rank: number };

function attentionFor(d: Dog): Attention | null {
  if (d.handling_level === "Red" && !d.expert_reviewed) return { dog: d, reason: "Red level, not vet reviewed", action: "Book vet review", rank: 0 };
  if (d.handling_level === "Orange" && !d.expert_reviewed) return { dog: d, reason: "Orange level is provisional", action: "Book vet review", rank: 1 };
  if (d.stress >= 60) return { dog: d, reason: `High stress (${d.stress})`, action: "Plan a calm start", rank: 2 };
  if (d.trend === "worsening") return { dog: d, reason: "Stress rising between sessions", action: "Check notes", rank: 3 };
  if (!d.expert_reviewed) return { dog: d, reason: "No vet review yet", action: "Review scores", rank: 4 };
  return null;
}

function NeedsAttention({ dogs, loading }: { dogs: Dog[]; loading: boolean }) {
  const items = dogs
    .map(attentionFor)
    .filter((x): x is Attention => x !== null)
    .sort((a, b) => a.rank - b.rank || LEVEL_RANK[b.dog.handling_level] - LEVEL_RANK[a.dog.handling_level] || a.dog.name.localeCompare(b.dog.name));
  const shown = items.slice(0, 6);

  return (
    <Card as="section" flush>
      <div className="flex items-center justify-between px-4 pt-4 sm:px-6 sm:pt-6">
        <h2 className="font-display text-lg font-semibold">Needs attention</h2>
        {!loading && <span className="text-sm text-muted tabular-nums">{items.length}</span>}
      </div>
      {loading ? (
        <div className="space-y-3 p-4 sm:p-6">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : shown.length ? (
        <ul className="mt-2 divide-y divide-line">
          {shown.map(({ dog, reason, action }) => (
            <li key={dog.dog_id}>
              <Link href={`/dogs/${dog.dog_id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-canvas sm:px-6">
                <DogPhoto dog={dog} className="h-9 w-9" rounded="rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{dog.name}</p>
                  <p className="truncate text-xs text-muted">{reason}</p>
                </div>
                <span className="shrink-0 text-xs font-semibold text-forest">{action}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 pb-6 pt-2 text-sm text-muted sm:px-6">Nothing needs attention right now.</p>
      )}
      {items.length > shown.length && (
        <Link href="/dogs" className="block border-t border-line px-4 py-3 text-sm font-semibold text-forest hover:underline sm:px-6">
          {items.length - shown.length} more
        </Link>
      )}
    </Card>
  );
}

function LevelSummary({ dogs, loading }: { dogs: Dog[]; loading: boolean }) {
  const counts = LEVEL_ORDER.map((l) => ({ level: l, n: dogs.filter((d) => d.handling_level === l).length }));
  const total = dogs.length || 1;
  return (
    <Card as="section">
      <h2 className="font-display text-lg font-semibold">Handling levels</h2>
      <p className="mt-0.5 text-sm text-muted">The kind of home each dog needs today.</p>
      {loading ? (
        <Skeleton className="mt-4 h-2" />
      ) : (
        <>
          <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-sand" role="img" aria-label={counts.map((c) => `${c.level} ${c.n}`).join(", ")}>
            {counts.map((c) => c.n > 0 && <div key={c.level} className={LEVELS[c.level].dot} style={{ width: `${(c.n / total) * 100}%` }} />)}
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {counts.map((c) => (
              <li key={c.level} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span aria-hidden className={`h-2 w-2 rounded-full ${LEVELS[c.level].dot}`} />
                  {c.level}
                </span>
                <span className="font-semibold tabular-nums">{c.n}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
