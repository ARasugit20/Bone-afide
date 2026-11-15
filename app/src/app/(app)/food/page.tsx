"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Gate } from "@/components/AuthProvider";
import { Button, Card, DogPhoto, Empty, ErrorNote, PageHeader, SectionTitle, Skeleton, Source } from "@/components/ui";
import { STAFF_ONLY } from "@/lib/access";
import { timeAgo } from "@/lib/text";
import type { Diet, FoodHelp, FoodHelpJob } from "@/lib/types";
import { getJSON, postJSON } from "@/lib/ui";
import { useApi } from "@/lib/useApi";

type FoodDog = { dog_id: string; name: string; photo?: string; diet: Diet | null };
type InvItem = { sku: string; name: string; unit: string; on_hand: number; daily_use: number; low_stock_days: number; days_left: number | null; low: boolean };
type FoodData = { dogs: FoodDog[]; inventory: InvItem[] };
type HelpData = { results: FoodHelp[]; job: FoodHelpJob | null };

export default function Page() {
  return (
    <Gate allow={STAFF_ONLY}>
      <Food />
    </Gate>
  );
}

function Food() {
  const food = useApi<FoodData>("/api/food");
  const dogs = food.data?.dogs ?? [];
  const inventory = food.data?.inventory ?? [];
  const lowCount = inventory.filter((i) => i.low).length;

  return (
    <div className="space-y-8">
      <PageHeader title="Food and supplies" sub="Per-dog diets, shelter inventory, and nearby food help." />
      {food.error && <ErrorNote message={food.error} onRetry={food.reload} />}

      <section>
        <SectionTitle title="Shelter inventory" sub="Days of stock left at the current rate." />
        {food.loading ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : (
          <Card flush>
            {lowCount > 0 && (
              <p className="px-4 pt-4 text-sm font-semibold text-amber-900 sm:px-6">
                {lowCount} {lowCount === 1 ? "item is" : "items are"} low on stock.
              </p>
            )}
            <ul className="mt-2 divide-y divide-line">
              {inventory.map((it) => (
                <li key={it.sku} className="flex items-center gap-3 px-4 py-3 sm:px-6">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{it.name}</p>
                    <p className="text-xs text-muted">{it.on_hand} {it.unit} on hand, using {it.daily_use} {it.unit} per day</p>
                  </div>
                  <span className={`shrink-0 text-xs font-semibold ${it.low ? "text-red-700" : "text-muted"}`}>
                    {it.days_left === null ? "No usage" : `${it.days_left} days left`}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section>
        <SectionTitle title="Per-dog diets" />
        {food.loading ? (
          <div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
        ) : dogs.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {dogs.map((dog) => (
              <li key={dog.dog_id}>
                <Card>
                  <div className="flex items-center gap-3">
                    <DogPhoto dog={dog} className="h-9 w-9" rounded="rounded-lg" sizes="36px" eager />
                    <h3 className="font-semibold">{dog.name}</h3>
                  </div>
                  {dog.diet ? (
                    <dl className="mt-3 space-y-1 text-sm">
                      <div className="flex justify-between gap-2"><dt className="text-muted">Food</dt><dd className="font-semibold">{dog.diet.food_type}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-muted">Per day</dt><dd className="font-semibold tabular-nums">{dog.diet.grams_per_day} g</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-muted">Allergies</dt><dd className="font-semibold">{dog.diet.allergies.length ? dog.diet.allergies.join(", ") : "None recorded"}</dd></div>
                    </dl>
                  ) : (
                    <p className="mt-3 text-sm text-muted">No diet recorded yet.</p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          !food.error && <Empty title="No diets yet" />
        )}
      </section>

      <FoodHelpPanel />
    </div>
  );
}

function FoodHelpPanel() {
  const [data, setData] = useState<HelpData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getJSON<HelpData>("/api/food/help");
      setData(d);
      setError(null);
      return d;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getJSON<HelpData>("/api/food/help").then(
      (d) => !cancelled && setData(d),
      (err: Error) => !cancelled && setError(err.message),
    );
    return () => {
      cancelled = true;
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const running = data?.job?.status === "running";
  useEffect(() => {
    if (running && !timer.current) {
      timer.current = setInterval(async () => {
        const d = await load();
        if (d && d.job?.status !== "running" && timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
      }, 5000);
    }
  }, [running, load]);

  async function find() {
    setStarting(true);
    setError(null);
    try {
      await postJSON("/api/food/help");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }

  const results = data?.results ?? [];
  return (
    <section>
      <SectionTitle
        title="Find food help"
        sub="Nearby pet food banks and pantries in Tempe and Phoenix."
        action={<Button variant="secondary" onClick={find} loading={starting || running}>{running ? "Searching" : "Find food help"}</Button>}
      />
      {error && <ErrorNote message={error} onRetry={find} />}
      {running && <p className="text-sm text-muted">Searching the web for nearby food help. This can take a minute.</p>}
      {data?.job?.status === "failed" && <p className="text-sm text-red-700">The search did not finish. Try again.</p>}
      {results.length ? (
        <ul className="mt-2 grid gap-3 sm:grid-cols-2">
          {results.map((r, i) => (
            <li key={i}>
              <Card>
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-forest hover:underline">{r.name}</a>
                {r.kind && <p className="text-xs uppercase tracking-wide text-muted">{r.kind}</p>}
                {r.address && <p className="mt-1 text-sm text-muted">{r.address}</p>}
                {r.phone && <p className="text-sm text-muted">{r.phone}</p>}
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        !running && <p className="mt-2 text-sm text-muted">No saved results yet. Run a search to find nearby food help.</p>
      )}
      {data?.job?.finished_at && <Source className="mt-2">Fetched {timeAgo(data.job.finished_at)}.</Source>}
    </section>
  );
}
