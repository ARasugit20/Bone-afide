"use client";

import { useParams } from "next/navigation";
import { TrackingVideo } from "@/components/TrackingVideo";
import { Bar, DogPhoto, Empty, LevelChip, Skeleton, Source } from "@/components/ui";
import { formatDateTime } from "@/lib/text";
import type { PublicPassport, Rental } from "@/lib/types";
import { LEVELS } from "@/lib/ui";
import { useApi } from "@/lib/useApi";

type Data = { passport: PublicPassport; rentals: Omit<Rental, "dog_id">[] };

const SCORES = [
  ["energy", "Energy", "bg-forest"],
  ["stress", "Stress", "bg-grass"],
  ["approachability", "Approachability", "bg-sky-400"],
  ["confidence", "Confidence", "bg-forest-dark"],
] as const;

function weight(v: Rental["dog_weight_limit_lbs"]) {
  if (v === null || v === undefined || v === "") return "Not listed";
  if (Number(v) > 0) return `${v} lb`;
  return /^none\.?$/i.test(String(v).trim()) ? "None listed" : String(v);
}

export function PublicPassportView() {
  const { dogId } = useParams<{ dogId: string }>();
  const { data, error, loading } = useApi<Data>(`/api/public/${encodeURIComponent(dogId)}`);

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    );
  }
  if (error || !data) return <Empty title="Passport not found" body={error ?? "This dog may have been adopted."} />;

  const p = data.passport;
  const fetched = data.rentals.map((r) => r.fetched_at).filter(Boolean).sort().at(-1);
  return (
    <article className="space-y-8">
      <header>
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={28} height={28} className="size-7 rounded-full" />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Bone-a-find behavior passport</p>
        </div>
        <DogPhoto dog={p} className="mt-3 aspect-[4/3] w-full" rounded="rounded-2xl" sizes="(min-width: 672px) 640px, 100vw" priority />
        <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight">{p.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <LevelChip level={p.handling_level} showLabel />
          {p.expert_reviewed && <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">Vet reviewed</span>}
        </div>
        <p className="mt-3 text-sm text-muted">
          Observed in {p.sessions_observed} {p.sessions_observed === 1 ? "session" : "sessions"} on kennel video. Breed is never recorded.
        </p>
      </header>

      <section aria-labelledby="scores">
        <h2 id="scores" className="font-display text-lg font-semibold">Scores from video</h2>
        <div className="mt-3 space-y-3">
          {SCORES.map(([k, label, color]) => (typeof p.scores[k] === "number" ? <Bar key={k} label={label} value={p.scores[k]!} color={color} /> : null))}
          {typeof p.scores.arousal_spikes === "number" && (
            <Bar label="Excitement spikes" value={p.scores.arousal_spikes} max={10} hint="per session" color={LEVELS[p.handling_level].dot} />
          )}
        </div>
      </section>

      {(p.fit_notes.length > 0 || p.not_suited_for.length > 0) && (
        <section aria-labelledby="fit" className="space-y-3">
          <h2 id="fit" className="font-display text-lg font-semibold">What we observed</h2>
          {p.fit_notes.length > 0 && (
            <ul className="space-y-1 text-[15px]">
              {p.fit_notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
          {p.not_suited_for.length > 0 && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-semibold">Not a fit for:</span> {p.not_suited_for.join(", ")}
            </p>
          )}
        </section>
      )}

      {p.video_url && (
        <section aria-labelledby="video">
          <h2 id="video" className="mb-3 font-display text-lg font-semibold">Tracking video</h2>
          <TrackingVideo src={p.video_url} poster={p.photo} events={p.events} />
        </section>
      )}

      <section aria-labelledby="rentals">
        <h2 id="rentals" className="font-display text-lg font-semibold">Rentals that accept dogs</h2>
        <p className="mt-0.5 text-sm text-muted">{fetched ? `Fetched ${formatDateTime(fetched)}. ` : ""}Listings with no breed restrictions.</p>
        {data.rentals.length ? (
          <ul className="mt-3 divide-y divide-line">
            {data.rentals.map((r) => (
              <li key={r.url + r.name} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <p className="font-semibold">{r.name}</p>
                  {r.rent && <p className="text-sm tabular-nums">{typeof r.rent === "number" ? `$${r.rent.toLocaleString()}/mo` : r.rent}</p>}
                </div>
                {r.address && <p className="text-sm text-muted">{r.address}</p>}
                <p className="mt-1 text-sm">Weight limit: {weight(r.dog_weight_limit_lbs)}</p>
                <a href={r.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-semibold text-forest hover:underline">View listing</a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">No listings gathered yet.</p>
        )}
        <Source className="mt-2">Listings gathered by TinyFish web agent</Source>
      </section>

      <footer className="border-t border-line pt-4 text-xs text-muted">
        <p className="font-semibold text-ink">Breed is never recorded.</p>
        <p className="mt-1">Scores come from kennel video. Decision support, not a diagnosis.</p>
      </footer>
    </article>
  );
}
