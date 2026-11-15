// Server-side client for the behavior pipeline API (FastAPI in /pipeline).
export const PIPELINE_URL = (process.env.NEXT_PUBLIC_PIPELINE_URL || "http://localhost:8000").replace(/\/$/, "");

export async function pipelineFetch(path: string, init?: RequestInit & { timeoutMs?: number }) {
  const { timeoutMs = 30_000, ...rest } = init ?? {};
  return fetch(`${PIPELINE_URL}${path}`, { ...rest, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
}
