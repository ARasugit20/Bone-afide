"use client";

import Link from "next/link";
import { Gate } from "@/components/AuthProvider";
import { Card, DogPhoto, Empty, ErrorNote, LevelChip, PageHeader, Skeleton, Source } from "@/components/ui";
import type { Dog, Experience, Volunteer } from "@/lib/types";
import { useApi } from "@/lib/useApi";

type Roster = { assignments: { volunteer: Volunteer; dogs: Dog[] }[]; unassigned: Dog[] };

const LEVEL: Record<Experience, string> = { any: "New volunteer", some: "3+ months", experienced: "Experienced handler", staff: "Behavior staff" };

export default function Page() {
  return (
    <Gate allow={["staff"]}>
      <Volunteers />
    </Gate>
  );
}

function Volunteers() {
  const roster = useApi<Roster>("/api/volunteers");
  const total = roster.data?.assignments.reduce((n, a) => n + a.dogs.length, 0) ?? 0;

  return (
    <div>
      <PageHeader
        title="Volunteers"
        sub={roster.data ? `${roster.data.assignments.length} volunteers, ${total} dogs assigned. Each dog goes to someone at or above its handling level.` : "Who handles which dog today."}
      />
      {roster.error && <div className="mb-4"><ErrorNote message={roster.error} onRetry={roster.reload} /></div>}
      {roster.loading ? (
        <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}</div>
      ) : roster.data?.assignments.length ? (
        <>
          {roster.data.unassigned.length > 0 && (
            <p role="alert" className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
              No volunteer on the roster can take: {roster.data.unassigned.map((d) => d.name).join(", ")}. Add a handler with enough experience.
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {roster.data.assignments.map(({ volunteer: v, dogs }) => (
              <Card key={v.volunteer_id} as="section" flush>
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-4 sm:px-6">
                  <div>
                    <h2 className="font-semibold">{v.name}</h2>
                    <p className="text-xs text-muted">{v.shifts.join(", ")}</p>
                  </div>
                  <span className="rounded-full bg-sand px-2.5 py-0.5 text-xs font-semibold">{LEVEL[v.experience]}</span>
                </div>
                {dogs.length ? (
                  <ul className="divide-y divide-line">
                    {dogs.map((d) => (
                      <li key={d.dog_id} className="px-4 py-3 sm:px-6">
                        <Link href={`/dogs/${d.dog_id}`} className="flex items-center gap-3 hover:text-forest">
                          <DogPhoto dog={d} className="h-9 w-9" rounded="rounded-lg" sizes="36px" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{d.name}</span>
                            <span className="block truncate text-xs text-muted">{d.handler?.label}</span>
                          </span>
                          <LevelChip level={d.handling_level} />
                        </Link>
                        {d.handler?.notes.length ? (
                          <ul className="mt-2 space-y-0.5 pl-12 text-xs">
                            {d.handler.notes.map((n) => <li key={n}>{n}</li>)}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 py-4 text-sm text-muted sm:px-6">No dogs today.</p>
                )}
              </Card>
            ))}
          </div>
          <Source className="mt-4">Handling levels and notes come from the pipeline&apos;s video analysis. Volunteers stored in MongoDB Atlas.</Source>
        </>
      ) : (
        !roster.error && <Empty title="No volunteers yet" body="Add volunteers to build the handling roster." />
      )}
    </div>
  );
}
