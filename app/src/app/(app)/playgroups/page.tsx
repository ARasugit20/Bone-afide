"use client";
import { useState } from "react";
import { Gate } from "@/components/AuthProvider";
import { Button, Card, DogPhoto, Empty, ErrorNote, LevelChip, PageHeader, SectionTitle, Skeleton } from "@/components/ui";
import { STAFF_ONLY } from "@/lib/access";
import { formatDateTime } from "@/lib/text";
import type { HandlingLevel, Playdate } from "@/lib/types";
import { postJSON } from "@/lib/ui";
import { useApi } from "@/lib/useApi";

type GroupDog = { dog_id: string; name?: string; photo?: string; energy?: number; handling_level?: HandlingLevel };
type Group = { dog_ids: string[]; reasons: string[]; dogs: GroupDog[] };
type Data = { groups: Group[]; playdates: Playdate[] };

export default function Page() {
  return (
    <Gate allow={STAFF_ONLY}>
      <Playgroups />
    </Gate>
  );
}

function Playgroups() {
  const data = useApi<Data>("/api/playgroups");
  const [busy, setBusy] = useState<string | null>(null);

  async function schedule(group: Group) {
    const key = group.dog_ids.join("+");
    setBusy(key);
    try {
      await postJSON("/api/playgroups", { dog_ids: group.dog_ids });
      data.reload();
    } finally {
      setBusy(null);
    }
  }

  const groups = data.data?.groups ?? [];
  const playdates = data.data?.playdates ?? [];

  return (
    <div className="space-y-8">
      <PageHeader title="Playgroups" sub="Safe pairs suggested from behavior scores. Never Orange or Red, never rising stress." />
      {data.error && <ErrorNote message={data.error} onRetry={data.reload} />}

      <section>
        <SectionTitle title="Suggested pairs" />
        {data.loading ? (
          <div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div>
        ) : groups.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {groups.map((group) => (
              <li key={group.dog_ids.join("+")}>
                <Card>
                  <div className="flex items-center gap-4">
                    {group.dogs.map((dog) => (
                      <div key={dog.dog_id} className="flex items-center gap-2">
                        <DogPhoto dog={{ name: dog.name ?? dog.dog_id, photo: dog.photo }} className="h-10 w-10" rounded="rounded-lg" sizes="40px" eager />
                        <div>
                          <p className="text-sm font-semibold">{dog.name ?? dog.dog_id}</p>
                          {dog.handling_level && <LevelChip level={dog.handling_level} />}
                        </div>
                      </div>
                    ))}
                  </div>
                  <ul className="mt-3 space-y-1 text-sm text-muted">
                    {group.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                  <div className="mt-3">
                    <Button variant="secondary" onClick={() => schedule(group)} loading={busy === group.dog_ids.join("+")}>
                      Schedule playdate
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          !data.error && <Empty title="No safe pairs right now" body="Pairs need two calm dogs with similar energy and no rising stress." />
        )}
      </section>

      <section>
        <SectionTitle title="Scheduled playdates" />
        {playdates.length ? (
          <Card flush>
            <ul className="divide-y divide-line">
              {playdates.map((p) => (
                <li key={p.playdate_id} className="px-4 py-3 sm:px-6">
                  <p className="text-sm font-semibold">{p.dog_ids.join(" and ")}</p>
                  <p className="text-xs text-muted">
                    {formatDateTime(p.scheduled_for)}
                    {p.volunteer_name ? ` with ${p.volunteer_name}` : " (no volunteer at the right level yet)"}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <p className="text-sm text-muted">No playdates scheduled yet.</p>
        )}
      </section>
    </div>
  );
}
