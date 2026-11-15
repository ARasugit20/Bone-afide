import { Pool, type PoolConfig } from "pg";

// Tiger Data (TimescaleDB) client.
//
// node-postgres treats `sslmode=require` in a URL as full certificate verification, which fails against
// Tiger's chain unless the URL also carries `uselibpqcompat=true`. To work no matter how TIGER_URL is written
// (locally or in the Amplify console), SSL settings are stripped from the URL and set here instead:
// encrypted, without verifying the chain (same as libpq's sslmode=require).
export function tigerConfig(url = process.env.TIGER_URL): PoolConfig | null {
  if (!url) return null;
  let connectionString = url;
  try {
    const u = new URL(url);
    for (const k of ["sslmode", "uselibpqcompat", "sslrootcert", "sslcert", "sslkey"]) u.searchParams.delete(k);
    connectionString = u.toString();
  } catch {
    // Not a URL (e.g. key=value DSN); pass it through unchanged.
  }
  return { connectionString, ssl: { rejectUnauthorized: false } };
}

const g = globalThis as unknown as { _tiger?: Pool };

export function tiger(): Pool | null {
  const cfg = tigerConfig();
  if (!cfg) return null;
  g._tiger ??= new Pool({ ...cfg, max: 3, connectionTimeoutMillis: 8000 });
  return g._tiger;
}

export type DailyBehaviorRow = {
  bucket: string | Date;
  avg_stress: number | string | null;
  avg_energy: number | string | null;
};

/** Shared read of the real Tiger daily aggregate used by the trend chart and placement readiness. */
export async function readDailyBehavior(pool: Pool, dogId: string): Promise<DailyBehaviorRow[]> {
  const { rows } = await pool.query(
    "SELECT bucket, avg_stress, avg_energy FROM dog_daily WHERE dog_id = $1 ORDER BY bucket",
    [dogId],
  );
  return rows as DailyBehaviorRow[];
}
