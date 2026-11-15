"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { Gate } from "@/components/AuthProvider";
import { Mascot } from "@/components/Mascot";
import { SystemStatus } from "@/components/SystemStatus";
import { Button, Card, ErrorNote, LevelChip } from "@/components/ui";
import { STAFF_ONLY } from "@/lib/access";
import type { Dog, Family, HandlingLevel, Match } from "@/lib/types";
import { postJSON } from "@/lib/ui";
import { useApi } from "@/lib/useApi";

const LEVEL_ORDER: HandlingLevel[] = ["Green", "Yellow", "Orange", "Red"];

const STEPS = [
  { title: "Kennel scan", body: "Short kennel videos capture how each dog actually behaves.", icon: <CameraIcon /> },
  { title: "Behavior scores", body: "Energy, stress, approachability and confidence — never breed.", icon: <BarsIcon /> },
  { title: "Whole-shelter match", body: "Every dog and family paired at once for the best overall fit.", icon: <LinkIcon /> },
];

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
    { label: "Dogs scanned", value: dogs.data?.length, href: "/dogs", loading: dogs.loading },
    { label: "Families", value: families.data?.length, href: "/intake", loading: families.loading },
    { label: "Matches", value: matches.data?.matches.length, href: "/match", loading: matches.loading },
  ];
  const error = dogs.error || families.error || matches.error;

  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="section-dark rise relative isolate overflow-hidden rounded-[28px] px-5 py-8 shadow-lift sm:px-10 sm:py-12">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="glow-forest absolute -left-40 -top-24 size-[560px] opacity-50" />
          <div className="glow-grass absolute -right-40 top-[20%] size-[520px] opacity-35" />
          <div className="glow-tennis absolute -bottom-48 left-[35%] size-[420px] opacity-20" />
        </div>

        <div className="relative grid items-center gap-8 lg:grid-cols-[1.5fr_1fr]">
          <div>
            <p className="eyebrow text-tennis">Behavior, measured — never breed</p>
            <h1 className="mt-4 font-display text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.03em] text-on-dark sm:text-6xl">
              Judge the dog, <span className="block"><em className="italic text-tennis">not the label.</em></span>
            </h1>
            <p className="mt-5 max-w-xl text-base text-on-dark/75 sm:text-lg">
              We score real behavior from kennel video and match the whole shelter to families at once — breed is never used.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button onClick={runMatch} loading={running} className="px-7 py-3.5 text-base">
                {running ? "Matching the whole shelter…" : "Run whole-shelter match"}
              </Button>
            </div>
            {runError && <div className="mt-4"><ErrorNote message={runError} /></div>}
          </div>
          <div className="hidden justify-center lg:flex" aria-hidden>
            <div className="grid h-56 w-56 place-items-center rounded-full bg-on-dark/5 ring-1 ring-on-dark/15">
              <Mascot className="h-40 w-40 drop-shadow-xl" />
            </div>
          </div>
        </div>

        <div className="relative mt-8 grid grid-cols-3 gap-2 sm:gap-4">
          {stats.map((s) => (
            <Link
              key={s.label}
              href={s.href}
              className="rounded-[20px] bg-on-dark/5 px-3 py-3 ring-1 ring-on-dark/15 transition hover:bg-on-dark/10 hover:ring-tennis/50 sm:px-5 sm:py-4"
            >
              {s.loading ? (
                <span className="block h-9 w-10 animate-pulse rounded-lg bg-on-dark/20" />
              ) : (
                <span className="block font-display text-3xl font-semibold tabular-nums text-on-dark sm:text-5xl">{s.value ?? 0}</span>
              )}
              <span className="mt-1 block text-xs font-semibold text-on-dark/75 sm:text-sm">{s.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {error && <ErrorNote message={error} onRetry={() => { dogs.reload(); families.reload(); matches.reload(); }} />}

      <section aria-label="How Bonafide works" className="rise" style={{ animationDelay: "80ms" }}>
        <ol className="flex flex-col items-stretch gap-2 md:flex-row md:items-center md:gap-3">
          {STEPS.map((s, i) => (
            <Fragment key={s.title}>
              <li className="card-surface flex flex-1 items-start gap-3 p-4 sm:p-5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-forest-tint text-forest">{s.icon}</span>
                <span>
                  <span className="eyebrow text-forest">Step {i + 1}</span>
                  <span className="block font-display text-lg font-semibold leading-tight">{s.title}</span>
                  <span className="mt-0.5 block text-sm text-muted">{s.body}</span>
                </span>
              </li>
              {i < STEPS.length - 1 && (
                <li aria-hidden className="flex justify-center text-2xl font-bold text-grass/70">
                  <span className="md:hidden">↓</span>
                  <span className="hidden md:inline">→</span>
                </li>
              )}
            </Fragment>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 sm:gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4 sm:space-y-6">
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
          <Link href="/bias-test" className="group block rounded-3xl">
            <Card className="bg-gradient-to-br from-surface to-forest-tint transition duration-200 ease-ui group-hover:-translate-y-1 group-hover:border-forest/40 group-hover:shadow-lift">
              <p className="eyebrow text-forest">Bias test</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">Same dog. Two labels. Watch the AI change its mind.</h2>
              <p className="mt-2 text-sm text-muted">
                We ask a general AI about one dog twice — once with a breed label, once with another. Our behavior scores don&apos;t move, because they never see breed.
              </p>
              <span className="mt-4 inline-block text-sm font-bold text-clay-dark group-hover:underline">Run the bias test →</span>
            </Card>
          </Link>
        </div>
        <SystemStatus />
      </section>
    </div>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="6" width="13" height="12" rx="3" />
      <path d="M16 10l5-3v10l-5-3" />
    </svg>
  );
}

function BarsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 20h16" />
      <path d="M7 16v-5M12 16V6M17 16v-8" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="12" r="3" />
      <path d="M9 12h6" strokeDasharray="2 2" />
    </svg>
  );
}
