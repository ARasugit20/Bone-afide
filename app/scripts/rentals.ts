// Manual script: scrape dog-friendly rentals with TinyFish and store them in Mongo "rentals".
// Usage: npx tsx --env-file=.env.local scripts/rentals.ts [listingsUrl]
import { closeDb, db } from "../src/lib/db";

const DOG_ID = "max-01";
const URL_TO_SCRAPE = process.argv[2] || "https://www.apartments.com/tempe-az/";
const GOAL =
  "List up to 8 apartment listings near Arizona State University Tempe. For each return JSON " +
  "{name,address,rent,pets_allowed,dog_weight_limit_lbs,breed_restrictions,pet_policy_text,url}. Return ONLY a JSON array.";

type Listing = {
  name?: string;
  address?: string;
  rent?: string | number;
  pets_allowed?: boolean | string;
  dog_weight_limit_lbs?: number | string | null;
  breed_restrictions?: boolean | string | string[] | null;
  pet_policy_text?: string;
  url?: string;
};

function shape(v: unknown, depth = 0): unknown {
  if (depth > 3) return typeof v;
  if (Array.isArray(v)) return v.length ? [`Array(${v.length})`, shape(v[0], depth + 1)] : "[]";
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)]));
  return typeof v === "string" ? `string(${v.length})` : typeof v;
}

// Find the first array of listing-like objects anywhere in the response (including JSON inside strings).
function findListings(v: unknown): Listing[] | null {
  if (typeof v === "string") {
    const m = v.match(/\[[\s\S]*\]/);
    if (!m) return null;
    try {
      return findListings(JSON.parse(m[0]));
    } catch {
      return null;
    }
  }
  if (Array.isArray(v)) {
    if (v.length && v.every((x) => x && typeof x === "object" && ("name" in x || "address" in x))) return v as Listing[];
    for (const x of v) {
      const hit = findListings(x);
      if (hit) return hit;
    }
    return null;
  }
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) {
      const hit = findListings(x);
      if (hit) return hit;
    }
  }
  return null;
}

const yes = (v: unknown) => v === true || (typeof v === "string" && /^(yes|true|allowed|dogs?)/i.test(v.trim()));
const hasBreedRule = (v: unknown) =>
  Array.isArray(v) ? v.length > 0 : typeof v === "string" ? !/^(no|none|false|n\/a|)$/i.test(v.trim()) : Boolean(v);
// Agents sometimes report "None" in the field while the policy text says restrictions "may apply".
const POLICY_MENTIONS_BREED_RULE = /breed restrictions?[^.]*(apply|may)|restricted breeds/i;
// "None" / "Not specified" placeholders become null so the UI can hide them.
const clean = <T>(v: T) => (typeof v === "string" && /^(none|not specified|n\/a|unknown|)$/i.test(v.trim()) ? null : v);

async function main() {
  const key = process.env.TINYFISH_API_KEY;
  if (!key) {
    console.warn("TINYFISH_API_KEY is empty — nothing to do.");
    return;
  }

  console.log(`Asking TinyFish to browse ${URL_TO_SCRAPE} (this can take a few minutes)…`);
  const res = await fetch("https://agent.tinyfish.ai/v1/automation/run", {
    method: "POST",
    headers: { "X-API-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ url: URL_TO_SCRAPE, goal: GOAL }),
    signal: AbortSignal.timeout(15 * 60_000),
  });
  const text = await res.text();
  console.log("HTTP", res.status);
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Some responses are plain text; findListings handles strings too.
  }
  console.log("Response shape:", JSON.stringify(shape(data), null, 2));
  console.log("Response (first 2000 chars):", text.slice(0, 2000));
  if (!res.ok) throw new Error(`TinyFish returned ${res.status}`);

  const listings = findListings(data);
  if (!listings) throw new Error("No listing array found in the response (site may have blocked the agent).");
  console.log(`Found ${listings.length} listings`);

  const keep = listings.filter(
    (l) => yes(l.pets_allowed) && !hasBreedRule(l.breed_restrictions) && !POLICY_MENTIONS_BREED_RULE.test(l.pet_policy_text ?? ""),
  );
  console.log(`Keeping ${keep.length} that allow pets with no breed restrictions`);

  const d = await db();
  await d.collection("rentals").deleteMany({ dog_id: DOG_ID });
  if (keep.length) {
    await d.collection("rentals").insertMany(
      keep.map((l) => ({
        dog_id: DOG_ID,
        name: l.name ?? "Unnamed listing",
        address: l.address ?? "",
        rent: clean(l.rent) ?? null,
        dog_weight_limit_lbs: clean(l.dog_weight_limit_lbs) ?? null,
        pet_policy_text: l.pet_policy_text ?? "",
        url: l.url ?? URL_TO_SCRAPE,
        source: URL_TO_SCRAPE,
        fetched_at: new Date(),
      })),
    );
  }
  await d.collection("rentals").createIndex({ dog_id: 1 });
  console.log(`Saved ${keep.length} rentals for ${DOG_ID}`);
}

main()
  .catch((err) => {
    console.error("rentals failed:", err.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
