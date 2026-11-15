"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Gate } from "@/components/AuthProvider";
import { Button, Card, ErrorNote, LevelChip } from "@/components/ui";
import { STAFF_ONLY } from "@/lib/access";
import type { Dog, Family, HandlingLevel, Match } from "@/lib/types";
import { postJSON } from "@/lib/ui";
import { useApi } from "@/lib/useApi";

const LEVEL_ORDER: HandlingLevel[] = ["Green", "Yellow", "Orange", "Red"];

export default function Page() {
  return (
    <Gate allow={STAFF_ONLY}>
      <Dashboard />
    </Gate>
  );
}

function Dashboard() {
  const router = useRouter();
  const dogs = useApi<Dog[]>("/api/dogs");
  const families = useApi<Family[]>("/api/families");
  const matches = useApi<{ ran: boolean; matches: Match[] }>("/api/match");
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
      setRunning(false);
    }
  }

  const stats = [
    { label: "Dogs in care", value: dogs.data?.length, href: "/dogs", loading: dogs.loading },
    { label: "Families ready", value: families.data?.length, href: "/intake", loading: families.loading },
    { label: "Current matches", value: matches.data?.matches.length, href: "/match", loading: matches.loading },
  ];
  const error = dogs.error || families.error || matches.error;

  return (
    <div className="space-y-8">
      <section className="rise relative overflow-hidden rounded-[2rem] bg-ink px-6 py-10 text-cream sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-clay/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-56 w-56 rounded-full bg-sage/30 blur-3xl" />
        <p className="relative text-sm font-bold uppercase tracking-[0.2em] text-clay">Bonafide</p>
        <h1 className="relative mt-2 max-w-2xl font-display text-4xl font-semibold leading-tight sm:text-5xl">
          Judge the dog, <span className="italic text-[#f6b48f]">not the label.</span>
        </h1>
        <p className="relative mt-4 max-w-xl text-cream/75">
          Real behavior from kennel video, matched to every waiting family at once. Breed is never stored or shown.
        </p>
        <div className="relative mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button onClick={runMatch} loading={running} className="px-7 py-3.5 text-base">
            {running ? "Matching the whole shelter…" : "Run whole-shelter match"}
          </Button>
          <span className="text-xs text-cream/60">Finds the best overall pairing for every dog and family together.</span>
        </div>
        {runError && <div className="relative mt-4"><ErrorNote message={runError} /></div>}
      </section>

      {error && <ErrorNote message={error} onRetry={() => { dogs.reload(); families.reload(); matches.reload(); }} />}

      <section className="grid gap-4 sm:grid-cols-3">
        {stats.map((s, i) => (
          <Link key={s.label} href={s.href} className="rise" style={{ animationDelay: `${i * 60}ms` }}>
            <Card className="transition hover:-translate-y-0.5 hover:border-clay/40">
              <p className="text-sm font-semibold text-muted">{s.label}</p>
              {s.loading ? (
                <div className="mt-2 h-10 w-16 animate-pulse rounded-xl bg-sand" />
              ) : (
                <p className="mt-1 font-display text-5xl font-semibold tabular-nums">{s.value ?? 0}</p>
              )}
            </Card>
          </Link>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <h2 className="font-display text-xl font-semibold">Handling levels in care</h2>
          <p className="mb-4 text-sm text-muted">Levels describe the home a dog needs today — not who they are.</p>
          {dogs.loading ? (
            <div className="h-24 animate-pulse rounded-2xl bg-sand" />
          ) : dogs.data?.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {LEVEL_ORDER.map((lvl) => (
                <div key={lvl} className="rounded-2xl bg-cream p-3 text-center ring-1 ring-line">
                  <p className="font-display text-3xl font-semibold">{dogs.data!.filter((d) => d.handling_level === lvl).length}</p>
                  <div className="mt-1"><LevelChip level={lvl} /></div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No dogs yet — run the seed script or connect the video pipeline.</p>
          )}
        </Card>
        <Card>
          <h2 className="font-display text-xl font-semibold">How it works</h2>
          <ol className="mt-3 space-y-3 text-sm">
            {[
              ["Watch", "Kennel video becomes energy, stress, approachability and confidence scores."],
              ["Listen", "Families chat with our intake counselor — no breed questions, ever."],
              ["Match", "Every dog and family are paired at once for the best overall fit."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-clay/15 text-xs font-bold text-clay-dark">{i + 1}</span>
                <span><b>{t}.</b> <span className="text-muted">{d}</span></span>
              </li>
            ))}
          </ol>
        </Card>
      </section>
    </div>
  );
}
