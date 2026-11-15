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
      return fail((err as Error).message);
    }
  };
}
