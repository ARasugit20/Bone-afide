// Manual script: gather dog-friendly rentals with the TinyFish web agent and store them in Mongo "rentals".
// Usage: npx tsx --env-file=.env.local scripts/rentals.ts <dog_id> [listingsUrl]
import { closeDb, db } from "../src/lib/db";
import { DEFAULT_LISTINGS_URL, gatherRentals } from "../src/lib/tinyfish";

const dogId = process.argv[2] || "luna-01";
const url = process.argv[3] || DEFAULT_LISTINGS_URL;

console.log(`Asking TinyFish to browse ${url} for ${dogId} (this can take a few minutes)...`);
db()
  .then((d) => gatherRentals(d, dogId, url, console.log))
  .then((r) => console.log(`Saved ${r.kept} of ${r.found} listings for ${dogId}`))
  .catch((err) => {
    console.error("rentals failed:", err.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
