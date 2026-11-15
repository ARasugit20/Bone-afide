import type { Dog, Pose } from "./types";

// SuperAnimal pose has been run across all 9 test clips (1 fully stable, 5 partially
// stable; head tracking strongest at ~0.65 to 0.78 MODEL CONFIDENCE, not validated
// accuracy; tail/limb weaker). Until a human-labeled ground-truth comparison is done,
// pose is supporting/visual evidence only: it never feeds matching, handling level,
// approachability, needs, or the contract scores. The only effect, when POSE_ENABLED,
// is a small bounded energy/stress nudge shown as evidence (never a consequential one).
/** Off unless POSE_ENABLED is explicitly "true" / "1". */
export const POSE_ENABLED = /^(true|1)$/i.test(process.env.POSE_ENABLED ?? "");
export const POSE_MIN_READINESS = 70;
const MAX_SHIFT = 0.15; // never move a score by more than 15% of its current value

const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

function shift(score: number, direction: number, weight: number): number {
  return clamp(score + direction * MAX_SHIFT * score * weight);
}

/**
 * Returns the dog with pose-nudged energy/stress plus a plain-English reason,
 * or the dog untouched when pose is missing, disabled, or not ready enough.
 * Guardrail inputs (handling_level, approachability, needs) are never touched.
 */
export function applyPose(dog: Dog): { dog: Dog; reason: string | null } {
  const pose: Pose | undefined = dog.pose;
  if (!POSE_ENABLED || !pose || typeof pose.readiness !== "number" || pose.readiness < POSE_MIN_READINESS) {
    return { dog, reason: null };
  }
  const lying = pose.posture_pct?.lying;
  const weight = Math.min(1, Math.max(0, pose.readiness / 100));
  let energy = dog.energy;
  let stress = dog.stress;
  const notes: string[] = [];

  if (typeof lying === "number" && lying >= 50) {
    energy = shift(energy, -1, weight);
    notes.push(`Calm posture: lying ${Math.round(lying)}% of clip`);
  }
  if (typeof pose.tail_h === "number" && typeof pose.head_h === "number" && pose.tail_h < 0 && pose.head_h < 0) {
    stress = shift(stress, +1, weight);
    notes.push("Low tail and low head carriage in the kennel clip");
  }
  if (!notes.length) return { dog, reason: null };
  return { dog: { ...dog, energy, stress }, reason: notes.join(". ") };
}
