import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";

export { CAPTION } from "./ui";

export function fail(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

// Wraps a route handler so thrown errors become JSON 500s instead of HTML pages.
export function safe<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      unstable_rethrow(err); // let Next's own control-flow errors (e.g. prerender bail-out) through
      console.error("[api]", err);
      return friendly((err as Error).message);
    }
  };
}

// Upstream AI errors arrive as raw JSON blobs; turn the common ones into something a person can act on.
function friendly(message: string) {
  if (/RESOURCE_EXHAUSTED|"code":\s*429/.test(message))
    return fail("The AI service is at its rate limit. Wait a minute and try again.", 429);
  if (/UNAVAILABLE|DEADLINE_EXCEEDED|"code":\s*50[34]/.test(message))
    return fail("The AI service is busy. Try again in a moment.", 503);
  return fail(message);
}
