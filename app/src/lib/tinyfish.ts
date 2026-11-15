import type { Db } from "mongodb";

// TinyFish web agent: browses a real listings site and returns pet-friendly rentals.
const API = "https://agent.tinyfish.ai/v1";
export const DEFAULT_LISTINGS_URL = "https://www.apartments.com/tempe-az/pet-friendly-dog/";
const GOAL =
  "List up to 8 apartment listings that allow dogs. For each return JSON " +
  "{name,address,rent,pets_allowed,dog_weight_limit_lbs,breed_restrictions,pet_policy_text,url}. " +
  "url must be the listing's own page. Return ONLY a JSON array.";

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

export function shape(v: unknown, depth = 0): unknown {
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
// "None", "None specified", "Not specified on page" mean the listing states no breed rule.
const NO_RULE = /^(no|none|none specified|none listed|not specified|not specified on page|not listed|false|n\/a|)\.?$/i;
const hasBreedRule = (v: unknown) =>
  Array.isArray(v) ? v.length > 0 : typeof v === "string" ? !NO_RULE.test(v.trim()) : Boolean(v);
// Agents sometimes report "None" in the field while the policy text says restrictions "may apply".
const POLICY_MENTIONS_BREED_RULE = /breed restrictions?[^.]*(apply|may)|restricted breeds/i;
// "None" / "Not specified" placeholders become null so the UI can hide them.
const clean = <T>(v: T) => (typeof v === "string" && /^(none|not specified|n\/a|unknown|)$/i.test(v.trim()) ? null : v);


export type RentalRun = { found: number; kept: number; fetched_at: string; source: string };
export const RUN_CAP_MS = 6 * 60_000;

type AgentRun = { status?: string; result?: unknown; error?: { message?: string } | null };

function headers() {
  const key = process.env.TINYFISH_API_KEY;
  if (!key) throw new Error("TINYFISH_API_KEY is not set");
  return { "X-API-Key": key, "Content-Type": "application/json" };
}

/** Queues a TinyFish run and returns its id right away. */
export async function startAgentRun(listingsUrl = DEFAULT_LISTINGS_URL): Promise<string> {
  const queued = await fetch(`${API}/automation/run-async`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ url: listingsUrl, goal: GOAL }),
    signal: AbortSignal.timeout(60_000),
  });
  const q = (await queued.json().catch(() => ({}))) as { run_id?: string; error?: { message?: string } };
  if (!queued.ok || !q.run_id) throw new Error(q.error?.message || `TinyFish returned ${queued.status}`);
  return q.run_id;
}

export async function getAgentRun(runId: string): Promise<AgentRun | null> {
  const res = await fetch(`${API}/runs/${runId}`, { headers: headers(), signal: AbortSignal.timeout(30_000) }).catch(() => null);
  return res?.ok ? ((await res.json()) as AgentRun) : null;
}

export async function cancelAgentRun(runId: string): Promise<void> {
  await fetch(`${API}/runs/${runId}/cancel`, { method: "POST", headers: headers(), signal: AbortSignal.timeout(15_000) }).catch(() => null);
}

/** Filters a finished run's listings and replaces this dog's saved rentals in Mongo. */
export async function saveRunResult(d: Db, dogId: string, result: unknown, listingsUrl = DEFAULT_LISTINGS_URL, log: (m: string) => void = () => {}): Promise<RentalRun> {
  log(`Result shape: ${JSON.stringify(shape(result))}`);
  const listings = findListings(result);
  if (!listings) throw new Error("The agent didn't return any listings. The site may have blocked it; try again later.");
  const keep = listings.filter(
    (l) => yes(l.pets_allowed) && !hasBreedRule(l.breed_restrictions) && !POLICY_MENTIONS_BREED_RULE.test(l.pet_policy_text ?? ""),
  );
  log(`Found ${listings.length}, keeping ${keep.length} that allow dogs with no breed restrictions`);

  const fetched_at = new Date();
  // A search that finds nothing usable keeps the listings from the last good search.
  if (keep.length) {
    await d.collection("rentals").deleteMany({ dog_id: dogId });
    await d.collection("rentals").insertMany(
      keep.map((l) => ({
        dog_id: dogId,
        name: l.name ?? "Unnamed listing",
        address: l.address ?? "",
        rent: clean(l.rent) ?? null,
        dog_weight_limit_lbs: clean(l.dog_weight_limit_lbs) ?? null,
        pet_policy_text: l.pet_policy_text ?? "",
        url: l.url && /^https?:\/\//.test(l.url) ? l.url : listingsUrl,
        source: listingsUrl,
        fetched_at,
      })),
    );
  }
  await d.collection("rentals").createIndex({ dog_id: 1 });
  return { found: listings.length, kept: keep.length, fetched_at: fetched_at.toISOString(), source: listingsUrl };
}

/** Script helper: runs the agent to completion (blocking) and saves the result. */
export async function gatherRentals(d: Db, dogId: string, listingsUrl = DEFAULT_LISTINGS_URL, log: (m: string) => void = () => {}): Promise<RentalRun> {
  const runId = await startAgentRun(listingsUrl);
  log(`TinyFish run ${runId} queued`);
  const deadline = Date.now() + 15 * 60_000;
  let run: AgentRun = {};
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    run = (await getAgentRun(runId)) ?? run;
    if (run.status === "COMPLETED" || run.status === "FAILED" || run.status === "CANCELLED") break;
  }
  log(`TinyFish run ${runId}: ${run.status ?? "timed out"}`);
  if (run.status !== "COMPLETED") throw new Error(run.error?.message || `The web agent run ${run.status ? run.status.toLowerCase() : "timed out"}.`);
  return saveRunResult(d, dogId, run.result, listingsUrl, log);
}
