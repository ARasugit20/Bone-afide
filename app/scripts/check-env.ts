// Ping each configured service. Prints status only — never key values.
// Usage: npx tsx --env-file=.env.local scripts/check-env.ts
import { Client } from "pg";
import { closeDb, db } from "../src/lib/db";

const TIMEOUT = 8000;
const set = (k: string) => Boolean(process.env[k]?.trim());

async function ping(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT))]);
    return true;
  } catch {
    return false;
  }
}

async function http(url: string, init: RequestInit, ok: (status: number) => boolean) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  if (!ok(res.status)) throw new Error(String(res.status));
}

type Row = { name: string; configured: boolean; up: boolean | null };

async function main() {
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
  const rows: Row[] = [
    {
      name: "MongoDB",
      configured: set("MONGODB_URI"),
      up: set("MONGODB_URI") ? await ping(async () => (await db()).command({ ping: 1 })) : null,
    },
    {
      name: "Gemini",
      configured: set("GEMINI_API_KEY"),
      up: set("GEMINI_API_KEY")
        ? await ping(() => http(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY! } }, (s) => s === 200))
        : null,
    },
    {
      name: "Supermemory",
      configured: set("SUPERMEMORY_API_KEY"),
      up: set("SUPERMEMORY_API_KEY")
        ? await ping(() => http("https://api.supermemory.ai/v4/search", {
            method: "POST",
            headers: { Authorization: `Bearer ${process.env.SUPERMEMORY_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ q: "ping", containerTag: "health-check", limit: 1, searchMode: "hybrid" }),
          }, (s) => s === 200))
        : null,
    },
    {
      name: "TinyFish",
      configured: set("TINYFISH_API_KEY"),
      up: set("TINYFISH_API_KEY")
        ? await ping(() => http("https://agent.tinyfish.ai/v1/automation/run", { method: "GET", headers: { "X-API-Key": process.env.TINYFISH_API_KEY! } }, (s) => s !== 401 && s !== 403))
        : null,
    },
    {
      name: "Bedrock",
      configured: ["BEDROCK_REGION", "BEDROCK_MODEL_ID", "BEDROCK_KEY_ID", "BEDROCK_SECRET"].every(set),
      up: null,
    },
    {
      name: "Cognito",
      configured: set("NEXT_PUBLIC_USER_POOL_ID") && set("NEXT_PUBLIC_USER_POOL_CLIENT_ID"),
      up: null,
    },
    {
      name: "Tiger Data",
      configured: set("TIGER_URL"),
      up: set("TIGER_URL")
        ? await ping(async () => {
            const c = new Client({ connectionString: process.env.TIGER_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: TIMEOUT });
            await c.connect();
            try { await c.query("SELECT 1"); } finally { await c.end(); }
          })
        : null,
    },
    {
      name: "xAI",
      configured: set("XAI_API_KEY") && set("XAI_MODEL"),
      up: set("XAI_API_KEY")
        ? await ping(() => http("https://api.x.ai/v1/models", { headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` } }, (s) => s === 200))
        : null,
    },
    {
      name: "Discord",
      configured: set("DISCORD_WEBHOOK_URL"),
      up: set("DISCORD_WEBHOOK_URL")
        ? await ping(() => http(process.env.DISCORD_WEBHOOK_URL!, { method: "GET" }, (s) => s === 200))
        : null,
    },
  ];

  for (const r of rows) {
    const mark = !r.configured ? "❌ not configured" : r.up === null ? "✅ configured (not probed)" : r.up ? "✅ reachable" : "❌ unreachable";
    console.log(`${r.name}: ${mark}`);
  }
}

main()
  .catch((err) => {
    console.error("check-env failed:", (err as Error).message);
    process.exitCode = 1;
  })
  .finally(closeDb);
