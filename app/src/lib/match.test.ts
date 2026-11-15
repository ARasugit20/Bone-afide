// Run with: npm test
import assert from "node:assert/strict";
import test from "node:test";
import { scorePair } from "./match";
import { POSE_ENABLED } from "./pose";
import type { Dog, Family, Pose } from "./types";

const dog: Dog = {
  dog_id: "test-01", name: "Test", day: 4, energy: 70, stress: 60,
  approachability: 70, confidence: 55, arousal_spikes: 2,
  handling_level: "Yellow", trend: "stable", needs: [], expert_reviewed: true,
};
const family: Family = {
  family_id: "f1", name: "Fam", experience: 2, kids: "none",
  other_pets: [], home: "house_yard", activity: 2, hours_alone: 4,
};
const pose: Pose = { posture_pct: { standing: 20, sitting: 18, lying: 62 }, tail_h: -0.2, head_h: -0.1, readiness: 88, confidence: 0.72, version: "pose-1" };

test("pose is off by default, so POSE_ENABLED must not be set in test env", () => {
  assert.equal(POSE_ENABLED, false);
});

test("score is identical with no pose field", () => {
  const base = scorePair(dog, family);
  const copy = scorePair({ ...dog }, family);
  assert.equal(copy.score, base.score);
  assert.deepEqual(copy.reasons, base.reasons);
});

test("pose present but POSE_ENABLED false changes nothing", () => {
  const base = scorePair(dog, family);
  const withPose = scorePair({ ...dog, pose }, family);
  assert.equal(withPose.score, base.score);
  assert.deepEqual(withPose.reasons, base.reasons);
  assert.equal(withPose.blocked, base.blocked);
});

test("low readiness is ignored even if pose were enabled", () => {
  const base = scorePair(dog, family);
  const low = scorePair({ ...dog, pose: { ...pose, readiness: 42 } }, family);
  assert.equal(low.score, base.score);
});
