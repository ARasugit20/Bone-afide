"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PassportQr } from "@/components/PassportQr";
import { Bar, Button, Caption, Card, DogPhoto, Empty, ErrorNote, LevelChip, NeedChip, ReviewBadge, SectionTitle, Skeleton, Source } from "@/components/ui";
import { formatDateTime } from "@/lib/text";
import type { Dog, Rental, RentalJob } from "@/lib/types";
import { getJSON, LEVELS, postJSON } from "@/lib/ui";
import { useApi } from "@/lib/useApi";

type Summary = { summary: string; provider: "bedrock" | "gemini"; label: string };

export function PassportView() {
  const { dogId } = useParams<{ dogId: string }>();
  const dog = useApi<Dog>(`/api/dogs/${dogId}`);

  if (dog.loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6" aria-busy="true">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    );
  }
  if (dog.error || !dog.data) return <Empty title="Passport not found" body={dog.error ?? "This dog may have been adopted."} />;

  const d = dog.data;
  const name = d.name; // adopter-facing: no staff ID suffix
  return (
    <article className="mx-auto max-w-3xl space-y-6 print:space-y-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <p className="text-sm font-semibold text-muted">Behavior passport</p>
        <div className="flex gap-2">
          <CopyLinkButton />
          <Button variant="secondary" onClick={() => window.print()}>Print</Button>
        </div>
      </div>

      <Card as="section" className="print:shadow-none">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <DogPhoto dog={d} className="h-24 w-24 sm:h-28 sm:w-28" rounded="rounded-2xl" priority sizes="112px" />
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">{name}</h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <LevelChip level={d.handling_level} showLabel />
              <ReviewBadge dog={d} />
            </div>
            <p className="mt-2 text-sm text-muted">Observed for {d.day} {d.day === 1 ? "day" : "days"} on kennel video.</p>
            <p className="mt-1 text-xs text-muted">Breed is never recorded. Matches use behavior only.</p>
          </div>
        </div>
        <PassportSummary dogId={d.dog_id} />
      </Card>

      <div className="grid gap-6 sm:grid-cols-2 print:grid-cols-2">
        <Card as="section" className="print:shadow-none">
          <SectionTitle title="Scores from video" />
          <div className="space-y-4">
            <Bar label="Energy" value={d.energy} />
            <Bar label="Stress" value={d.stress} color="bg-grass" />
            <Bar label="Approachability" value={d.approachability} color="bg-sky-400" />
            <Bar label="Confidence" value={d.confidence} color="bg-forest-dark" />
            <Bar label="Excitement spikes" value={d.arousal_spikes} max={10} hint="per session" color={LEVELS[d.handling_level].dot} />
          </div>
          <Caption className="mt-4" />
        </Card>
        <Card as="section" className="print:shadow-none">
          <SectionTitle title="What helps" />
          <div className="flex flex-wrap gap-2">
            {d.needs.length ? d.needs.map((n) => <NeedChip key={n} need={n} />) : <span className="text-sm text-muted">No special needs noted.</span>}
          </div>
          <p className="mt-4 text-sm text-muted">
            {d.handling_level} level: {LEVELS[d.handling_level].label.toLowerCase()}. Levels describe the home {name} needs today and change as dogs settle in.
          </p>
        </Card>
      </div>

      <Rentals dog={d} name={name} />

      <Card as="section" className="print:break-inside-avoid print:shadow-none">
        <PassportQr dogId={d.dog_id} name={name} />
      </Card>
    </article>
  );
}

function PassportSummary({ dogId }: { dogId: string }) {
  const [state, setState] = useState<{ data: Summary | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    postJSON<Summary>(`/api/passport/${dogId}`).then(
      (data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      },
      (err: Error) => {
        if (!cancelled) setState({ data: null, error: err.message, loading: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [dogId, nonce]);

  return (
    <div className="mt-6 border-t border-line pt-4">
      {state.loading ? (
        <div className="space-y-2"><Skeleton className="h-4" /><Skeleton className="h-4" /><Skeleton className="h-4 w-2/3" /></div>
      ) : state.error ? (
        <ErrorNote message={state.error} onRetry={() => { setState({ data: null, error: null, loading: true }); setNonce((n) => n + 1); }} />
      ) : state.data ? (
        <>
          <p className="text-[15px] leading-relaxed">{state.data.summary}</p>
          <Source className="mt-2">Written by {state.data.label}</Source>
        </>
      ) : null}
    </div>
  );
}

type RentalState = { rentals: Rental[]; job: RentalJob | null };
const POLL_MS = 5000;
const CAP_S = 6 * 60;

function elapsed(fromIso: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Rentals({ dog, name }: { dog: Dog; name: string }) {
  const url = `/api/rentals?dog_id=${encodeURIComponent(dog.dog_id)}`;
  const state = useApi<RentalState>(url);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [now, setNow] = useState(0); // ticks while searching; never read the clock during prerender
  const list = state.data?.rentals ?? [];
  const job = state.data?.job ?? null;
  const running = job?.status === "running";
  const fetchedAt = list.map((r) => r.fetched_at).filter(Boolean).sort().at(-1);
  const { setData } = state;

  // While a search runs: poll every 5 s (the server advances the job) and tick the elapsed clock.
  useEffect(() => {
    if (!running) return;
    const poll = setInterval(() => {
      getJSON<RentalState>(url).then(setData, () => {});
    }, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [running, url, setData]);

  async function search() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await postJSON<{ job: RentalJob }>("/api/rentals", { dog_id: dog.dog_id });
      setNow(Date.now());
      setData({ rentals: list, job: res.job });
    } catch (err) {
      setStartError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }

  const failed = job && (job.status === "failed" || job.status === "timed_out") ? job : null;

  return (
    <Card as="section" className="print:break-inside-avoid print:shadow-none">
      <SectionTitle
        title="Rentals that accept this dog"
        sub={fetchedAt ? `Fetched ${formatDateTime(fetchedAt)}` : `Dog-friendly listings with no breed restrictions, for ${name}'s future home.`}
        action={
          !running && (
            <Button variant="secondary" onClick={search} loading={starting} className="print:hidden">
              {list.length ? "Refresh" : "Find rentals"}
            </Button>
          )
        }
      />
      {running && job && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-xl bg-canvas px-4 py-3 text-sm">
          <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-forest" />
          <span>Searching rental sites...</span>
          <span className="ml-auto tabular-nums text-muted">{elapsed(job.started_at, now)} of {CAP_S / 60}:00</span>
        </p>
      )}
      {failed && (
        <div className="mb-4">
          <ErrorNote
            message={failed.status === "timed_out" ? "The search took longer than 6 minutes and was stopped. Listing sites can be slow. Try again." : `The search didn't finish: ${failed.error ?? "unknown error"}`}
            onRetry={search}
          />
        </div>
      )}
      {job?.status === "done" && job.kept === 0 && (
        <p className="mb-3 text-sm text-muted">
          The last search found {job.found ?? 0} listings, but all had breed restrictions.{list.length ? " Showing the previous results." : ""}
        </p>
      )}
      {startError && <div className="mb-3"><ErrorNote message={startError} onRetry={search} /></div>}

      {state.loading ? (
        <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : state.error ? (
        <ErrorNote message={state.error} onRetry={state.reload} />
      ) : list.length ? (
        <ul className="divide-y divide-line">
          {list.map((r) => (
            <li key={r.url + r.name} className="py-3 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="font-semibold">{r.name}</p>
                {r.rent && <p className="text-sm tabular-nums">{typeof r.rent === "number" ? `$${r.rent.toLocaleString()}/mo` : r.rent}</p>}
              </div>
              {r.address && <p className="text-sm text-muted">{r.address}</p>}
              <dl className="mt-1 grid gap-x-4 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-muted">Weight limit</dt>
                <dd>{weightLimit(r.dog_weight_limit_lbs)}</dd>
                {r.pet_policy_text && (
                  <>
                    <dt className="text-muted">Pet policy</dt>
                    <dd className="line-clamp-3">{r.pet_policy_text}</dd>
                  </>
                )}
              </dl>
              <a href={r.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-semibold text-forest hover:underline print:hidden">
                View listing
              </a>
            </li>
          ))}
        </ul>
      ) : (
        !running && !job && <p className="text-sm text-muted">No listings gathered yet.</p>
      )}
      <Source className="mt-4">Listings gathered by TinyFish web agent</Source>
    </Card>
  );
}

function weightLimit(v: Rental["dog_weight_limit_lbs"]): string {
  if (v === null || v === undefined || v === "") return "Not listed";
  if (Number(v) > 0) return `${v} lb`;
  const t = String(v).trim();
  return /^none\.?$/i.test(t) ? "None listed" : t;
}

function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard can be blocked; the URL is still in the address bar.
        }
      }}
    >
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}
