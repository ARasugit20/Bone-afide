import type { CareItemView, CareRecord, CareType } from "./types";

export const CARE_LABELS: Record<CareType, string> = {
  nail_trim: "Nail trim",
  bath: "Bath",
  vaccines: "Vaccines",
  vet_checkup: "Vet checkup",
  flea_tick: "Flea and tick",
};

export const CARE_ORDER: CareType[] = ["vaccines", "vet_checkup", "flea_tick", "nail_trim", "bath"];

export const DEFAULT_INTERVALS: Record<CareType, number> = {
  nail_trim: 30,
  bath: 30,
  vaccines: 365,
  vet_checkup: 180,
  flea_tick: 30,
};

const DAY_MS = 86_400_000;

function startOfDay(d: Date): number {
  return Math.floor(d.getTime() / DAY_MS);
}

/** Add derived next_due / days_until / overdue to a raw care record. */
export function viewCareItem(rec: CareRecord, now = new Date()): CareItemView {
  const last = new Date(rec.last_date);
  const next = new Date(last.getTime() + rec.interval_days * DAY_MS);
  const days_until = startOfDay(next) - startOfDay(now);
  return {
    ...rec,
    label: CARE_LABELS[rec.type],
    next_due: next.toISOString().slice(0, 10),
    days_until,
    overdue: days_until < 0,
  };
}

export function sortCare(items: CareItemView[]): CareItemView[] {
  return [...items].sort(
    (a, b) => a.days_until - b.days_until || CARE_ORDER.indexOf(a.type) - CARE_ORDER.indexOf(b.type),
  );
}
