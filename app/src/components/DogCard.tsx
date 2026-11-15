import Link from "next/link";
import type { Dog } from "@/lib/types";
import { Avatar, LevelChip, MiniBar, TrendBadge } from "./ui";

export function DogCard({ dog, compact = false }: { dog: Dog; compact?: boolean }) {
  return (
    <Link
      href={`/dogs/${dog.dog_id}`}
      className="group block rounded-3xl border border-line bg-white/85 p-4 shadow-[0_8px_24px_-14px_rgba(120,70,40,0.25)] transition hover:-translate-y-0.5 hover:border-clay/40 hover:shadow-[0_14px_30px_-14px_rgba(120,70,40,0.35)]"
    >
      <div className="flex items-start gap-3">
        <Avatar name={dog.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate font-display text-lg font-semibold group-hover:text-clay-dark">{dog.name}</h3>
            <LevelChip level={dog.handling_level} />
          </div>
          <p className="text-xs text-muted">Day {dog.day} at the shelter</p>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        <MiniBar label="Energy" value={dog.energy} color="bg-clay" />
        <MiniBar label="Stress" value={dog.stress} color="bg-sage" />
      </div>
      {!compact && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <TrendBadge trend={dog.trend} />
          {dog.needs.slice(0, 2).map((n) => (
            <span key={n} className="rounded-full bg-sand px-2 py-0.5 text-[11px] font-semibold text-ink/70">
              {n}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
