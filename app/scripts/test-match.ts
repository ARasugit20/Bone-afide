import { hungarian, matchShelter, scorePair } from "../src/lib/match";
import { seedDogs, seedFamilies } from "../src/lib/seed-data";

// Sanity check: classic 3x3 with known optimum (cost 5: 0->1, 1->0, 2->2).
const a = hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]]);
console.log("hungarian 3x3:", a, a.join() === "1,0,2" ? "OK" : "UNEXPECTED");

console.log("\nScore grid (X = blocked):");
console.log("".padEnd(10) + seedFamilies.map((f) => f.family_id.padEnd(8)).join(""));
for (const d of seedDogs) {
  const row = seedFamilies.map((f) => {
    const s = scorePair(d, f);
    return (s.blocked ? "X" : String(s.score)).padEnd(8);
  });
  console.log(d.name.padEnd(10) + row.join(""));
}

const { matches, unmatched } = matchShelter(seedDogs, seedFamilies);
console.log("\nMatches:");
for (const m of matches) {
  const dog = seedDogs.find((d) => d.dog_id === m.dog_id)!;
  const fam = seedFamilies.find((f) => f.family_id === m.family_id)!;
  console.log(`  ${dog.name} -> ${fam.name} (${m.score})`);
  for (const r of m.reasons) console.log(`     - ${r}`);
}
console.log("Unmatched dogs:", unmatched.length ? unmatched.join(", ") : "none");
