import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "How it works",
  description: "How Bone-a-find turns kennel video into behavior scores and shelter matches.",
};

const FLOW = [
  { title: "Kennel video", body: "Short clips filmed at the kennel." },
  { title: "YOLO11 tracking", body: "Finds and follows the dog. Camera-shake compensation removes handheld motion." },
  { title: "Behavior scores", body: "Energy, stress, approachability, confidence and excitement spikes, 0 to 100." },
  { title: "MongoDB + Tiger Data", body: "Current record in MongoDB Atlas. Every reading in a Tiger Data hypertable." },
  { title: "Hungarian matching", body: "Pairs every dog with every family at once for the best total fit." },
  { title: "This app", body: "Staff, vets and families see the results." },
];

const TOOLS: { name: string; what: string; where: { href: string; label: string } }[] = [
  {
    name: "Gemini",
    what: "Runs the family intake chat. Families describe their home in plain words and Gemini turns the conversation into the structured profile the matcher uses. It also answers staff questions from notes, and the bias check sends it the same video with two different breed labels.",
    where: { href: "/intake", label: "Family intake" },
  },
  {
    name: "Supermemory",
    what: "Indexes every staff note. When someone asks about a dog, Supermemory finds the relevant notes and the answer is written only from those notes, with the notes it used shown underneath.",
    where: { href: "/dogs/luna-01", label: "Luna's page: staff notes" },
  },
  {
    name: "TinyFish",
    what: "A web agent that browses real rental listings and returns places that accept dogs with no breed restrictions: address, pet policy, weight limit and a link to each listing.",
    where: { href: "/passport/luna-01", label: "Luna's passport: rentals" },
  },
  {
    name: "MongoDB Atlas",
    what: "Stores dogs, families, matches, match runs, staff notes, passports and rentals. The pipeline and the app read and write the same database.",
    where: { href: "/match", label: "Match board" },
  },
  {
    name: "Tiger Data",
    what: "Every scored session is written to the dog_readings hypertable. The dog_daily continuous aggregate rolls readings up per day for the stress and energy chart.",
    where: { href: "/dogs/luna-01", label: "Luna's page: stress and energy" },
  },
  {
    name: "Amazon Bedrock",
    what: "Nova Lite writes the behavior report from the scores, and the short summary at the top of each passport. It is told to describe needs and never breed.",
    where: { href: "/dogs/luna-01", label: "Luna's page: behavior report" },
  },
  {
    name: "Amazon S3",
    what: "Holds the annotated tracking videos and dog photos. The app loads them with signed links.",
    where: { href: "/dogs/luna-01", label: "Luna's page: tracking video" },
  },
];

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="How it works" sub="From kennel video to a matched home. Breed is never an input at any step." />

      <section aria-labelledby="pipeline" className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <h2 id="pipeline" className="font-display text-lg font-semibold">Pipeline</h2>
        <ol className="mt-4 grid gap-2 md:grid-cols-6 md:gap-0">
          {FLOW.map((s, i) => (
            <li key={s.title} className="relative flex md:flex-col">
              <div className="flex-1 rounded-xl border border-line bg-canvas p-3 md:mx-1.5 md:h-full">
                <p className="text-xs font-semibold text-muted tabular-nums">{i + 1}</p>
                <p className="mt-0.5 text-sm font-semibold">{s.title}</p>
                <p className="mt-1 text-xs text-muted">{s.body}</p>
              </div>
              {i < FLOW.length - 1 && (
                <span aria-hidden className="hidden text-muted md:absolute md:-right-2 md:top-1/2 md:z-10 md:block md:-translate-y-1/2">
                  <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor"><path d="M3 1l6 5-6 5z" /></svg>
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-muted">
          Handling levels (Green, Yellow, Orange, Red) come from the scores. Orange and Red stay provisional until a vet confirms them.
        </p>
      </section>

      <section aria-labelledby="tools" className="mt-8">
        <h2 id="tools" className="font-display text-lg font-semibold">What each tool does</h2>
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-surface">
          {TOOLS.map((t) => (
            <li key={t.name} className="grid gap-2 p-4 sm:grid-cols-[10rem_1fr] sm:gap-6 sm:p-6">
              <h3 className="font-semibold">{t.name}</h3>
              <div>
                <p className="text-sm leading-relaxed">{t.what}</p>
                <Link href={t.where.href} className="mt-2 inline-block text-sm font-semibold text-forest hover:underline">
                  See it: {t.where.label}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
