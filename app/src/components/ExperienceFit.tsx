import { MIN_EXPERIENCE } from "@/lib/match";
import type { Dog, Family } from "@/lib/types";
import { EXPERIENCE, LEVELS } from "@/lib/ui";

// One track, four steps: filled = family's experience, ringed = the dog's minimum.
export function ExperienceFit({ dog, family }: { dog: Dog; family: Family }) {
  const need = MIN_EXPERIENCE[dog.handling_level];
  const ok = family.experience >= need;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-muted">
        <span>Experience fit</span>
        <span className={ok ? "text-emerald-700" : "text-rose-700"}>
          {ok ? (family.experience > need ? "More than enough" : "Just right") : "Below what's needed"}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {EXPERIENCE.map((label, i) => (
          <div key={label} className="text-center">
            <div
              className={`h-2.5 rounded-full ${i <= family.experience ? "bg-ink/80" : "bg-sand"} ${
                i === need ? `ring-2 ring-offset-2 ring-offset-white ${LEVELS[dog.handling_level].ring}` : ""
              }`}
            />
            <span className={`mt-1 block text-[11px] leading-tight ${i === need ? "font-bold text-ink" : "text-muted"}`}>
              {label}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-muted">
        Bar = family · ring = {dog.name}&apos;s {dog.handling_level} minimum
      </p>
    </div>
  );
}
