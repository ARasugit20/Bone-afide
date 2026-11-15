import Link from "next/link";
import { displayName } from "@/lib/dogs";
import type { Dog } from "@/lib/types";
import { needsReview } from "@/lib/ui";
import { Avatar, LevelChip, MiniBar, TrendBadge } from "./ui";

export function DogCard({ dog, compact = false, href, roster = [] }: { dog: Dog; compact?: boolean; href?: string; roster?: { name: string; dog_id: string }[] }) {
  const name = displayName(dog, roster.length ? roster : [dog]);
  return (
    <Link
      href={href ?? `/dogs/${dog.dog_id}`}
      className="group block card-surface p-4 transition duration-200 ease-ui hover:-translate-y-1 hover:shadow-lift hover:border-forest/40"
    >
      <div className="flex items-start gap-3">
        <Avatar name={dog.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate font-display text-lg font-semibold group-hover:text-clay-dark">{name}</h3>
            <LevelChip level={dog.handling_level} />
          </div>
          <p className="text-xs text-muted">
            Day {dog.day} at the shelter
            {needsReview(dog) && <span className="ml-1.5 font-bold text-amber-700">· Provisional</span>}
          </p>
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
