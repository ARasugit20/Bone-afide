import type { Family } from "@/lib/types";
import { ACTIVITY, EXPERIENCE, HOME, KIDS } from "@/lib/ui";
import { Avatar } from "./ui";

export function FamilyCard({ family }: { family: Family }) {
  const facts = [
    HOME[family.home],
    KIDS[family.kids],
    family.other_pets.length ? `Has ${family.other_pets.join(" & ")}` : "No other pets",
    `${ACTIVITY[family.activity]} pace`,
    `~${family.hours_alone}h alone`,
  ];
  return (
    <div className="rounded-3xl border border-line bg-white p-4 shadow-[0_8px_24px_-14px_rgba(120,70,40,0.25)]">
      <div className="flex items-center gap-3">
        <Avatar name={family.name.replace(/^The /, "")} />
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-semibold">{family.name}</h3>
          <p className="text-xs text-muted">{EXPERIENCE[family.experience]} adopter</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {facts.map((f) => (
          <span key={f} className="rounded-full bg-sand px-2 py-0.5 text-[11px] font-semibold text-ink/70">
            {f}
          </span>
        ))}
      </div>
      {family.wants && <p className="mt-2 text-xs italic text-muted">“{family.wants}”</p>}
    </div>
  );
}
