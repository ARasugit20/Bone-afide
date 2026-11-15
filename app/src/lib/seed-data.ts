import type { Dog, Family } from "./types";

export const seedDogs: Dog[] = [
  {
    dog_id: "max-01", name: "Max", day: 5, energy: 72, stress: 28, approachability: 74, confidence: 66,
    arousal_spikes: 2, handling_level: "Yellow", trend: "improving", needs: ["active home", "no cats yet"],
    expert_reviewed: true,
  },
  {
    dog_id: "luna-02", name: "Luna", day: 8, energy: 35, stress: 18, approachability: 85, confidence: 72,
    arousal_spikes: 0, handling_level: "Green", trend: "stable", needs: ["calm evenings"],
    expert_reviewed: true,
  },
  {
    dog_id: "biscuit-03", name: "Biscuit", day: 4, energy: 45, stress: 66, approachability: 40, confidence: 34,
    arousal_spikes: 4, handling_level: "Orange", trend: "stable", needs: ["quiet home", "no small kids yet"],
    expert_reviewed: false,
  },
  {
    dog_id: "pepper-04", name: "Pepper", day: 6, energy: 50, stress: 30, approachability: 78, confidence: 61,
    arousal_spikes: 1, handling_level: "Green", trend: "stable", needs: [],
    expert_reviewed: true,
  },
  {
    dog_id: "rocky-05", name: "Rocky", day: 3, energy: 85, stress: 75, approachability: 45, confidence: 40,
    arousal_spikes: 7, handling_level: "Red", trend: "stable", needs: ["behavior plan first", "no dogs yet"],
    expert_reviewed: false,
  },
  {
    dog_id: "duke-06", name: "Duke", day: 1, energy: 78, stress: 82, approachability: 25, confidence: 30,
    arousal_spikes: 9, handling_level: "Red", trend: "stable", needs: ["behavior plan first", "no kids yet"],
    expert_reviewed: false,
  },
];

export const seedFamilies: Family[] = [
  { family_id: "garcia", name: "The Garcias", experience: 0, kids: "young", other_pets: [], home: "house", activity: 2, hours_alone: 6 },
  { family_id: "priya", name: "Priya", experience: 1, kids: "none", other_pets: [], home: "apartment", activity: 3, hours_alone: 8 },
  { family_id: "nguyen", name: "The Nguyens", experience: 2, kids: "teens", other_pets: ["dogs"], home: "house_yard", activity: 2, hours_alone: 5 },
  { family_id: "marcus", name: "Marcus", experience: 3, kids: "none", other_pets: [], home: "house_yard", activity: 3, hours_alone: 2, wants: "a project dog he can train" },
  { family_id: "smith", name: "The Smiths", experience: 1, kids: "none", other_pets: ["cats"], home: "apartment", activity: 1, hours_alone: 4 },
];

export const seedNotes: Record<string, { day: number; author: string; text: string }[]> = {
  "max-01": [
    { day: 1, author: "Jen (volunteer)", text: "Paced the kennel a lot and barked at passing dogs. Took treats gently once he calmed." },
    { day: 2, author: "Sam (volunteer)", text: "My 8-year-old came along. Max was gentle with her — sat for treats and leaned in for pets. He jumped up once when he got excited, then settled when asked to sit." },
    { day: 4, author: "Jen (volunteer)", text: "Great on a long walk, pulled at first then loose leash. Stared and whined at the shelter cat — keep him away from cats for now." },
  ],
  "luna-02": [
    { day: 1, author: "Ana (volunteer)", text: "Quiet and curious. Walked right up for a chin scratch." },
    { day: 3, author: "Ana (volunteer)", text: "Napped through the afternoon play group. Happy with a short walk." },
    { day: 7, author: "Leo (volunteer)", text: "Met a calm cat through the barrier and ignored it. Loves soft blankets." },
  ],
  "biscuit-03": [
    { day: 1, author: "Leo (volunteer)", text: "Stayed in the back of the kennel. Took treats only when I sat sideways and didn't look at him." },
    { day: 2, author: "Kim (volunteer)", text: "Startled at kids shouting near the lobby and barked. Needs a quiet home and time before meeting small kids." },
    { day: 4, author: "Kim (volunteer)", text: "Came forward for the first time and took a treat from my hand. Small progress." },
  ],
  "pepper-04": [
    { day: 1, author: "Sam (volunteer)", text: "Friendly and playful, wiggled over to greet everyone." },
    { day: 3, author: "Jen (volunteer)", text: "Knows sit and down. Polite on leash for a 30-minute walk." },
    { day: 5, author: "Ana (volunteer)", text: "Played nicely with a calm male dog in yard time." },
  ],
  "rocky-05": [
    { day: 1, author: "Kim (volunteer)", text: "Very high energy, spun and barked whenever someone walked past the kennel." },
    { day: 2, author: "Leo (volunteer)", text: "Lunged and barked at another dog on the walk. Needs no dogs for now and a behavior plan from staff first." },
    { day: 3, author: "Kim (volunteer)", text: "Calmer after a long fetch session. Took treats softly and leaned into my legs." },
  ],
  "duke-06": [
    { day: 1, author: "Jen (volunteer)", text: "Morning intake: pressed to the back of the kennel, panting and pacing. Wouldn't take treats while anyone stood near the door." },
    { day: 1, author: "Sam (volunteer)", text: "Barked and spun when a family with kids walked by. Needs a behavior plan first and no kids for now." },
    { day: 1, author: "Kim (staff)", text: "Evening: took two treats tossed from a distance while I sat sideways. A small first step — behavior team to start a plan tomorrow." },
  ],
};
