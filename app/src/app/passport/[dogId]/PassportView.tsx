"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Mascot } from "@/components/Mascot";
import { TrendChart, type TrendPoint } from "@/components/TrendChart";
import { Avatar, Bar, Button, Caption, Card, Empty, ErrorNote, LevelChip, NeedChip, ReviewBadge, Spinner, TrendBadge, UpdatedAt } from "@/components/ui";
import { peek, remember } from "@/lib/clientCache";
import { displayName } from "@/lib/dogs";
import type { Dog, Rental } from "@/lib/types";
import { LEVELS, postJSON } from "@/lib/ui";
import { useApi } from "@/lib/useApi";

type Trend = { fake: boolean; series: TrendPoint[] };

export function PassportView() {
  const { dogId } = useParams<{ dogId: string }>();
  const dog = useApi<Dog>(`/api/dogs/${dogId}`);
  const roster = useApi<Dog[]>("/api/dogs");
  const trend = useApi<Trend>(`/api/trend/${dogId}`);
  const rentals = useApi<Rental[]>(`/api/rentals?dog_id=${encodeURIComponent(dogId)}`);
  const summary = useSummary(dog.data ? dogId : null);

  if (dog.loading) return <Spinner label="Opening the behavior passport…" />;
  if (dog.error || !dog.data) return <Empty title="Passport not found" body={dog.error ?? "This dog may have already found a home!"} />;

  const d = dog.data;
  const name = displayName(d, roster.data ?? [d]);
  return (
    <article className="mx-auto max-w-3xl space-y-5 print:space-y-3">
      <div className="flex justify-end gap-2 print:hidden">
        <CopyLinkButton />
        <Button variant="ghost" onClick={() => window.print()}>Print</Button>
      </div>

      <Card className="rise relative overflow-hidden print:shadow-none">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-clay/10 blur-2xl" />
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-clay-dark">
          <Mascot className="h-6 w-6" /> Bonafide Behavior Passport
        </div>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar name={name} size="h-20 w-20 text-3xl" />
          <div>
            <h1 className="font-display text-4xl font-semibold">{name}</h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <LevelChip level={d.handling_level} showLabel />
              <TrendBadge trend={d.trend} />
              <ReviewBadge dog={d} />
            </div>
          </div>
        </div>
        <div className="mt-5 rounded-2xl bg-cream p-4 ring-1 ring-line">
          {summary.loading ? (
            <Spinner rotate />
          ) : summary.error ? (
            <ErrorNote message={summary.error} onRetry={summary.retry} />
          ) : (
            <p className="font-display text-lg leading-relaxed">{summary.text}</p>
          )}
        </div>
      </Card>

      <div className="grid gap-5 sm:grid-cols-2 print:grid-cols-2">
        <Card className="print:shadow-none">
          <h2 className="font-display text-xl font-semibold">Behavior scores</h2>
          <div className="mt-4 space-y-3.5">
            <Bar label="Energy" value={d.energy} color="bg-clay" />
            <Bar label="Stress" value={d.stress} color="bg-sage" delay={80} />
            <Bar label="Approachability" value={d.approachability} color="bg-amber-400" delay={160} />
            <Bar label="Confidence" value={d.confidence} color="bg-sky-400" delay={240} />
            <Bar label="Excitement spikes" value={d.arousal_spikes} max={10} color={LEVELS[d.handling_level].dot} delay={320} />
          </div>
          <Caption className="mt-4" />
        </Card>
        <Card className="print:shadow-none">
          <h2 className="font-display text-xl font-semibold">Needs</h2>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {d.needs.length ? d.needs.map((n) => <NeedChip key={n} need={n} />) : <span className="text-sm text-muted">No special needs noted.</span>}
          </div>
          <p className="mt-4 text-sm text-muted">
            <b className="text-ink">{d.handling_level} level:</b> {LEVELS[d.handling_level].label.toLowerCase()}. Levels describe the home {name} needs today, and they change as dogs settle in.
          </p>
        </Card>
      </div>

      <Card className="print:break-inside-avoid print:shadow-none">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">Settling in</h2>
          {trend.data?.fake && <span className="rounded-full bg-sand px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-muted">sample data</span>}
        </div>
        {trend.loading ? (
          <Spinner label="Drawing the trend…" />
        ) : trend.data?.series.length ? (
          <TrendChart series={trend.data.series} />
        ) : (
          <p className="py-6 text-sm text-muted">Trend appears after a few days of video.</p>
        )}
        <Caption />
      </Card>

      <Card className="print:break-inside-avoid print:shadow-none">
        <h2 className="font-display text-xl font-semibold">Rentals that welcome {name}</h2>
        <p className="mb-3 text-sm text-muted">Pet-friendly listings. Breed is never recorded.</p>
        {rentals.loading ? (
          <Spinner label="Looking for welcoming homes…" />
        ) : rentals.data?.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {rentals.data.map((r) => (
              <li key={r.url + r.name} className="rounded-2xl bg-cream p-3 ring-1 ring-line">
                <a href={r.url} target="_blank" rel="noreferrer" className="font-bold hover:text-clay-dark">{r.name}</a>
                <p className="text-xs text-muted">{r.address}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                  {r.rent && <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-line">{typeof r.rent === "number" ? `$${r.rent}` : r.rent}</span>}
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800">Dogs welcome</span>
                  {Number(r.dog_weight_limit_lbs) > 0 && <span className="rounded-full bg-white px-2 py-0.5 ring-1 ring-line">Up to {r.dog_weight_limit_lbs} lbs</span>}
                </div>
                {r.pet_policy_text && <p className="mt-2 line-clamp-3 text-xs text-ink/70">{r.pet_policy_text}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-2xl border-2 border-dashed border-line px-4 py-6 text-center text-sm text-muted">
            We haven&apos;t gathered rentals for {name} yet — ask the shelter team, they&apos;re happy to help you find a dog-friendly place.
          </div>
        )}
      </Card>

      <footer className="pb-4 text-center text-sm text-muted">
        <p className="font-semibold text-ink">Behavior measured over {d.day} {d.day === 1 ? "day" : "days"}. Breed never recorded.</p>
        <UpdatedAt iso={d.updated_at} className="mt-1 block" />
        <p className="mt-1 text-xs">Bonafide · judge the dog, not the label · Decision support, not a diagnosis.</p>
      </footer>
    </article>
  );
}

function useSummary(dogId: string | null) {
  const [state, setState] = useState<{ text: string; error: string | null; loading: boolean }>(() => {
    const cached = dogId ? peek<{ summary: string }>(`passport:${dogId}`) : undefined;
    return { text: cached?.summary ?? "", error: null, loading: !cached };
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!dogId) return;
    let cancelled = false;
    postJSON<{ summary: string }>(`/api/passport/${dogId}`).then(
      (r) => {
        remember(`passport:${dogId}`, r);
        if (!cancelled) setState({ text: r.summary, error: null, loading: false });
      },
      (err: Error) => !cancelled && setState({ text: "", error: err.message, loading: false }),
    );
    return () => {
      cancelled = true;
    };
  }, [dogId, nonce]);

  return {
    ...state,
    retry: () => {
      setState({ text: "", error: null, loading: true });
      setNonce((n) => n + 1);
    },
  };
}

function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        await navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? "Link copied ✓" : "Copy link"}
    </Button>
  );
}
