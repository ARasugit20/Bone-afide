import { NextResponse, type NextRequest } from "next/server";
import { fail } from "@/lib/http";
import { tiger } from "@/lib/tiger";

// Reads the dog_daily continuous aggregate (Tiger Data / TimescaleDB) built from the dog_readings hypertable.
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/trend/[dogId]">) {
  const { dogId } = await ctx.params;
  const pool = tiger();
  if (!pool) return fail("Time series database is not configured.", 503);
  try {
    const { rows } = await pool.query(
      "SELECT bucket, avg_stress, avg_energy FROM dog_daily WHERE dog_id = $1 ORDER BY bucket",
      [dogId],
    );
    return NextResponse.json({ dog_id: dogId, source: "dog_daily", series: rows });
  } catch (err) {
    console.warn("[trend] query failed:", (err as Error).message);
    return fail("Couldn't reach the time series database. Try again in a moment.", 503);
  }
}
