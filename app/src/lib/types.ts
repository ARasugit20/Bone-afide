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
  photo?: string;
  expert_reviewed: boolean;
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

export interface Match {
  dog_id: string;
  family_id: string;
  score: number;
  reasons: string[];
}
