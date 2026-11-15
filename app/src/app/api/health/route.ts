import { NextResponse } from "next/server";
import { Client } from "pg";
import { db } from "@/lib/db";

// Booleans only — never echo env values. `reachable: null` = not probed (probing would cost money or trigger work).
type Service = { name: string; configured: boolean; reachable: boolean | null; fallback: string | null };

const TIMEOUT = 4000;
const env = (k: string) => Boolean(process.env[k]?.trim());
let cache: { at: number; body: unknown } | null = null;

async function probe(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT))]);
    return true;
  } catch {
    return false;
  }
}

async function ok(url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(String(res.status));
}

async function check(): Promise<Service[]> {
  const mongo = env("MONGODB_URI");
  const gemini = env("GEMINI_API_KEY");
  const supermemory = env("SUPERMEMORY_API_KEY");
  const tiger = env("TIGER_URL");
  const bedrock = ["BEDROCK_REGION", "BEDROCK_MODEL_ID", "BEDROCK_KEY_ID", "BEDROCK_SECRET"].every(env);
  const cognito = env("NEXT_PUBLIC_USER_POOL_ID") && env("NEXT_PUBLIC_USER_POOL_CLIENT_ID");
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";

  const [mongoUp, geminiUp, memoryUp, tigerUp] = await Promise.all([
    mongo ? probe(async () => (await db()).command({ ping: 1 })) : false,
    gemini
      ? probe(() => ok(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
          headers: { "x-goog-api-key": process.env.GEMINI_API_KEY! },
        }))
      : false,
    supermemory
      ? probe(() => ok("https://api.supermemory.ai/v4/search", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.SUPERMEMORY_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ q: "ping", containerTag: "health-check", limit: 1 }),
        }))
      : false,
    tiger
      ? probe(async () => {
          const c = new Client({ connectionString: process.env.TIGER_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: TIMEOUT });
          await c.connect();
          try {
            await c.query("SELECT 1");
          } finally {
            await c.end();
          }
        })
      : false,
  ]);

  return [
    { name: "MongoDB", configured: mongo, reachable: mongoUp, fallback: mongoUp ? null : "None — dogs, families and matches unavailable" },
    { name: "Gemini", configured: gemini, reachable: geminiUp, fallback: geminiUp ? null : "None — intake, ask and bias test unavailable" },
    { name: "Supermemory", configured: supermemory, reachable: memoryUp, fallback: memoryUp ? null : "Notes not saved; answers say notes don't cover it" },
    { name: "TinyFish", configured: env("TINYFISH_API_KEY"), reachable: null, fallback: env("TINYFISH_API_KEY") ? null : "Rentals script disabled; passport shows empty state" },
    { name: "Bedrock", configured: bedrock, reachable: null, fallback: bedrock ? null : "Gemini writes passport summaries" },
    { name: "Cognito", configured: cognito, reachable: null, fallback: cognito ? null : "Demo role switcher (Staff / Vet / Family)" },
    { name: "Tiger (trends)", configured: tiger, reachable: tiger ? tigerUp : false, fallback: tigerUp ? null : "Sample 5-day trend (marked “sample data”)" },
  ];
}

export async function GET() {
  if (!cache || Date.now() - cache.at > 30_000) {
    cache = { at: Date.now(), body: { checked_at: new Date().toISOString(), services: await check() } };
  }
  return NextResponse.json(cache.body);
}
