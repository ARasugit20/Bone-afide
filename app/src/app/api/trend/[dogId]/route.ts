import { NextResponse, type NextRequest } from "next/server";
import { Pool } from "pg";
import { fail } from "@/lib/http";

let pool: Pool | null = null;

// Reads the dog_daily continuous aggregate (Tiger Data / TimescaleDB) built from the dog_readings hypertable.
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/trend/[dogId]">) {
  const { dogId } = await ctx.params;
  const url = process.env.TIGER_URL;
  if (!url) return fail("Time series database is not configured.", 503);
  try {
    pool ??= new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 3 });
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
