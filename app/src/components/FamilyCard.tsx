import type { Family } from "@/lib/types";
import { ACTIVITY, EXPERIENCE, HOME, KIDS } from "@/lib/ui";
import { Avatar } from "./ui";

export function FamilyCard({ family }: { family: Family }) {
  const facts = [
    HOME[family.home],
    KIDS[family.kids],
    family.other_pets.length ? `Has ${family.other_pets.join(" & ")}` : "No other pets",
    `${ACTIVITY[family.activity]} pace`,
    `${family.hours_alone} h alone`,
  ];
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <Avatar name={family.name.replace(/^The /, "")} />
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{family.name}</h3>
          <p className="text-xs text-muted">Experience with dogs: {EXPERIENCE[family.experience].toLowerCase()}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {facts.map((f) => (
          <span key={f} className="rounded-full bg-sand px-2 py-0.5 text-xs text-ink">
            {f}
          </span>
        ))}
      </div>
      {family.wants && <p className="mt-2 text-xs text-muted">Hoping for: {family.wants}</p>}
    </div>
  );
}
