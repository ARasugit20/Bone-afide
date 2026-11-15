"use client";
import { useState } from "react";
import { Gate } from "@/components/AuthProvider";
import { Button, Card, DogPhoto, Empty, ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { STAFF_ONLY } from "@/lib/access";
import type { CareItemView } from "@/lib/types";
import { postJSON } from "@/lib/ui";
import { useApi } from "@/lib/useApi";

type CareDog = { dog_id: string; name: string; photo?: string; items: CareItemView[] };
type CareData = { dogs: CareDog[] };

export default function Page() {
  return (
    <Gate allow={STAFF_ONLY}>
      <Care />
    </Gate>
  );
}

function dueLabel(item: CareItemView): string {
  if (item.overdue) return `Overdue by ${Math.abs(item.days_until)} ${Math.abs(item.days_until) === 1 ? "day" : "days"}`;
  if (item.days_until === 0) return "Due today";
  return `Due in ${item.days_until} ${item.days_until === 1 ? "day" : "days"}`;
}

function Care() {
  const care = useApi<CareData>("/api/care");
  const [busy, setBusy] = useState<string | null>(null);

  async function markDone(dogId: string, type: string) {
    const key = `${dogId}:${type}`;
    setBusy(key);
    try {
      await postJSON("/api/care", { dog_id: dogId, type });
      care.reload();
    } finally {
      setBusy(null);
    }
  }

  const dogs = care.data?.dogs ?? [];
  const overdueCount = dogs.reduce((n, d) => n + d.items.filter((i) => i.overdue).length, 0);

  return (
    <div>
      <PageHeader
        title="Care"
        sub="Grooming, vaccines, and vet checkups for every dog. Overdue items also show on the overview."
      />
      {care.error && <ErrorNote message={care.error} onRetry={care.reload} />}
      {!care.error && overdueCount > 0 && (
        <p className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          {overdueCount} care {overdueCount === 1 ? "item is" : "items are"} overdue across the shelter.
        </p>
      )}
      {care.loading ? (
        <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>
      ) : dogs.length ? (
        <ul className="space-y-4">
          {dogs.map((dog) => (
            <li key={dog.dog_id}>
              <Card flush>
                <div className="flex items-center gap-3 px-4 pt-4 sm:px-6 sm:pt-6">
                  <DogPhoto dog={dog} className="h-10 w-10" rounded="rounded-lg" sizes="40px" eager />
                  <h2 className="font-display text-lg font-semibold">{dog.name}</h2>
                </div>
                <ul className="mt-2 divide-y divide-line">
                  {dog.items.map((item) => (
                    <li key={item.type} className="flex items-center gap-3 px-4 py-3 sm:px-6">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{item.label}</p>
                        <p className="text-xs text-muted">
                          Last {item.last_date}. Every {item.interval_days} days. Next {item.next_due}.
                        </p>
                      </div>
                      <span className={`shrink-0 text-xs font-semibold ${item.overdue ? "text-red-700" : "text-muted"}`}>
                        {dueLabel(item)}
                      </span>
                      <Button
                        variant="secondary"
                        onClick={() => markDone(dog.dog_id, item.type)}
                        loading={busy === `${dog.dog_id}:${item.type}`}
                      >
                        Mark done
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        !care.error && <Empty title="No care records yet" body="Care records are created the first time this page loads." />
      )}
    </div>
  );
}
