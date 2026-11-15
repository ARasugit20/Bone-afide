import { NextResponse, type NextRequest } from "next/server";
import { Pool } from "pg";

let pool: Pool | null = null;

function fakeSeries() {
  const today = Date.now();
  return Array.from({ length: 5 }, (_, i) => ({
    bucket: new Date(today - (4 - i) * 86_400_000).toISOString().slice(0, 10),
    avg_stress: 70 - i * 10,
    avg_energy: 60 + i * 3,
  }));
}

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/trend/[dogId]">) {
  const { dogId } = await ctx.params;
  const url = process.env.TIGER_URL;
  if (!url) {
    console.warn("[trend] TIGER_URL is empty — returning a sample series");
    return NextResponse.json({ dog_id: dogId, fake: true, series: fakeSeries() });
  }
  try {
    pool ??= new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
    const { rows } = await pool.query(
      "SELECT bucket, avg_stress, avg_energy FROM dog_daily WHERE dog_id = $1 ORDER BY bucket",
      [dogId],
    );
    return NextResponse.json({ dog_id: dogId, fake: false, series: rows });
  } catch (err) {
    console.warn("[trend] query failed — returning a sample series:", (err as Error).message);
    return NextResponse.json({ dog_id: dogId, fake: true, series: fakeSeries() });
  }
}
