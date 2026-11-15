"use client";

import Link from "next/link";
import { useState } from "react";
import { Gate } from "@/components/AuthProvider";
import { ButtonLink, DogPhoto, Empty, ErrorNote, LevelChip, PageHeader, ReviewBadge, Skeleton } from "@/components/ui";
import { STAFF_ONLY } from "@/lib/access";
import { displayName } from "@/lib/dogs";
import { formatDateTime, timeAgo } from "@/lib/text";
import type { Dog, HandlingLevel } from "@/lib/types";
import { LEVEL_RANK } from "@/lib/ui";
import { useApi } from "@/lib/useApi";

const FILTERS: (HandlingLevel | "All")[] = ["All", "Green", "Yellow", "Orange", "Red"];

export default function Page() {
  return (
    <Gate allow={STAFF_ONLY}>
      <DogsPage />
    </Gate>
  );
}

const sortDogs = (a: Dog, b: Dog) =>
  Number(Boolean(b.photo)) - Number(Boolean(a.photo)) || LEVEL_RANK[b.handling_level] - LEVEL_RANK[a.handling_level] || a.name.localeCompare(b.name);

function DogsPage() {
  const { data, error, loading, reload } = useApi<Dog[]>("/api/dogs");
  const [filter, setFilter] = useState<HandlingLevel | "All">("All");
  const roster = data ?? [];
  const dogs = roster.filter((d) => filter === "All" || d.handling_level === filter).sort(sortDogs);
  const count = (f: HandlingLevel | "All") => (f === "All" ? roster.length : roster.filter((d) => d.handling_level === f).length);

  return (
    <div>
      <PageHeader
        title="Dogs"
        sub="Scores from kennel video. Breed is never an input."
        actions={<ButtonLink href="/upload">Upload kennel video</ButtonLink>}
      />

      <div role="tablist" aria-label="Filter by handling level" className="no-scrollbar -mx-1 mb-4 flex gap-1 overflow-x-auto px-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold transition ${filter === f ? "bg-forest-tint text-forest" : "text-muted hover:text-ink"}`}
          >
            {f === "All" ? "All" : f} <span className="font-normal tabular-nums">{loading ? "" : count(f)}</span>
          </button>
        ))}
      </div>

      {error && <div className="mb-4"><ErrorNote message={error} onRetry={reload} /></div>}

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : dogs.length ? (
        <>
          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas/60 text-left text-xs text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Dog</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Level</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Energy</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Stress</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Approach.</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Confidence</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Review</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Last scan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {dogs.map((d) => (
                  <tr key={d.dog_id} className="group relative transition hover:bg-canvas">
                    <td className="px-4 py-3">
                      <Link href={`/dogs/${d.dog_id}`} className="flex items-center gap-3 after:absolute after:inset-0">
                        <DogPhoto dog={d} className="h-10 w-10" rounded="rounded-lg" />
                        <span>
                          <span className="block font-semibold group-hover:text-forest">{displayName(d, roster)}</span>
                          <span className="block text-xs text-muted">Day {d.day}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3"><LevelChip level={d.handling_level} /></td>
                    <td className="px-4 py-3 text-right tabular-nums">{d.energy}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{d.stress}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{d.approachability}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{d.confidence}</td>
                    <td className="px-4 py-3"><ReviewBadge dog={d} /></td>
                    <td className="px-4 py-3 text-muted" title={formatDateTime(d.updated_at)}>{d.updated_at ? timeAgo(d.updated_at) : "Not scanned"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: list */}
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface md:hidden">
            {dogs.map((d) => (
              <li key={d.dog_id}>
                <Link href={`/dogs/${d.dog_id}`} className="flex items-center gap-3 px-4 py-3">
                  <DogPhoto dog={d} className="h-12 w-12" rounded="rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold">{displayName(d, roster)}</span>
                      <LevelChip level={d.handling_level} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      Stress {d.stress}, approachability {d.approachability}. {d.updated_at ? `Scanned ${timeAgo(d.updated_at)}` : "Not scanned"}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        !error && (
          <Empty
            title={filter === "All" ? "No dogs yet" : `No ${filter} dogs`}
            body={filter === "All" ? "Upload a kennel video to score the first dog." : "Try another handling level."}
          />
        )
      )}
    </div>
  );
}
