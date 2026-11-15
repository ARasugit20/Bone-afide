// Server-side client for the behavior pipeline API (FastAPI in /pipeline).
// Set NEXT_PUBLIC_PIPELINE_URL to a reachable pipeline. In local development it defaults to localhost:8000;
// in production there is no default, so features that need the live pipeline degrade instead of failing.
export const PIPELINE_URL: string | null =
  (process.env.NEXT_PUBLIC_PIPELINE_URL || (process.env.NODE_ENV === "development" ? "http://localhost:8000" : "")).replace(/\/$/, "") || null;

export async function pipelineFetch(path: string, init?: RequestInit & { timeoutMs?: number }) {
  if (!PIPELINE_URL) throw new Error("No pipeline server is configured.");
  const { timeoutMs = 30_000, ...rest } = init ?? {};
  return fetch(`${PIPELINE_URL}${path}`, { ...rest, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
}
