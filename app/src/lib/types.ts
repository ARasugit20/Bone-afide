export type HandlingLevel = "Green" | "Yellow" | "Orange" | "Red";

// Data contract with the /pipeline teammate — do not rename fields.
export interface Dog {
  dog_id: string;
  name: string;
  day: number;
  energy: number; // 0-100
  stress: number; // 0-100
  approachability: number; // 0-100
  confidence: number; // 0-100
  arousal_spikes: number;
  handling_level: HandlingLevel;
  trend: "improving" | "stable" | "worsening";
  needs: string[]; // e.g. "no cats yet"
  photo?: string; // signed S3 URL (thumbnail)
  video_url?: string; // signed S3 URL (annotated tracking video)
  media_status?: "pending" | "complete"; // pipeline S3 upload state after /analyze
  behavior_report?: string;
  behavior_report_at?: string;
  behavior_report_provider?: string; // "bedrock" when written by Amazon Bedrock
  behavior_report_by?: string; // display label, e.g. "Amazon Bedrock (Nova Lite)"
  events?: BehaviorEvent[]; // detected by the pipeline from the tracking video
  welfare?: Welfare; // kennel-decline alert from the last 3 Tiger sessions
  evidence?: Evidence; // grounded facts from video and Tiger sessions
  fit_notes?: string[]; // short factual lines, e.g. "Calm in 2 of 4 sessions."
  not_suited_for?: string[]; // e.g. "homes with very young children"
  handler?: Handler; // who can handle this dog day to day
  pose?: Pose; // optional SuperAnimal pose summary; off by default (POSE_ENABLED)
  pipeline_version?: string; // optional provenance tag when the pipeline persists one
  expert_reviewed: boolean;
  updated_at?: string; // ISO; set by the pipeline when present
}
/** Optional SuperAnimal pose summary written by pipeline/pose (off by default). */
export interface Pose {
  available: boolean;
  keypoints_url?: string | null;
  notes?: string | null;
  posture_pct?: Partial<Record<"lying" | "standing" | "sitting", number>> | null;
  tail_h?: number | null;
  head_h?: number | null;
  readiness?: number;
  confidence?: number;
  version?: string;
}

export type EventType = "calm" | "jump" | "acceleration" | "reversal";

export interface BehaviorEvent {
  type: EventType;
  start_s: number;
  end_s: number;
  label: string;
}

export type Experience = "any" | "some" | "experienced" | "staff";

export interface Evidence {
  sessions_observed: number;
  calm_sessions: number;
  max_stress: number;
  latest_stress: number;
  jump_count: number;
  rush_count: number;
  calm_seconds: number;
  clip_seconds: number;
  pct_time_calm: number;
  trend: string;
  detection_coverage?: number; // optional; not present in the current persisted evidence contract
}

export interface Handler {
  min_experience: Experience;
  label: string;
  notes: string[];
}

export interface Volunteer {
  volunteer_id: string;
  name: string;
  experience: Experience;
  shifts: string[];
}

/** Adopter- and landlord-safe view of a dog, for the public QR passport. */
export interface PublicPassport {
  dog_id: string;
  name: string;
  photo?: string;
  video_url?: string;
  handling_level: HandlingLevel;
  scores: Partial<Record<"energy" | "stress" | "approachability" | "confidence" | "arousal_spikes", number>>;
  needs: string[];
  fit_notes: string[];
  not_suited_for: string[];
  events: BehaviorEvent[];
  sessions_observed: number;
  updated_at?: string;
  expert_reviewed: boolean;
}

/** Progress of one /analyze-s3 run, in Mongo `pipeline_jobs` (written by the pipeline). */
export type JobStage = "queued" | "downloading" | "detecting" | "tracking" | "scoring" | "saving" | "uploading_media" | "done" | "failed";

export interface PipelineJob {
  job_id: string;
  dog_id: string;
  s3_key?: string;
  stage: JobStage;
  progress: number;
  stage_timings?: Partial<Record<JobStage, number>>;
  error?: string | null;
  result?: {
    dog_id: string;
    name?: string;
    handling_level: HandlingLevel;
    scores: { energy: number; stress: number; approachability: number; confidence: number; arousal_spikes: number };
    events_count?: number;
    media_status?: string;
  } | null;
  created_at?: string;
  updated_at?: string;
}

export interface Welfare {
  status: "rising_stress" | "improving" | "stable";
  sessions: number;
  stress_change: number;
  message: string;
}

export interface StaffNote {
  author: string;
  note: string;
  day?: number;
  created_at?: string;
  indexed?: boolean; // copied to Supermemory
}

export type Pet = "cats" | "dogs" | "small";

export interface Family {
  family_id: string;
  name: string;
  experience: 0 | 1 | 2 | 3; // 0 first-time, 1 some, 2 experienced, 3 foster/pro
  kids: "none" | "teens" | "young";
  other_pets: Pet[];
  home: "apartment" | "house" | "house_yard";
  activity: 1 | 2 | 3; // 1 relaxed, 2 moderate, 3 very active
  hours_alone: number;
  wants?: string;
}

export type Role = "staff" | "vet" | "family";

export interface Rental {
  dog_id: string;
  name: string;
  address: string;
  rent: string | number | null;
  dog_weight_limit_lbs: number | string | null;
  pet_policy_text: string;
  url: string;
  source?: string;
  fetched_at?: string;
}

export interface RentalJob {
  dog_id: string;
  run_id: string;
  status: "running" | "done" | "failed" | "timed_out";
  started_at: string;
  finished_at?: string;
  kept?: number;
  found?: number;
  error?: string;
}

export interface MatchRun {
  ran_at: string;
  dogs: number;
  families: number;
  matches: number;
}

export interface Match {
  dog_id: string;
  family_id: string;
  score: number;
  reasons: string[];
}

// --- Care hub (Task 4) ---
export type CareType = "nail_trim" | "bath" | "vaccines" | "vet_checkup" | "flea_tick";
export interface CareRecord {
  dog_id: string;
  type: CareType;
  last_date: string; // ISO date
  interval_days: number;
  notes?: string;
}
export interface CareItemView extends CareRecord {
  label: string;
  next_due: string; // ISO date
  days_until: number; // negative = overdue
  overdue: boolean;
}

// --- Food and supplies (Task 5) ---
export interface Diet {
  dog_id: string;
  food_type: string;
  grams_per_day: number;
  allergies: string[];
  notes?: string;
}
export interface InventoryItem {
  sku: string;
  name: string;
  unit: string; // e.g. "kg", "cans"
  on_hand: number;
  daily_use: number; // units consumed per day across the shelter
  low_stock_days: number; // alert threshold in days of stock
}
export interface FoodHelp {
  name: string;
  address?: string;
  phone?: string;
  url: string;
  kind?: string; // "food bank", "pantry", "donation"
}
export interface FoodHelpJob {
  run_id: string;
  status: "running" | "done" | "failed" | "timed_out";
  started_at: string;
  finished_at?: string;
  found?: number;
  error?: string;
}

// --- Playgroups (Task 7) ---
export interface Playgroup {
  dog_ids: string[];
  reasons: string[];
}
export interface Playdate {
  playdate_id: string;
  dog_ids: string[];
  scheduled_for: string; // ISO
  volunteer_id?: string;
  volunteer_name?: string;
  created_at: string;
}

// --- Alumni feed (Task 8) ---
export interface AlumniPost {
  post_id: string;
  dog_id: string;
  dog_name: string;
  family_name?: string;
  text: string;
  photo?: string;
  created_at: string;
}

// --- Vet Q&A (Task 6) ---
export interface VetAnswer {
  question: string;
  answer: string;
  model: string; // display label of the model that wrote it
  created_at: string;
}
